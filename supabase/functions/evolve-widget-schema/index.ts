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

interface SchemaEvolutionResult {
  schemaChanged: boolean;
  newSchema?: Record<string, unknown>;
  newComponentCode?: string;
  extractedData: unknown[];
}

interface WidgetData {
  id: string;
  data: Record<string, unknown>;
  source_conversation_id: string | null;
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

    // Format the conversation with date
    const formattedDate = new Date(conversation.created_at).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const isoDate = new Date(conversation.created_at).toISOString().split('T')[0];

    const conversationText = (messages as Message[])
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
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
2. Sample of existing data items
3. A new conversation to integrate

Your task:
1. Determine if the new conversation contains data that doesn't fit the current schema
2. If schema needs to change, propose the evolved schema that supports BOTH old and new data
3. Extract all relevant data from the new conversation

SCHEMA EVOLUTION RULES:
- Only evolve schema if truly necessary (new field types not currently supported)
- Keep all existing fields to maintain backward compatibility
- Add new optional fields for new data types
- Never remove or rename existing fields

Respond with JSON:
{
  "schemaChanged": boolean,
  "reason": "explanation of decision",
  "newSchema": { ...evolved schema if changed, null if not },
  "extractedData": [ ...data items from new conversation ]
}

Each extracted data item MUST have:
- "id": unique string
- "date": "${isoDate}" (the conversation date)
- All fields matching the current (or new) schema`,
          },
          {
            role: "user",
            content: `WIDGET: ${widget.name}
WIDGET DESCRIPTION: ${widget.description || 'No description'}

CURRENT DATA SCHEMA:
${JSON.stringify(widget.data_schema, null, 2)}

EXISTING DATA SAMPLE (${existingDataSample.length} items shown of ${currentWidgetData?.length || 0} total):
${JSON.stringify(existingDataSample, null, 2)}

NEW CONVERSATION (Date: ${formattedDate}):
${conversationText}

Analyze if schema evolution is needed and extract all relevant data from this conversation.`,
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
- Start with: function Widget({ data, onDataChange }) {
- End with: export default Widget;
- NO imports (React available globally)

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

      // Trigger update-widget-data for each conversation
      const updateDataUrl = `${supabaseUrl}/functions/v1/update-widget-data`;
      for (const convId of conversationIds) {
        fetch(updateDataUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ widget_id, conversation_id: convId }),
        }).catch(err => console.error(`[EvolveSchema] Error updating data for ${convId}:`, err));
      }

    } else {
      // Schema didn't change, just insert the new data
      if (analysis.extractedData && analysis.extractedData.length > 0) {
        const dataRows = analysis.extractedData.map((item: Record<string, unknown>) => ({
          widget_id,
          data: item,
          source_conversation_id: conversation_id,
        }));

        const { error: insertError } = await supabase
          .from("ui_widget_data")
          .insert(dataRows);

        if (insertError) {
          console.error("[EvolveSchema] Failed to insert data:", insertError);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        widgetId: widget_id,
        conversationId: conversation_id,
        schemaChanged: analysis.schemaChanged,
        newDataCount: analysis.extractedData?.length || 0,
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

