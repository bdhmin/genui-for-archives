import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
import { triggerRound1Tagging } from '@/lib/taggingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/widgets/add-conversation
 * 
 * Adds a conversation as a data source to an existing widget, or creates a new widget from the conversation.
 * 
 * Body:
 * - conversationId: string (required) - The conversation to add
 * - widgetId: string (optional) - Target widget. If omitted, creates a new widget.
 * 
 * Flow:
 * 1. Trigger Round 1 tagging for the conversation (if not already tagged)
 * 2. If widgetId provided:
 *    a. Link conversation to the widget's global tag
 *    b. Trigger schema evolution edge function
 * 3. If no widgetId:
 *    a. Trigger Round 2 tagging to create/find global tag
 *    b. Trigger widget generation
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { widgetId, conversationId } = body as { widgetId?: string; conversationId: string };

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
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

    // Verify conversation exists
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, title')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Check if conversation already has Round 1 tags
    const { data: existingTags } = await supabase
      .from('conversation_tags')
      .select('id')
      .eq('conversation_id', conversationId)
      .limit(1);

    // Trigger Round 1 tagging if no tags exist
    if (!existingTags || existingTags.length === 0) {
      console.log('[AddConversation] Triggering Round 1 tagging for:', conversationId);
      await triggerRound1Tagging(conversationId);
      // Small delay to let tagging complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (widgetId) {
      // Adding to existing widget
      console.log('[AddConversation] Adding conversation to existing widget:', widgetId);

      // Get widget and its global tag
      const { data: widget, error: widgetError } = await supabase
        .from('ui_widgets')
        .select('id, global_tag_id, status')
        .eq('id', widgetId)
        .single();

      if (widgetError || !widget) {
        return NextResponse.json(
          { error: 'Widget not found' },
          { status: 404 }
        );
      }

      // Link conversation to the widget's global tag
      const { error: linkError } = await supabase
        .from('conversation_global_tags')
        .upsert(
          { conversation_id: conversationId, global_tag_id: widget.global_tag_id },
          { onConflict: 'conversation_id,global_tag_id' }
        );

      if (linkError) {
        console.error('[AddConversation] Failed to link conversation to global tag:', linkError);
      }

      // Trigger schema evolution edge function
      const evolveUrl = `${process.env.SUPABASE_URL}/functions/v1/evolve-widget-schema`;
      const updateDataUrl = `${process.env.SUPABASE_URL}/functions/v1/update-widget-data`;
      
      let shouldUseFallback = false;
      
      try {
        const evolveResponse = await fetch(evolveUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            widget_id: widgetId,
            conversation_id: conversationId,
          }),
        });

        if (!evolveResponse.ok) {
          const errorText = await evolveResponse.text();
          console.error('[AddConversation] Schema evolution failed:', errorText);
          shouldUseFallback = true;
        } else {
          const evolveResult = await evolveResponse.json();
          console.log('[AddConversation] Schema evolution result:', evolveResult);
        }
      } catch (evolveError) {
        console.error('[AddConversation] Error calling evolve-widget-schema:', evolveError);
        shouldUseFallback = true;
      }
      
      // Fallback: use update-widget-data if evolve-widget-schema failed or doesn't exist
      if (shouldUseFallback) {
        console.log('[AddConversation] Using fallback update-widget-data');
        try {
          const updateResponse = await fetch(updateDataUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              widget_id: widgetId,
              conversation_id: conversationId,
            }),
          });
          
          if (updateResponse.ok) {
            const updateResult = await updateResponse.json();
            console.log('[AddConversation] update-widget-data result:', updateResult);
          } else {
            const errorText = await updateResponse.text();
            console.error('[AddConversation] update-widget-data failed:', errorText);
          }
        } catch (fallbackError) {
          console.error('[AddConversation] Fallback update-widget-data also failed:', fallbackError);
        }
      }

      console.log('[AddConversation] Successfully processed conversation for widget');
      return NextResponse.json({
        success: true,
        action: 'added_to_widget',
        widgetId,
        conversationId,
      });

    } else {
      // Creating new widget from conversation
      console.log('[AddConversation] Creating new widget from conversation:', conversationId);

      // First, trigger Round 2 to create/assign global tags
      const round2Url = `${process.env.SUPABASE_URL}/functions/v1/round-2-tags`;
      
      try {
        const round2Response = await fetch(round2Url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        if (!round2Response.ok) {
          const errorText = await round2Response.text();
          console.error('[AddConversation] Round 2 failed:', errorText);
        } else {
          const round2Result = await round2Response.json();
          console.log('[AddConversation] Round 2 result:', round2Result);
        }
      } catch (round2Error) {
        console.error('[AddConversation] Error calling round-2-tags:', round2Error);
      }

      // Wait a bit for widget generation to be triggered
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Find the widget that was created for this conversation
      const { data: conversationGlobalTags } = await supabase
        .from('conversation_global_tags')
        .select('global_tag_id')
        .eq('conversation_id', conversationId);

      let newWidgetId: string | null = null;
      if (conversationGlobalTags && conversationGlobalTags.length > 0) {
        const { data: newWidget } = await supabase
          .from('ui_widgets')
          .select('id')
          .eq('global_tag_id', conversationGlobalTags[0].global_tag_id)
          .single();
        
        newWidgetId = newWidget?.id || null;
      }

      return NextResponse.json({
        success: true,
        action: 'created_widget',
        widgetId: newWidgetId,
        conversationId,
      });
    }
  } catch (error) {
    console.error('[AddConversation] Unexpected error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add conversation' },
      { status: 500 }
    );
  }
}

