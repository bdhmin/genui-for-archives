// Tagging Service: Invokes Supabase Edge Functions for conversation tagging

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type ConversationTag = {
  id: string;
  conversation_id: string;
  tag: string;
  created_at: string;
  updated_at: string;
};

export type GlobalTag = {
  id: string;
  tag: string;
  created_at: string;
  conversation_global_tags?: { conversation_id: string }[];
};

export type Round1Response = {
  success: boolean;
  tags?: ConversationTag[];
  count?: number;
  error?: string;
};

export type Round2Response = {
  success: boolean;
  globalTags?: GlobalTag[];
  newTagsCount?: number;
  mappingsCount?: number;
  error?: string;
};

/**
 * Triggers Round 1 tagging for a specific conversation.
 * This generates 5-10 descriptive sentence tags for the conversation.
 * Automatically triggers Round 2 afterwards.
 */
export async function triggerRound1Tagging(conversationId: string): Promise<Round1Response> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured, skipping tagging");
    return { success: false, error: "Supabase not configured" };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/round-1-tags`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TaggingService] Round 1 failed:", errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as Round1Response;
    console.log("[TaggingService] Round 1 completed:", data);
    return data;
  } catch (error) {
    console.error("[TaggingService] Round 1 error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Triggers Round 2 tagging to generate global/pattern tags.
 * This analyzes all conversation tags and creates higher-level categories.
 */
export async function triggerRound2Tagging(): Promise<Round2Response> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured, skipping tagging");
    return { success: false, error: "Supabase not configured" };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/round-2-tags`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TaggingService] Round 2 failed:", errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as Round2Response;
    console.log("[TaggingService] Round 2 completed:", data);
    return data;
  } catch (error) {
    console.error("[TaggingService] Round 2 error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Triggers the full tagging pipeline for a conversation.
 * This is a convenience function that runs both rounds.
 * Note: Round 1 automatically triggers Round 2, so this is mainly for explicit control.
 */
export async function triggerFullTagging(conversationId: string): Promise<{
  round1: Round1Response;
  round2?: Round2Response;
}> {
  const round1Result = await triggerRound1Tagging(conversationId);
  
  // Round 2 is triggered automatically by Round 1, but we can also get its result
  // if we want to wait for it explicitly
  if (round1Result.success) {
    // Small delay to let Round 2 start processing
    await new Promise(resolve => setTimeout(resolve, 100));
    const round2Result = await triggerRound2Tagging();
    return { round1: round1Result, round2: round2Result };
  }

  return { round1: round1Result };
}

