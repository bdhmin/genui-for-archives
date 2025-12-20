// Supabase Edge Function: evolve-widget-schema
// Analyzes new conversation data and evolves widget schema if needed
// Extracts data from the new conversation and optionally regenerates UI
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

interface DataOperation {
  action: "add" | "update" | "delete";
  data?: Record<string, unknown>;
  targetDate?: string;
  targetType?: string;
  reason: string;
}

interface SchemaEvolutionResult {
  schemaChanged: boolean;
  newSchema?: Record<string, unknown>;
  newComponentCode?: string;
  operations: DataOperation[];
}

interface WidgetData {
  id: string;
  data: Record<string, unknown>;
  source_conversation_id: string | null;
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

    // Fetch the widget with its current schema and code
    const { data: widget, error: widgetError } = await supabase
      .from("ui_widgets")
      .select("id, name, description, data_schema, component_code, status, global_tag_id")
      .eq("id", widget_id)
      .single();

    if (widgetError || !widget) {
      return new Response(
        JSON.stringify({ success: false, error: `Widget not found: ${widgetError?.message}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
          existingCount: existingData.length,
          schemaChanged: false
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
        JSON.stringify({ success: true, message: "No messages in conversation", newDataCount: 0, schemaChanged: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch existing widget data for context
    const { data: currentWidgetData } = await supabase
      .from("ui_widget_data")
      .select("id, data, source_conversation_id")
      .eq("widget_id", widget_id)
      .limit(10);

    // Include timestamps in conversation text so AI can see exactly when each message was sent
    // Use Pacific timezone to match user's local time
    const conversationText = (messages as Message[])
      .map(m => {
        const msgDate = new Date(m.created_at);
        const msgDateStr = formatDateTimeInPacific(msgDate);
        return `[${msgDateStr}] ${m.role.toUpperCase()}: ${m.content}`;
      })
      .join("\n");

    // Sample of existing data for schema understanding
    const existingDataSample = (currentWidgetData as WidgetData[] || [])
      .slice(0, 5)
      .map(d => d.data);

    // Step 1: Analyze if schema needs to evolve
    const analysisResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `You are a data schema analyst. Analyze if a new conversation requires expanding an existing widget's data schema.

You will receive:
1. The widget's current data schema
2. Existing data items in the widget
3. A new conversation to integrate with TIMESTAMPS on each message

Your tasks:
1. Determine if the new conversation contains data that doesn't fit the current schema
2. If schema needs to change, propose the evolved schema that supports BOTH old and new data
3. Determine what data operations are needed (add, update, or delete)

SCHEMA EVOLUTION RULES:
- Only evolve schema if truly necessary (new field types not currently supported)
- Keep all existing fields to maintain backward compatibility
- Add new optional fields for new data types
- Never remove or rename existing fields

DATE RESOLUTION RULES (CRITICAL):
- LOOK AT THE TIMESTAMP on each message to determine the correct date
- Each message has a timestamp like "[Mon, Dec 15, 2025, 8:30 PM]" - use THIS date for events mentioned in that message
- If a message from Dec 15 mentions "today" or "tonight", the date should be 2025-12-15
- ALWAYS use the date shown in the message timestamp, NOT any other reference date

DATA OPERATIONS:
You can specify three types of operations:
1. "add" - Add new data items
2. "update" - Modify existing data items (match by date + type/category)
3. "delete" - Remove existing data items that are incorrect or no longer valid

Respond with JSON:
{
  "schemaChanged": boolean,
  "reason": "explanation of schema decision",
  "newSchema": { ...evolved schema if changed, null if not },
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

Be aggressive about correcting data - if the user says something that contradicts existing data, delete or update it!`,
          },
          {
            role: "user",
            content: `WIDGET: ${widget.name}
WIDGET DESCRIPTION: ${widget.description || 'No description'}

CURRENT DATA SCHEMA:
${JSON.stringify(widget.data_schema, null, 2)}

EXISTING DATA (${currentWidgetData?.length || 0} items):
${JSON.stringify(existingDataSample, null, 2)}

NEW CONVERSATION (each message has a timestamp showing when it was sent):
${conversationText}

Analyze if schema evolution is needed and determine what data operations are needed.
- If the user mentions new data, ADD it
- If the user corrects or updates something, UPDATE or DELETE the old entry
- If the user says they made a mistake or didn't do something, DELETE the incorrect entry
- USE THE DATE FROM EACH MESSAGE'S TIMESTAMP for date fields`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const analysisData = await analysisResponse.json();
    const analysisContent = analysisData.choices[0]?.message?.content;

    if (!analysisContent) {
      throw new Error("No content in analysis response");
    }

    const analysis: SchemaEvolutionResult = JSON.parse(analysisContent);
    console.log("[EvolveSchema] Analysis result:", { 
      schemaChanged: analysis.schemaChanged, 
      dataCount: analysis.extractedData?.length || 0 
    });

    // Step 2: If schema changed, regenerate the component code
    if (analysis.schemaChanged && analysis.newSchema) {
      console.log("[EvolveSchema] Schema changed, regenerating component code");

      // Fetch all linked conversations to get full context for regeneration
      const { data: linkedConversations } = await supabase
        .from("conversation_global_tags")
        .select("conversation_id")
        .eq("global_tag_id", widget.global_tag_id);

      const conversationIds = linkedConversations?.map(l => l.conversation_id) || [];

      // Fetch all conversation tags for context
      const { data: conversationTags } = await supabase
        .from("conversation_tags")
        .select("tag, conversation_id")
        .in("conversation_id", conversationIds);

      const tagsList = (conversationTags || [])
        .map(t => `- ${t.tag}`)
        .join("\n");

      // Regenerate component code with evolved schema
      const regenResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a React component generator. Update a widget component to support an evolved data schema.

The component must:
- Work with BOTH old data (following old schema) AND new data (following new schema)
- Handle optional/missing fields gracefully
- Maintain the same visual style and user experience
- Use ONLY React hooks and Tailwind CSS

DESIGN SYSTEM (must follow exactly):
- Background: bg-zinc-900
- Cards/elevated: bg-zinc-800, bg-zinc-800/30
- Borders: border-zinc-700, border-zinc-700/50
- Text primary: text-zinc-100, text-zinc-50
- Text secondary: text-zinc-400
- Text muted: text-zinc-500
- Accent: amber-500, amber-600
- Rounded corners: rounded-lg, rounded-xl
- Use flat design - separate with borders not backgrounds

Component format:
- Start with imports: import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
- Then: function Widget({ data, onDataChange }) {
- End with: export default Widget;
- ONLY import lucide-react for icons (React available globally)
- NEVER use emoji or text symbols for icons - ALWAYS use Lucide icons
- Icon sizing: className="w-4 h-4" (small), "w-5 h-5" (medium)

Respond with ONLY the component code, no markdown fences or explanation.`,
            },
            {
              role: "user",
              content: `WIDGET: ${widget.name}

OLD SCHEMA:
${JSON.stringify(widget.data_schema, null, 2)}

NEW EVOLVED SCHEMA:
${JSON.stringify(analysis.newSchema, null, 2)}

CURRENT COMPONENT CODE:
${widget.component_code}

CONTEXT TAGS:
${tagsList}

Update the component to support the evolved schema while maintaining backward compatibility with existing data.`,
            },
          ],
          temperature: 0.4,
        }),
      });

      if (!regenResponse.ok) {
        const errorText = await regenResponse.text();
        throw new Error(`Component regeneration failed: ${errorText}`);
      }

      const regenData = await regenResponse.json();
      const newComponentCode = regenData.choices[0]?.message?.content?.trim() || "";

      // Update widget with new schema and component code
      const { error: updateError } = await supabase
        .from("ui_widgets")
        .update({
          data_schema: analysis.newSchema,
          component_code: newComponentCode || widget.component_code,
          updated_at: new Date().toISOString(),
        })
        .eq("id", widget_id);

      if (updateError) {
        console.error("[EvolveSchema] Failed to update widget:", updateError);
      }

      // Re-extract data from ALL linked conversations with new schema
      // (This ensures all data conforms to the evolved schema)
      console.log("[EvolveSchema] Re-extracting data from all conversations with new schema");
      
      // Delete all existing data
      await supabase
        .from("ui_widget_data")
        .delete()
        .eq("widget_id", widget_id);

      // Trigger update-widget-data for each conversation with staggered delays
      // to avoid overwhelming the worker pool
      const updateDataUrl = `${supabaseUrl}/functions/v1/update-widget-data`;
      const DELAY_BETWEEN_CALLS_MS = 500; // 500ms between each call
      
      for (let i = 0; i < conversationIds.length; i++) {
        const convId = conversationIds[i];
        // Use setTimeout to stagger the calls
        setTimeout(() => {
          fetch(updateDataUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ widget_id, conversation_id: convId }),
          }).catch(err => console.error(`[EvolveSchema] Error updating data for ${convId}:`, err));
        }, i * DELAY_BETWEEN_CALLS_MS);
      }

    } else {
      // Schema didn't change, process data operations
      if (analysis.operations && analysis.operations.length > 0) {
        // Fetch all existing widget data for matching
        const { data: allExistingData } = await supabase
          .from("ui_widget_data")
          .select("id, data")
          .eq("widget_id", widget_id);

        // Helper to find matching entry
        const findMatchingEntry = (targetDate: string, targetType?: string) => {
          return (allExistingData || []).find((existing: { id: string; data: Record<string, unknown> }) => {
            const existingDate = (existing.data?.date as string) || "";
            if (existingDate !== targetDate) return false;
            
            if (targetType) {
              const typeFields = ["type", "category", "meal", "mealType", "name"];
              for (const field of typeFields) {
                if (existing.data?.[field] === targetType) return true;
              }
              return false;
            }
            return true;
          });
        };

        let addedCount = 0, updatedCount = 0, deletedCount = 0;

        for (const op of analysis.operations) {
          try {
            if (op.action === "delete") {
              const targetDate = op.targetDate || (op.data?.date as string);
              if (targetDate) {
                const matchingEntry = findMatchingEntry(targetDate, op.targetType);
                if (matchingEntry) {
                  await supabase.from("ui_widget_data").delete().eq("id", matchingEntry.id);
                  deletedCount++;
                  const idx = allExistingData?.indexOf(matchingEntry);
                  if (idx !== undefined && idx > -1) allExistingData?.splice(idx, 1);
                }
              }
            } else if (op.action === "update") {
              const targetDate = op.targetDate || (op.data?.date as string);
              if (targetDate && op.data) {
                const matchingEntry = findMatchingEntry(targetDate, op.targetType);
                if (matchingEntry) {
                  await supabase.from("ui_widget_data").update({
                    data: op.data,
                    source_conversation_id: conversation_id,
                    updated_at: new Date().toISOString(),
                  }).eq("id", matchingEntry.id);
                  updatedCount++;
                } else {
                  await supabase.from("ui_widget_data").insert({
                    widget_id,
                    data: op.data,
                    source_conversation_id: conversation_id,
                  });
                  addedCount++;
                }
              }
            } else if (op.action === "add" && op.data) {
              await supabase.from("ui_widget_data").insert({
                widget_id,
                data: op.data,
                source_conversation_id: conversation_id,
              });
              addedCount++;
            }
          } catch (err) {
            console.error(`[EvolveSchema] Error processing operation:`, err);
          }
        }

        console.log(`[EvolveSchema] Operations completed: added=${addedCount}, updated=${updatedCount}, deleted=${deletedCount}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        widgetId: widget_id,
        conversationId: conversation_id,
        schemaChanged: analysis.schemaChanged,
        operationsCount: analysis.operations?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in evolve-widget-schema:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

