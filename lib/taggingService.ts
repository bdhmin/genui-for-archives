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
  console.log("[TaggingService] Triggering Round 1 for conversation:", conversationId);
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured, skipping tagging");
    console.warn("[TaggingService] SUPABASE_URL:", SUPABASE_URL ? "set" : "NOT SET");
    console.warn("[TaggingService] SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_SERVICE_KEY ? "set" : "NOT SET");
    return { success: false, error: "Supabase not configured" };
  }

  const url = `${SUPABASE_URL}/functions/v1/round-1-tags`;
  console.log("[TaggingService] Calling edge function:", url);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversation_id: conversationId }),
    });

    console.log("[TaggingService] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TaggingService] Round 1 failed:", response.status, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as Round1Response;
    console.log("[TaggingService] Round 1 completed successfully:", JSON.stringify(data, null, 2));
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

export type LinkConversationToWidgetResponse = {
  success: boolean;
  globalTagId?: string;
  error?: string;
};

/**
 * Links a conversation to a widget's global tag.
 * This is used when manually adding a conversation as a data source for a widget.
 */
export async function linkConversationToWidget(
  conversationId: string,
  widgetId: string
): Promise<LinkConversationToWidgetResponse> {
  console.log("[TaggingService] Linking conversation to widget:", { conversationId, widgetId });
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured");
    return { success: false, error: "Supabase not configured" };
  }

  try {
    // First, get the widget's global_tag_id
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: widget, error: widgetError } = await supabase
      .from("ui_widgets")
      .select("global_tag_id")
      .eq("id", widgetId)
      .single();

    if (widgetError || !widget) {
      console.error("[TaggingService] Widget not found:", widgetError);
      return { success: false, error: "Widget not found" };
    }

    // Link conversation to the global tag
    const { error: linkError } = await supabase
      .from("conversation_global_tags")
      .upsert(
        { conversation_id: conversationId, global_tag_id: widget.global_tag_id },
        { onConflict: "conversation_id,global_tag_id" }
      );

    if (linkError) {
      console.error("[TaggingService] Failed to link conversation:", linkError);
      return { success: false, error: linkError.message };
    }

    console.log("[TaggingService] Successfully linked conversation to widget");
    return { success: true, globalTagId: widget.global_tag_id };
  } catch (error) {
    console.error("[TaggingService] Error linking conversation:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export type TriggerSchemaEvolutionResponse = {
  success: boolean;
  schemaChanged?: boolean;
  newDataCount?: number;
  error?: string;
};

/**
 * Triggers the schema evolution edge function for a widget.
 * This analyzes new conversation data and evolves the widget schema if needed.
 */
export async function triggerSchemaEvolution(
  widgetId: string,
  conversationId: string
): Promise<TriggerSchemaEvolutionResponse> {
  console.log("[TaggingService] Triggering schema evolution:", { widgetId, conversationId });
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured");
    return { success: false, error: "Supabase not configured" };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/evolve-widget-schema`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ widget_id: widgetId, conversation_id: conversationId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[TaggingService] Schema evolution failed:", errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json() as TriggerSchemaEvolutionResponse;
    console.log("[TaggingService] Schema evolution completed:", data);
    return data;
  } catch (error) {
    console.error("[TaggingService] Schema evolution error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

