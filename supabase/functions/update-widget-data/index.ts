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
3. A conversation with its date

Extract ALL relevant data items from the conversation that match the schema.
Each item MUST:
- Have a unique "id" (use a number or short string)
- Have a "date" field set to the conversation date: "${isoDate}"
- Match all other required fields in the schema

If no relevant data can be extracted, return an empty array.

Respond with ONLY a JSON object: { "extractedData": [...] }`,
          },
          {
            role: "user",
            content: `Extract data from this conversation for the "${widget.name}" widget.

DATA SCHEMA:
${JSON.stringify(widget.data_schema, null, 2)}

CONVERSATION (Date: ${formattedDate}):
${conversationText}

Extract all relevant data items that match the schema. Use "${isoDate}" as the date for all items.`,
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
    const extractedData = parsed.extractedData || [];

    if (extractedData.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No relevant data found in conversation", newDataCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert the new data items
    const dataRows = extractedData.map((item: Record<string, unknown>) => ({
      widget_id,
      data: item,
      source_conversation_id: conversation_id,
    }));

    const { data: insertedData, error: insertError } = await supabase
      .from("ui_widget_data")
      .insert(dataRows)
      .select();

    if (insertError) {
      throw new Error(`Failed to insert data: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        widgetId: widget_id,
        conversationId: conversation_id,
        newDataCount: insertedData?.length || 0,
        extractedData: extractedData,
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

