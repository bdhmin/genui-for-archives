import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GlobalTagRow = {
  id: string;
  tag: string;
  created_at: string;
  conversation_global_tags: { conversation_id: string }[];
};

export async function GET() {
  try {
    // Check if Supabase is configured
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Return empty array if Supabase is not configured
      return NextResponse.json({ globalTags: [] });
    }

    const supabase = getSupabaseServerClient();

    // Fetch global tags with their conversation mappings
    const { data: globalTags, error } = await supabase
      .from("global_tags")
      .select(`
        id,
        tag,
        created_at,
        conversation_global_tags (
          conversation_id
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Tags API] Error fetching global tags:", error);
      // If tables don't exist yet, return empty array
      if (error.message.includes("does not exist")) {
        return NextResponse.json({ globalTags: [] });
      }
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      globalTags: (globalTags as GlobalTagRow[]) ?? [],
    });
  } catch (error) {
    console.error("[Tags API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to fetch tags" },
      { status: 500 }
    );
  }
}

