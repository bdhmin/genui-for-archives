// Supabase Edge Function: round-1-tags
// Generates 5-10 descriptive sentence tags for a single conversation
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

interface TagGenerationResponse {
  tags: string[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return new Response(
        JSON.stringify({ success: false, error: "conversation_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const claudeApiKey = Deno.env.get("CLAUDE_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch conversation messages
    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      throw new Error(`Failed to fetch messages: ${messagesError.message}`);
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, tags: [], message: "No messages found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format conversation for the prompt
    const conversationText = (messages as Message[])
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    // Call Claude to generate tags
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": claudeApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: `You are a conversation analyzer. Your task is to generate 5-10 descriptive sentence-long tags for a conversation.

Each tag should answer the question: "What are the requests the user is looking to address in this conversation?"

Guidelines:
- Each tag should be a complete, descriptive sentence
- Focus on the user's intent, requests, and goals
- Be specific about the context (e.g., mention specific foods, topics, etc.)
- Include both explicit requests and implicit needs

Example tags:
- "The user wants to know the calorie count of their meal that involved soup, a bit of rice, and Korean side dishes."
- "The user is seeking advice on how to structure their morning routine for better productivity."
- "The user needs help debugging a React component that isn't rendering properly."

Respond with ONLY a JSON object containing a "tags" array of strings. No other text or explanation.`,
        messages: [
          {
            role: "user",
            content: `Analyze this conversation and generate 5-10 descriptive sentence tags:\n\n${conversationText}\n\nRespond with only valid JSON: {"tags": ["tag1", "tag2", ...]}`,
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      throw new Error(`Claude API error: ${errorText}`);
    }

    const claudeData = await claudeResponse.json();
    const textBlock = claudeData.content?.find((block: { type: string }) => block.type === "text");
    const generatedContent = textBlock?.text;
    
    if (!generatedContent) {
      throw new Error("No content in Claude response");
    }

    const parsedResponse: TagGenerationResponse = JSON.parse(generatedContent);
    const tags = parsedResponse.tags || [];

    // Delete existing tags for this conversation (to update them)
    await supabase
      .from("conversation_tags")
      .delete()
      .eq("conversation_id", conversation_id);

    // Insert new tags
    const tagsToInsert = tags.map((tag: string) => ({
      conversation_id,
      tag,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data: insertedTags, error: insertError } = await supabase
      .from("conversation_tags")
      .insert(tagsToInsert)
      .select();

    if (insertError) {
      throw new Error(`Failed to insert tags: ${insertError.message}`);
    }

    // Trigger round-2-tags function asynchronously (fire and forget)
    const round2Url = `${supabaseUrl}/functions/v1/round-2-tags`;
    fetch(round2Url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }).catch((err) => console.error("Failed to trigger round-2-tags:", err));

    return new Response(
      JSON.stringify({
        success: true,
        tags: insertedTags,
        count: tags.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in round-1-tags:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
