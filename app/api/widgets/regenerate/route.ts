import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for regenerating all widgets

export async function POST() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      );
    }

    const supabase = getSupabaseServerClient();

    // Fetch all widgets with their global_tag_id
    const { data: widgets, error: fetchError } = await supabase
      .from('ui_widgets')
      .select('id, global_tag_id, name')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('[Regenerate API] Error fetching widgets:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!widgets || widgets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No widgets to regenerate',
        regenerated: 0,
      });
    }

    console.log(`[Regenerate API] Found ${widgets.length} widgets to regenerate`);

    // Reset all widgets to "generating" status
    const { error: updateError } = await supabase
      .from('ui_widgets')
      .update({ status: 'generating', error_message: null })
      .in(
        'id',
        widgets.map((w) => w.id)
      );

    if (updateError) {
      console.error('[Regenerate API] Error updating widget statuses:', updateError);
    }

    const results: { id: string; name: string; success: boolean; error?: string }[] = [];

    // Regenerate each widget by calling the edge function
    for (const widget of widgets) {
      try {
        console.log(`[Regenerate API] Regenerating widget: ${widget.name} (${widget.id})`);

        // Call the Supabase Edge Function to regenerate
        const { error: invokeError } = await supabase.functions.invoke(
          'generate-widget-ui',
          {
            body: { global_tag_id: widget.global_tag_id },
          }
        );

        if (invokeError) {
          console.error(`[Regenerate API] Error regenerating ${widget.name}:`, invokeError);
          results.push({
            id: widget.id,
            name: widget.name,
            success: false,
            error: invokeError.message,
          });

          // Update widget status to error
          await supabase
            .from('ui_widgets')
            .update({ status: 'error', error_message: invokeError.message })
            .eq('id', widget.id);
        } else {
          results.push({
            id: widget.id,
            name: widget.name,
            success: true,
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Regenerate API] Exception regenerating ${widget.name}:`, err);
        results.push({
          id: widget.id,
          name: widget.name,
          success: false,
          error: errorMessage,
        });

        // Update widget status to error
        await supabase
          .from('ui_widgets')
          .update({ status: 'error', error_message: errorMessage })
          .eq('id', widget.id);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    console.log(
      `[Regenerate API] Completed: ${successCount} succeeded, ${failedCount} failed`
    );

    return NextResponse.json({
      success: true,
      message: `Regenerated ${successCount} widgets, ${failedCount} failed`,
      regenerated: successCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    console.error('[Regenerate API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate widgets' },
      { status: 500 }
    );
  }
}

