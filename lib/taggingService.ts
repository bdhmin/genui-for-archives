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

export type UpdateLinkedWidgetsResponse = {
  success: boolean;
  widgetsUpdated: number;
  errors?: string[];
};

export type LinkedWidgetContext = {
  id: string;
  name: string;
  description: string | null;
  dataSchema: Record<string, unknown>;
  recentData: Record<string, unknown>[];
};

export type GetLinkedWidgetsContextResponse = {
  success: boolean;
  widgets: LinkedWidgetContext[];
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

/**
 * Updates all widgets that are linked to a conversation.
 * This should be called after a conversation is updated to ensure all linked widgets
 * have their data refreshed with the latest conversation content.
 */
export async function updateLinkedWidgets(
  conversationId: string
): Promise<UpdateLinkedWidgetsResponse> {
  console.log("[TaggingService] Updating linked widgets for conversation:", conversationId);
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured");
    return { success: false, widgetsUpdated: 0, errors: ["Supabase not configured"] };
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find all global tags linked to this conversation
    const { data: conversationGlobalTags, error: linkError } = await supabase
      .from("conversation_global_tags")
      .select("global_tag_id")
      .eq("conversation_id", conversationId);

    if (linkError) {
      console.error("[TaggingService] Failed to fetch conversation global tags:", linkError);
      return { success: false, widgetsUpdated: 0, errors: [linkError.message] };
    }

    if (!conversationGlobalTags || conversationGlobalTags.length === 0) {
      console.log("[TaggingService] No widgets linked to this conversation");
      return { success: true, widgetsUpdated: 0 };
    }

    const globalTagIds = conversationGlobalTags.map(t => t.global_tag_id);

    // Find all widgets for these global tags
    const { data: widgets, error: widgetError } = await supabase
      .from("ui_widgets")
      .select("id, status")
      .in("global_tag_id", globalTagIds)
      .eq("status", "active");

    if (widgetError) {
      console.error("[TaggingService] Failed to fetch widgets:", widgetError);
      return { success: false, widgetsUpdated: 0, errors: [widgetError.message] };
    }

    if (!widgets || widgets.length === 0) {
      console.log("[TaggingService] No active widgets found for linked global tags");
      return { success: true, widgetsUpdated: 0 };
    }

    console.log(`[TaggingService] Found ${widgets.length} linked widget(s) to update`);

    // Update each widget with the conversation data
    const errors: string[] = [];
    let updatedCount = 0;

    for (const widget of widgets) {
      try {
        // Use update-widget-data edge function to extract and add data
        const updateResponse = await fetch(`${SUPABASE_URL}/functions/v1/update-widget-data`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ 
            widget_id: widget.id, 
            conversation_id: conversationId 
          }),
        });

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          console.error(`[TaggingService] Failed to update widget ${widget.id}:`, errorText);
          errors.push(`Widget ${widget.id}: ${errorText}`);
        } else {
          const result = await updateResponse.json();
          console.log(`[TaggingService] Widget ${widget.id} update result:`, result);
          updatedCount++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[TaggingService] Error updating widget ${widget.id}:`, err);
        errors.push(`Widget ${widget.id}: ${message}`);
      }
    }

    return {
      success: errors.length === 0,
      widgetsUpdated: updatedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error("[TaggingService] Error in updateLinkedWidgets:", error);
    return {
      success: false,
      widgetsUpdated: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

/**
 * Fetches all widgets linked to a conversation along with their schemas and recent data.
 * This is used to provide context to the AI during chat for proactive data population.
 */
export async function getLinkedWidgetsContext(
  conversationId: string
): Promise<GetLinkedWidgetsContextResponse> {
  console.log("[TaggingService] Getting linked widgets context for conversation:", conversationId);
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn("[TaggingService] Supabase env vars not configured");
    return { success: false, widgets: [], error: "Supabase not configured" };
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Find all global tags linked to this conversation
    const { data: conversationGlobalTags, error: linkError } = await supabase
      .from("conversation_global_tags")
      .select("global_tag_id")
      .eq("conversation_id", conversationId);

    if (linkError) {
      console.error("[TaggingService] Failed to fetch conversation global tags:", linkError);
      return { success: false, widgets: [], error: linkError.message };
    }

    if (!conversationGlobalTags || conversationGlobalTags.length === 0) {
      console.log("[TaggingService] No widgets linked to this conversation");
      return { success: true, widgets: [] };
    }

    const globalTagIds = conversationGlobalTags.map(t => t.global_tag_id);

    // Find all active widgets for these global tags
    const { data: widgets, error: widgetError } = await supabase
      .from("ui_widgets")
      .select("id, name, description, data_schema")
      .in("global_tag_id", globalTagIds)
      .eq("status", "active");

    if (widgetError) {
      console.error("[TaggingService] Failed to fetch widgets:", widgetError);
      return { success: false, widgets: [], error: widgetError.message };
    }

    if (!widgets || widgets.length === 0) {
      console.log("[TaggingService] No active widgets found for linked global tags");
      return { success: true, widgets: [] };
    }

    console.log(`[TaggingService] Found ${widgets.length} linked widget(s)`);

    // Fetch recent data for each widget
    const widgetContexts: LinkedWidgetContext[] = [];

    for (const widget of widgets) {
      const { data: widgetData, error: dataError } = await supabase
        .from("ui_widget_data")
        .select("data")
        .eq("widget_id", widget.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (dataError) {
        console.error(`[TaggingService] Failed to fetch data for widget ${widget.id}:`, dataError);
      }

      widgetContexts.push({
        id: widget.id,
        name: widget.name,
        description: widget.description,
        dataSchema: widget.data_schema as Record<string, unknown>,
        recentData: (widgetData || []).map(d => d.data as Record<string, unknown>),
      });
    }

    return {
      success: true,
      widgets: widgetContexts,
    };
  } catch (error) {
    console.error("[TaggingService] Error in getLinkedWidgetsContext:", error);
    return {
      success: false,
      widgets: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

