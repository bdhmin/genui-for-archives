import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WidgetRow = {
  id: string;
  global_tag_id: string;
  name: string;
  description: string | null;
  data_schema: Record<string, unknown>;
  global_tags: {
    id: string;
    tag: string;
    conversation_global_tags: { conversation_id: string }[];
  };
};

type WidgetDataRow = {
  id: string;
  widget_id: string;
  data: Record<string, unknown>;
  source_conversation_id: string | null;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { widgetIds } = body as { widgetIds: string[] };

    if (!widgetIds || !Array.isArray(widgetIds) || widgetIds.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 widget IDs are required for merging' },
        { status: 400 }
      );
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      );
    }

    const supabase = getSupabaseServerClient();

    // Fetch all widgets to merge
    const { data: widgets, error: widgetsError } = await supabase
      .from('ui_widgets')
      .select(`
        id,
        global_tag_id,
        name,
        description,
        data_schema,
        global_tags (
          id,
          tag,
          conversation_global_tags (
            conversation_id
          )
        )
      `)
      .in('id', widgetIds);

    if (widgetsError) {
      console.error('[Merge API] Error fetching widgets:', widgetsError);
      return NextResponse.json(
        { error: widgetsError.message },
        { status: 500 }
      );
    }

    if (!widgets || widgets.length < 2) {
      return NextResponse.json(
        { error: 'Could not find all widgets to merge' },
        { status: 404 }
      );
    }

    // Collect all widget data from all widgets
    const { data: allWidgetData, error: dataError } = await supabase
      .from('ui_widget_data')
      .select('id, widget_id, data, source_conversation_id')
      .in('widget_id', widgetIds);

    if (dataError) {
      console.error('[Merge API] Error fetching widget data:', dataError);
    }

    // Type cast the widgets
    const typedWidgets = widgets as unknown as WidgetRow[];

    // Collect all unique conversation IDs from all widgets
    const allConversationIds = new Set<string>();
    typedWidgets.forEach((widget) => {
      const globalTagData = widget.global_tags as unknown as {
        id: string;
        tag: string;
        conversation_global_tags: { conversation_id: string }[];
      } | null;
      globalTagData?.conversation_global_tags?.forEach((ct) => {
        allConversationIds.add(ct.conversation_id);
      });
    });

    // Also add conversation IDs from widget data
    (allWidgetData as WidgetDataRow[] || []).forEach((item) => {
      if (item.source_conversation_id) {
        allConversationIds.add(item.source_conversation_id);
      }
    });

    // Generate a merged name from the widget names
    const widgetNames = typedWidgets.map((w) => w.name);
    const mergedName = `Merged: ${widgetNames.slice(0, 3).join(', ')}${widgetNames.length > 3 ? ` (+${widgetNames.length - 3} more)` : ''}`;

    // Generate a merged description
    const mergedDescription = `Combined UI from ${typedWidgets.length} widgets: ${widgetNames.join(', ')}`;

    // Create a new merged global tag
    const mergedTagName = widgetNames
      .map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .join('-')
      .substring(0, 100);

    const { data: newGlobalTag, error: tagError } = await supabase
      .from('global_tags')
      .insert({
        tag: `merged-${mergedTagName}-${Date.now()}`,
      })
      .select()
      .single();

    if (tagError) {
      console.error('[Merge API] Error creating global tag:', tagError);
      return NextResponse.json(
        { error: 'Failed to create merged tag' },
        { status: 500 }
      );
    }

    // Link all conversations to the new global tag
    const conversationTagLinks = Array.from(allConversationIds).map(
      (conversationId) => ({
        conversation_id: conversationId,
        global_tag_id: newGlobalTag.id,
      })
    );

    if (conversationTagLinks.length > 0) {
      const { error: linkError } = await supabase
        .from('conversation_global_tags')
        .insert(conversationTagLinks);

      if (linkError) {
        console.error('[Merge API] Error linking conversations:', linkError);
        // Continue anyway - the widget can still be created
      }
    }

    // Create the new merged widget with 'generating' status
    const { data: newWidget, error: createError } = await supabase
      .from('ui_widgets')
      .insert({
        global_tag_id: newGlobalTag.id,
        name: mergedName,
        description: mergedDescription,
        component_code: '// Generating merged UI...', // Placeholder
        data_schema: {}, // Will be regenerated
        status: 'generating',
        last_opened_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError) {
      console.error('[Merge API] Error creating widget:', createError);
      return NextResponse.json(
        { error: 'Failed to create merged widget' },
        { status: 500 }
      );
    }

    // Migrate all existing widget data to the new widget
    if (allWidgetData && allWidgetData.length > 0) {
      const migratedData = (allWidgetData as WidgetDataRow[]).map((item) => ({
        widget_id: newWidget.id,
        data: item.data,
        source_conversation_id: item.source_conversation_id,
      }));

      const { error: migrateError } = await supabase
        .from('ui_widget_data')
        .insert(migratedData);

      if (migrateError) {
        console.error('[Merge API] Error migrating widget data:', migrateError);
        // Continue anyway
      }
    }

    // Delete the old widgets (this will cascade delete their data)
    const { error: deleteError } = await supabase
      .from('ui_widgets')
      .delete()
      .in('id', widgetIds);

    if (deleteError) {
      console.error('[Merge API] Error deleting old widgets:', deleteError);
      // Continue anyway - the merge was successful
    }

    // Trigger UI regeneration via the Supabase Edge Function
    // We await this to ensure the function is at least invoked properly
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      // Call the generate-widget-ui edge function
      const functionUrl = `${supabaseUrl}/functions/v1/generate-widget-ui`;
      
      console.log('[Merge API] Triggering edge function:', functionUrl);
      console.log('[Merge API] Payload:', {
        widgetId: newWidget.id,
        globalTagId: newGlobalTag.id,
        isMerge: true,
      });
      
      const edgeFunctionResponse = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          widgetId: newWidget.id,
          globalTagId: newGlobalTag.id,
          isMerge: true,
        }),
      });
      
      const edgeResult = await edgeFunctionResponse.text();
      console.log('[Merge API] Edge function response:', edgeFunctionResponse.status, edgeResult);
      
      if (!edgeFunctionResponse.ok) {
        console.error('[Merge API] Edge function failed:', edgeResult);
      }
    } catch (err) {
      console.error('[Merge API] Error triggering regeneration:', err);
      // Don't fail the request - the widget is created, just needs regeneration
    }

    return NextResponse.json({
      success: true,
      widget: {
        id: newWidget.id,
        name: newWidget.name,
        status: newWidget.status,
      },
      mergedCount: typedWidgets.length,
      conversationCount: allConversationIds.size,
      dataItemCount: allWidgetData?.length || 0,
    });
  } catch (error) {
    console.error('[Merge API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to merge widgets' },
      { status: 500 }
    );
  }
}

