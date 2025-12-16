// Supabase Edge Function: update-widget-data
// Extracts data from a new conversation and appends to an existing widget
// Deno runtime

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Message {
  role: string;
  content: string;
  created_at: string;
}

interface WidgetData {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Format a date with time in US Pacific timezone for display
 * Supabase edge functions run in UTC, so we explicitly use America/Los_Angeles timezone
 */
function formatDateTimeInPacific(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(date);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { widget_id, conversation_id } = await req.json();

    if (!widget_id || !conversation_id) {
      return new Response(
        JSON.stringify({ success: false, error: "widget_id and conversation_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the widget to get its data schema
    const { data: widget, error: widgetError } = await supabase
      .from("ui_widgets")
      .select("id, name, data_schema, status")
      .eq("id", widget_id)
      .single();

    if (widgetError || !widget) {
      return new Response(
        JSON.stringify({ success: false, error: `Widget not found: ${widgetError?.message}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (widget.status !== "active") {
      return new Response(
        JSON.stringify({ success: false, error: "Widget is not active yet" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if we already have data from this conversation
    const { data: existingData } = await supabase
      .from("ui_widget_data")
      .select("id")
      .eq("widget_id", widget_id)
      .eq("source_conversation_id", conversation_id);

    if (existingData && existingData.length > 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Data from this conversation already exists",
          existingCount: existingData.length 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch conversation metadata
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, title, created_at")
      .eq("id", conversation_id)
      .single();

    if (!conversation) {
      return new Response(
        JSON.stringify({ success: false, error: "Conversation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch messages from this conversation
    const { data: messages } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No messages in conversation", newDataCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Include timestamps in conversation text so AI can see exactly when each message was sent
    // Use Pacific timezone to match user's local time
    const conversationText = (messages as Message[])
      .map(m => {
        const msgDate = new Date(m.created_at);
        const msgDateStr = formatDateTimeInPacific(msgDate);
        return `[${msgDateStr}] ${m.role.toUpperCase()}: ${m.content}`;
      })
      .join("\n");

    // Call OpenAI to extract data matching the widget's schema
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a data extraction assistant. Your task is to extract data from a conversation that matches a specific schema.

You will receive:
1. A widget name (the type of data being tracked)
2. A data schema (the structure each item must follow)
3. A conversation with TIMESTAMPS on each message showing exactly when it was sent
4. Existing data items currently in the widget (if any)

Your job is to determine what data operations are needed based on the conversation.

DATE RESOLUTION RULES (CRITICAL):
- LOOK AT THE TIMESTAMP on each message to determine the correct date
- Each message has a timestamp like "[Mon, Dec 15, 2025, 8:30 PM]" - use THIS date for events mentioned in that message
- If a message from Dec 15 mentions "today" or "tonight", the date should be 2025-12-15
- If a message from Dec 15 mentions "yesterday", the date should be 2025-12-14
- ALWAYS use the date shown in the message timestamp, NOT any other reference date

DATA OPERATIONS:
You can specify three types of operations:
1. "add" - Add new data items
2. "update" - Modify existing data items (match by date + type/category)
3. "delete" - Remove existing data items that are incorrect or no longer valid

Respond with JSON:
{
  "operations": [
    {
      "action": "add" | "update" | "delete",
      "data": { ...data matching schema... },
      "targetDate": "YYYY-MM-DD",
      "targetType": "optional field like meal type to match",
      "reason": "why this operation"
    }
  ]
}

For "delete" operations, you only need targetDate and optionally targetType to identify what to delete.
For "update" operations, provide the full new data that should replace the matching entry.
For "add" operations, provide the complete new data item.

Be aggressive about correcting data - if the user says something that contradicts existing data, delete or update it!`,
          },
          {
            role: "user",
            content: `Analyze this conversation for the "${widget.name}" widget and determine what data operations are needed.

DATA SCHEMA:
${JSON.stringify(widget.data_schema, null, 2)}

EXISTING DATA IN WIDGET:
${existingData && existingData.length > 0 ? JSON.stringify(existingData.map((d: {id: string}) => d), null, 2) : "No existing data"}

CONVERSATION (each message has a timestamp showing when it was sent):
${conversationText}

Determine what operations are needed:
- If the user mentions new data, ADD it
- If the user corrects or updates something (e.g., "actually I had pizza, not salad"), UPDATE or DELETE the old entry
- If the user says they didn't do something or made a mistake, DELETE the incorrect entry
- USE THE DATE FROM EACH MESSAGE'S TIMESTAMP for the date field

Be willing to DELETE incorrect data and UPDATE existing entries when the conversation indicates corrections or changes.`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const openaiData = await openaiResponse.json();
    const generatedContent = openaiData.choices[0]?.message?.content;

    if (!generatedContent) {
      throw new Error("No content in OpenAI response");
    }

    const parsed = JSON.parse(generatedContent);
    const operations = parsed.operations || [];

    if (operations.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No data operations needed", counts: { added: 0, updated: 0, deleted: 0 } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all existing widget data for matching
    const { data: allExistingData } = await supabase
      .from("ui_widget_data")
      .select("id, data")
      .eq("widget_id", widget_id);

    let addedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    const results: { action: string; success: boolean; reason: string }[] = [];

    // Helper to find matching entry
    const findMatchingEntry = (targetDate: string, targetType?: string) => {
      return (allExistingData || []).find((existing: { id: string; data: Record<string, unknown> }) => {
        const existingDate = (existing.data?.date as string) || "";
        if (existingDate !== targetDate) return false;
        
        if (targetType) {
          // Check common type fields
          const typeFields = ["type", "category", "meal", "mealType", "name"];
          for (const field of typeFields) {
            if (existing.data?.[field] === targetType) return true;
          }
          return false;
        }
        return true;
      });
    };

    for (const op of operations as { action: string; data?: Record<string, unknown>; targetDate?: string; targetType?: string; reason: string }[]) {
      try {
        if (op.action === "delete") {
          // Delete operation
          const targetDate = op.targetDate || (op.data?.date as string);
          if (!targetDate) {
            results.push({ action: "delete", success: false, reason: "No target date specified" });
            continue;
          }
          
          const matchingEntry = findMatchingEntry(targetDate, op.targetType);
          if (matchingEntry) {
            const { error } = await supabase
              .from("ui_widget_data")
              .delete()
              .eq("id", matchingEntry.id);
            
            if (!error) {
              deletedCount++;
              results.push({ action: "delete", success: true, reason: op.reason });
              // Remove from allExistingData so we don't match it again
              const idx = allExistingData?.indexOf(matchingEntry);
              if (idx !== undefined && idx > -1) allExistingData?.splice(idx, 1);
            } else {
              results.push({ action: "delete", success: false, reason: error.message });
            }
          } else {
            results.push({ action: "delete", success: false, reason: "No matching entry found to delete" });
          }
          
        } else if (op.action === "update") {
          // Update operation
          const targetDate = op.targetDate || (op.data?.date as string);
          if (!targetDate || !op.data) {
            results.push({ action: "update", success: false, reason: "Missing target date or data" });
            continue;
          }
          
          const matchingEntry = findMatchingEntry(targetDate, op.targetType);
          if (matchingEntry) {
            const { error } = await supabase
              .from("ui_widget_data")
              .update({
                data: op.data,
                source_conversation_id: conversation_id,
                updated_at: new Date().toISOString(),
              })
              .eq("id", matchingEntry.id);
            
            if (!error) {
              updatedCount++;
              results.push({ action: "update", success: true, reason: op.reason });
            } else {
              results.push({ action: "update", success: false, reason: error.message });
            }
          } else {
            // No existing entry to update, insert as new
            const { error } = await supabase
              .from("ui_widget_data")
              .insert({
                widget_id,
                data: op.data,
                source_conversation_id: conversation_id,
              });
            
            if (!error) {
              addedCount++;
              results.push({ action: "add (no match to update)", success: true, reason: op.reason });
            } else {
              results.push({ action: "update->add", success: false, reason: error.message });
            }
          }
          
        } else if (op.action === "add") {
          // Add operation
          if (!op.data) {
            results.push({ action: "add", success: false, reason: "No data provided" });
            continue;
          }
          
          const { error } = await supabase
            .from("ui_widget_data")
            .insert({
              widget_id,
              data: op.data,
              source_conversation_id: conversation_id,
            });
          
          if (!error) {
            addedCount++;
            results.push({ action: "add", success: true, reason: op.reason });
          } else {
            results.push({ action: "add", success: false, reason: error.message });
          }
        }
      } catch (err) {
        results.push({ action: op.action, success: false, reason: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        widgetId: widget_id,
        conversationId: conversation_id,
        counts: { added: addedCount, updated: updatedCount, deleted: deletedCount },
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in update-widget-data:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

