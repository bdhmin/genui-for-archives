import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WidgetRow = {
  id: string;
  global_tag_id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  thumbnail_url: string | null;
  code_hash: string | null;
  global_tags: {
    tag: string;
    conversation_global_tags: { conversation_id: string }[];
  };
};

export async function GET() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ widgets: [] });
    }

    const supabase = getSupabaseServerClient();

    // Fetch all widgets with their global tag info, sorted by last_opened_at
    const { data: widgets, error } = await supabase
      .from('ui_widgets')
      .select(`
        id,
        global_tag_id,
        name,
        description,
        status,
        created_at,
        updated_at,
        last_opened_at,
        thumbnail_url,
        code_hash,
        global_tags (
          tag,
          conversation_global_tags (
            conversation_id
          )
        )
      `)
      .order('last_opened_at', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('[Widgets API] Error fetching widgets:', error);
      if (error.message.includes('does not exist')) {
        return NextResponse.json({ widgets: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform the response
    const transformedWidgets = ((widgets as unknown as WidgetRow[]) || []).map((widget) => {
      // Type assertion for the nested relation (Supabase returns single relation as object)
      const globalTagData = widget.global_tags as unknown as { tag: string; conversation_global_tags: { conversation_id: string }[] } | null;
      return {
        id: widget.id,
        globalTagId: widget.global_tag_id,
        name: widget.name,
        description: widget.description,
        status: widget.status,
        globalTag: globalTagData?.tag || 'Unknown',
        conversationIds: globalTagData?.conversation_global_tags?.map(
          (c) => c.conversation_id
        ) || [],
        createdAt: widget.created_at,
        updatedAt: widget.updated_at,
        lastOpenedAt: widget.last_opened_at,
        thumbnailUrl: widget.thumbnail_url,
        codeHash: widget.code_hash,
      };
    });

    return NextResponse.json({ widgets: transformedWidgets });
  } catch (error) {
    console.error('[Widgets API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to fetch widgets' }, { status: 500 });
  }
}

