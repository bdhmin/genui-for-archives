// Supabase Edge Function: generate-widget-ui
// Generates a React component and extracts data for a global tag widget
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
  conversation_id: string;
  created_at: string;
}

interface ConversationInfo {
  id: string;
  title: string;
  created_at: string;
}

interface ConversationTag {
  id: string;
  tag: string;
  conversation_id: string;
}

interface WidgetSpec {
  name: string;
  description: string;
  dataSchema: Record<string, unknown>;
  componentCode: string;
  initialData: unknown[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { global_tag_id } = await req.json();

    if (!global_tag_id) {
      return new Response(
        JSON.stringify({ success: false, error: "global_tag_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if widget already exists and is not in error state
    const { data: existingWidget } = await supabase
      .from("ui_widgets")
      .select("id, status")
      .eq("global_tag_id", global_tag_id)
      .single();

    if (existingWidget && existingWidget.status === "active") {
      return new Response(
        JSON.stringify({ success: true, message: "Widget already exists", widgetId: existingWidget.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the global tag
    const { data: globalTag, error: tagError } = await supabase
      .from("global_tags")
      .select("id, tag")
      .eq("id", global_tag_id)
      .single();

    if (tagError || !globalTag) {
      throw new Error(`Global tag not found: ${tagError?.message || "unknown"}`);
    }

    // Fetch linked conversation tags
    const { data: conversationLinks } = await supabase
      .from("conversation_global_tags")
      .select("conversation_id")
      .eq("global_tag_id", global_tag_id);

    const conversationIds = conversationLinks?.map(l => l.conversation_id) || [];

    // Fetch all conversation tags for context
    const { data: conversationTags } = await supabase
      .from("conversation_tags")
      .select("id, tag, conversation_id")
      .in("conversation_id", conversationIds);

    // Fetch conversation metadata (titles and dates)
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, title, created_at")
      .in("id", conversationIds)
      .order("created_at", { ascending: true });

    // Fetch conversation messages for data extraction with timestamps
    const { data: messages } = await supabase
      .from("messages")
      .select("role, content, conversation_id, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true });

    // Create or update widget with "generating" status
    let widgetId: string;
    if (existingWidget) {
      widgetId = existingWidget.id;
      await supabase
        .from("ui_widgets")
        .update({ status: "generating", error_message: null })
        .eq("id", widgetId);
    } else {
      const { data: newWidget, error: createError } = await supabase
        .from("ui_widgets")
        .insert({
          global_tag_id,
          name: globalTag.tag,
          description: "",
          component_code: "",
          data_schema: {},
          status: "generating",
        })
        .select()
        .single();

      if (createError) throw new Error(`Failed to create widget: ${createError.message}`);
      widgetId = newWidget.id;
    }

    // Prepare context for LLM with conversation dates
    const tagsList = (conversationTags as ConversationTag[] || [])
      .map(t => `- ${t.tag}`)
      .join("\n");

    // Create a map of conversation IDs to their dates
    const conversationDateMap = new Map<string, string>();
    const conversationTitleMap = new Map<string, string>();
    for (const conv of (conversations as ConversationInfo[] || [])) {
      conversationDateMap.set(conv.id, conv.created_at);
      conversationTitleMap.set(conv.id, conv.title || "Untitled");
    }

    // Group messages by conversation with dates
    const messagesByConversation = new Map<string, Message[]>();
    for (const msg of (messages as Message[] || [])) {
      if (!messagesByConversation.has(msg.conversation_id)) {
        messagesByConversation.set(msg.conversation_id, []);
      }
      messagesByConversation.get(msg.conversation_id)!.push(msg);
    }

    // Format conversations with dates for the prompt
    const conversationsText = Array.from(messagesByConversation.entries())
      .map(([convId, msgs]) => {
        const date = conversationDateMap.get(convId) || "Unknown date";
        const title = conversationTitleMap.get(convId) || "Untitled";
        const formattedDate = new Date(date).toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
        const messagesText = msgs
          .map(m => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n");
        return `--- CONVERSATION: "${title}" (Date: ${formattedDate}) ---\n${messagesText}`;
      })
      .join("\n\n");

    // Generate widget spec and code via OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: `You are a React component generator that creates REFLECTIVE, TIMELINE-BASED UI widgets from conversation history.

Your goal is to help users look back on their past conversations and see a meaningful visualization of the data they discussed over time.

You will receive:
1. A global tag (the theme/category)
2. Detailed conversation tags (specific requests/topics)
3. Actual conversation content WITH DATES - each conversation has a date when it occurred

Generate a JSON response with:
1. "name": A concise widget name (e.g., "Calorie Timeline", "Purchase History")
2. "description": One sentence describing what this widget shows
3. "dataSchema": A JSON Schema - MUST include a "date" field (ISO string) for timeline functionality
4. "componentCode": A complete React functional component as a string
5. "initialData": An array of data items EXTRACTED FROM THE CONVERSATIONS with dates

CRITICAL - DATA EXTRACTION:
- Extract ACTUAL data mentioned in the conversations (meals, calories, items, amounts, etc.)
- Use the CONVERSATION DATE as the date for each extracted item
- If a conversation mentions "I had soup and rice for lunch", extract that as a data item with the conversation's date
- Be thorough - extract every relevant data point mentioned
- Each item MUST have an "id", "date", and relevant fields for the data type

COMPONENT REQUIREMENTS:
- Must be a single, self-contained React functional component
- Create a TIMELINE or HISTORY view - show data chronologically
- Group or display items by date
- Use ONLY React hooks (useState, useEffect, useMemo, useCallback)
- Use ONLY Tailwind CSS for styling
- Component receives props: { data, onDataChange }
- data is an array matching your dataSchema
- onDataChange(newData) should be called when user edits data
- Include add, edit, and delete functionality
- Show summaries/totals where appropriate (e.g., total calories per day)
- Handle empty state gracefully
- Use a dark theme (zinc-800, zinc-700, zinc-900 backgrounds with zinc-100 text)
- Make it visually appealing with clear date groupings

COMPONENT CODE FORMAT:
- Start with: function Widget({ data, onDataChange }) {
- End with: export default Widget;
- Include inline comments for complex logic
- DO NOT use any imports (React is available globally)
- Sort and group data by date for timeline display

Example data schema for calories:
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "date": { "type": "string", "format": "date" },
    "meal": { "type": "string" },
    "description": { "type": "string" },
    "calories": { "type": "number" }
  }
}

Example initialData for calories (EXTRACT FROM ACTUAL CONVERSATIONS):
[
  { "id": "1", "date": "2025-12-14", "meal": "Lunch", "description": "Soup with rice and Korean side dishes", "calories": 650 },
  { "id": "2", "date": "2025-12-15", "meal": "Dinner", "description": "Grilled chicken with vegetables", "calories": 450 }
]`,
          },
          {
            role: "user",
            content: `Generate a TIMELINE-BASED widget for this theme. Extract all relevant data from the conversations below.

GLOBAL TAG: ${globalTag.tag}

DETAILED CONVERSATION TAGS (what the user discussed):
${tagsList}

CONVERSATIONS WITH DATES:
${conversationsText}

IMPORTANT: Extract every piece of relevant data mentioned in these conversations and include the conversation date for each item. Create a timeline/history view.

Generate the complete widget specification as JSON.`,
          },
        ],
        temperature: 0.7,
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

    const widgetSpec: WidgetSpec = JSON.parse(generatedContent);

    // Update widget with generated code
    const { error: updateError } = await supabase
      .from("ui_widgets")
      .update({
        name: widgetSpec.name,
        description: widgetSpec.description,
        component_code: widgetSpec.componentCode,
        data_schema: widgetSpec.dataSchema,
        status: "active",
      })
      .eq("id", widgetId);

    if (updateError) {
      throw new Error(`Failed to update widget: ${updateError.message}`);
    }

    // Delete existing widget data and insert new
    await supabase
      .from("ui_widget_data")
      .delete()
      .eq("widget_id", widgetId);

    // Insert initial data
    if (widgetSpec.initialData && widgetSpec.initialData.length > 0) {
      const dataRows = widgetSpec.initialData.map((item, index) => ({
        widget_id: widgetId,
        data: item,
        source_conversation_id: conversationIds[index % conversationIds.length] || null,
      }));

      await supabase
        .from("ui_widget_data")
        .insert(dataRows);
    }

    return new Response(
      JSON.stringify({
        success: true,
        widgetId,
        name: widgetSpec.name,
        description: widgetSpec.description,
        dataCount: widgetSpec.initialData?.length || 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-widget-ui:", error);

    // Try to update widget status to error if we have the ID
    // (This is a best-effort attempt)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

