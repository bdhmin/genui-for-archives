import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationTagRow = {
  id: string;
  conversation_id: string;
  tag: string;
  created_at: string;
  updated_at: string;
};

type ConversationRow = {
  id: string;
  title: string;
};

export async function GET() {
  try {
    // Check if Supabase is configured
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ conversationTags: [] });
    }

    const supabase = getSupabaseServerClient();

    // Fetch all conversation tags
    const { data: tags, error: tagsError } = await supabase
      .from("conversation_tags")
      .select("*")
      .order("created_at", { ascending: false });

    if (tagsError) {
      console.error("[ConversationTags API] Error fetching tags:", tagsError);
      if (tagsError.message.includes("does not exist")) {
        return NextResponse.json({ conversationTags: [] });
      }
      return NextResponse.json({ error: tagsError.message }, { status: 500 });
    }

    // Get unique conversation IDs
    const conversationIds = [...new Set((tags as ConversationTagRow[]).map(t => t.conversation_id))];

    // Fetch conversation titles
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, title")
      .in("id", conversationIds);

    const conversationMap = new Map(
      (conversations as ConversationRow[] || []).map(c => [c.id, c.title])
    );

    // Group tags by conversation
    const groupedTags = (tags as ConversationTagRow[]).reduce((acc, tag) => {
      const convId = tag.conversation_id;
      if (!acc[convId]) {
        acc[convId] = {
          conversationId: convId,
          conversationTitle: conversationMap.get(convId) || "Untitled",
          tags: [],
        };
      }
      acc[convId].tags.push({
        id: tag.id,
        tag: tag.tag,
        createdAt: tag.created_at,
      });
      return acc;
    }, {} as Record<string, { conversationId: string; conversationTitle: string; tags: { id: string; tag: string; createdAt: string }[] }>);

    return NextResponse.json({
      conversationTags: Object.values(groupedTags),
      totalTags: tags?.length || 0,
    });
  } catch (error) {
    console.error("[ConversationTags API] Unexpected error:", error);
    return NextResponse.json({ error: "Failed to fetch tags" }, { status: 500 });
  }
}

