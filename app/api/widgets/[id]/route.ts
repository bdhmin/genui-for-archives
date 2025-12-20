import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WidgetDataRow = {
  id: string;
  data: Record<string, unknown>;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

// GET: Fetch widget details including code and data
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const supabase = getSupabaseServerClient();

    // Fetch widget details
    const { data: widget, error: widgetError } = await supabase
      .from('ui_widgets')
      .select(`
        id,
        global_tag_id,
        name,
        description,
        component_code,
        data_schema,
        status,
        error_message,
        created_at,
        updated_at,
        code_hash,
        global_tags (
          tag,
          conversation_global_tags (
            conversation_id
          )
        )
      `)
      .eq('id', id)
      .single();

    if (widgetError) {
      console.error(`[Widget API] Error fetching widget ${id}:`, widgetError);
      return NextResponse.json({ error: widgetError.message }, { status: 404 });
    }

    // Fetch widget data
    const { data: widgetData, error: dataError } = await supabase
      .from('ui_widget_data')
      .select('id, data, source_conversation_id, created_at, updated_at')
      .eq('widget_id', id)
      .order('created_at', { ascending: true });

    if (dataError) {
      console.error(`[Widget API] Error fetching widget data for ${id}:`, dataError);
    }

    // Type assertion for the nested relation (Supabase returns single relation as object, but TypeScript types it as array)
    const globalTagData = widget.global_tags as unknown as { tag: string; conversation_global_tags: { conversation_id: string }[] } | null;

    return NextResponse.json({
      widget: {
        id: widget.id,
        globalTagId: widget.global_tag_id,
        name: widget.name,
        description: widget.description,
        componentCode: widget.component_code,
        dataSchema: widget.data_schema,
        status: widget.status,
        errorMessage: widget.error_message,
        globalTag: globalTagData?.tag || 'Unknown',
        conversationIds: globalTagData?.conversation_global_tags?.map(
          (c) => c.conversation_id
        ) || [],
        createdAt: widget.created_at,
        updatedAt: widget.updated_at,
        codeHash: widget.code_hash,
      },
      dataItems: (widgetData as WidgetDataRow[] || []).map((item) => ({
        id: item.id,
        data: item.data,
        sourceConversationId: item.source_conversation_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    });
  } catch (error) {
    console.error('[Widget API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to fetch widget' }, { status: 500 });
  }
}

// PATCH: Update widget data or widget metadata (like last_opened_at)
export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { dataItems, updateLastOpened } = body as { 
      dataItems?: { id: string; data: Record<string, unknown> }[];
      updateLastOpened?: boolean;
    };

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const supabase = getSupabaseServerClient();

    // Verify widget exists
    const { data: widget, error: widgetError } = await supabase
      .from('ui_widgets')
      .select('id')
      .eq('id', id)
      .single();

    if (widgetError || !widget) {
      return NextResponse.json({ error: 'Widget not found' }, { status: 404 });
    }

    // Update last_opened_at if requested
    if (updateLastOpened) {
      const { error: updateError } = await supabase
        .from('ui_widgets')
        .update({ last_opened_at: new Date().toISOString() })
        .eq('id', id);

      if (updateError) {
        console.error(`[Widget API] Error updating last_opened_at for ${id}:`, updateError);
      }
    }

    // If no dataItems to update, just return success
    if (!dataItems || !Array.isArray(dataItems) || dataItems.length === 0) {
      return NextResponse.json({ success: true });
    }

    // Process each data item
    const results = [];
    for (const item of dataItems) {
      if (item.id.startsWith('new-')) {
        // Insert new item
        const { data: newItem, error: insertError } = await supabase
          .from('ui_widget_data')
          .insert({
            widget_id: id,
            data: item.data,
          })
          .select()
          .single();

        if (insertError) {
          console.error(`[Widget API] Error inserting data:`, insertError);
        } else {
          results.push({ id: newItem.id, data: newItem.data });
        }
      } else {
        // Update existing item
        const { data: updatedItem, error: updateError } = await supabase
          .from('ui_widget_data')
          .update({ data: item.data })
          .eq('id', item.id)
          .select()
          .single();

        if (updateError) {
          console.error(`[Widget API] Error updating data ${item.id}:`, updateError);
        } else {
          results.push({ id: updatedItem.id, data: updatedItem.data });
        }
      }
    }

    return NextResponse.json({ success: true, dataItems: results });
  } catch (error) {
    console.error('[Widget API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to update widget' }, { status: 500 });
  }
}

// DELETE: Delete widget data item OR entire widget
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const dataItemId = url.searchParams.get('dataItemId');
    const deleteWidget = url.searchParams.get('deleteWidget') === 'true';

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const supabase = getSupabaseServerClient();

    // Delete entire widget
    if (deleteWidget) {
      // First delete all widget data (CASCADE should handle this, but being explicit)
      await supabase
        .from('ui_widget_data')
        .delete()
        .eq('widget_id', id);

      // Delete the widget itself
      const { error } = await supabase
        .from('ui_widgets')
        .delete()
        .eq('id', id);

      if (error) {
        console.error(`[Widget API] Error deleting widget ${id}:`, error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, deleted: 'widget' });
    }

    // Delete widget data item
    if (!dataItemId) {
      return NextResponse.json({ error: 'dataItemId is required (or use deleteWidget=true to delete the widget)' }, { status: 400 });
    }

    const { error } = await supabase
      .from('ui_widget_data')
      .delete()
      .eq('id', dataItemId)
      .eq('widget_id', id);

    if (error) {
      console.error(`[Widget API] Error deleting data ${dataItemId}:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: 'dataItem' });
  } catch (error) {
    console.error('[Widget API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

