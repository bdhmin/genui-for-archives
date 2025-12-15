// Supabase Edge Function: round-2-tags
// Processes all conversation tags to generate higher-level pattern tags
// Deno runtime

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConversationTag {
  id: string;
  conversation_id: string;
  tag: string;
}

interface GlobalTagResult {
  tag: string;
  source_conversation_ids: string[];
}

interface TagClusteringResponse {
  global_tags: GlobalTagResult[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch all conversation tags
    const { data: conversationTags, error: tagsError } = await supabase
      .from("conversation_tags")
      .select("id, conversation_id, tag");

    if (tagsError) {
      throw new Error(`Failed to fetch conversation tags: ${tagsError.message}`);
    }

    if (!conversationTags || conversationTags.length === 0) {
      return new Response(
        JSON.stringify({ success: true, globalTags: [], message: "No conversation tags found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group tags by conversation for context
    const tagsByConversation = (conversationTags as ConversationTag[]).reduce((acc, tag) => {
      if (!acc[tag.conversation_id]) {
        acc[tag.conversation_id] = [];
      }
      acc[tag.conversation_id].push(tag.tag);
      return acc;
    }, {} as Record<string, string[]>);

    // Format tags for the prompt
    const allTagsText = Object.entries(tagsByConversation)
      .map(([convId, tags], idx) => 
        `Conversation ${idx + 1} (${convId}):\n${tags.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}`
      )
      .join("\n\n");

    // Call OpenAI to cluster and generalize tags
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
            content: `You are a tag clustering and generalization expert. Your task is to analyze descriptive tags from multiple conversations and create higher-level, generalized tags that capture patterns across conversations.

Guidelines:
- Create short phrase tags (not full sentences)
- Find common themes and patterns across different conversations
- Each global tag should represent a category that multiple conversations might belong to
- Include the conversation IDs that relate to each global tag

Example input tags:
- "The user wants to know the calorie count of their meal..."
- "The user is tracking their daily food intake..."
- "The user asks about nutritional information..."

Example global tag:
- "Calorie and nutrition tracking" (relates to conversations about food/calories)

Respond with a JSON object containing a "global_tags" array, where each item has:
- "tag": the higher-level tag phrase
- "source_conversation_ids": array of conversation IDs that relate to this tag`,
          },
          {
            role: "user",
            content: `Analyze these conversation tags and generate higher-level pattern tags:\n\n${allTagsText}`,
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

    const parsedResponse: TagClusteringResponse = JSON.parse(generatedContent);
    const globalTags = parsedResponse.global_tags || [];

    // Upsert global tags and create mappings
    const insertedGlobalTags = [];
    const mappingsToInsert = [];

    for (const globalTag of globalTags) {
      // Upsert the global tag (insert or get existing)
      const { data: existingTag } = await supabase
        .from("global_tags")
        .select("id")
        .eq("tag", globalTag.tag)
        .single();

      let globalTagId: string;

      if (existingTag) {
        globalTagId = existingTag.id;
      } else {
        const { data: newTag, error: insertError } = await supabase
          .from("global_tags")
          .insert({ tag: globalTag.tag })
          .select()
          .single();

        if (insertError) {
          console.error(`Failed to insert global tag "${globalTag.tag}":`, insertError);
          continue;
        }
        globalTagId = newTag.id;
        insertedGlobalTags.push(newTag);
      }

      // Create mappings for each source conversation
      for (const conversationId of globalTag.source_conversation_ids) {
        mappingsToInsert.push({
          conversation_id: conversationId,
          global_tag_id: globalTagId,
        });
      }
    }

    // Delete existing mappings and insert new ones
    // (We do this to ensure mappings are always up-to-date)
    if (mappingsToInsert.length > 0) {
      // Get unique conversation IDs to clear their mappings
      const uniqueConversationIds = [...new Set(mappingsToInsert.map(m => m.conversation_id))];
      
      for (const convId of uniqueConversationIds) {
        await supabase
          .from("conversation_global_tags")
          .delete()
          .eq("conversation_id", convId);
      }

      // Insert new mappings (ignore duplicates)
      const { error: mappingError } = await supabase
        .from("conversation_global_tags")
        .upsert(mappingsToInsert, { onConflict: "conversation_id,global_tag_id" });

      if (mappingError) {
        console.error("Failed to insert mappings:", mappingError);
      }
    }

    // Fetch all global tags with their conversation counts
    const { data: allGlobalTags } = await supabase
      .from("global_tags")
      .select(`
        id,
        tag,
        created_at,
        conversation_global_tags (
          conversation_id
        )
      `);

    // Fetch existing widgets to determine which need generation vs update
    const { data: existingWidgets } = await supabase
      .from("ui_widgets")
      .select("id, global_tag_id, status");

    const widgetByGlobalTag = new Map<string, { id: string; status: string }>();
    for (const w of existingWidgets || []) {
      widgetByGlobalTag.set(w.global_tag_id, { id: w.id, status: w.status });
    }

    const generateWidgetUrl = `${supabaseUrl}/functions/v1/generate-widget-ui`;
    const updateWidgetDataUrl = `${supabaseUrl}/functions/v1/update-widget-data`;
    
    let widgetsToGenerate = 0;
    let dataUpdatesTriggered = 0;

    for (const globalTag of allGlobalTags || []) {
      const existingWidget = widgetByGlobalTag.get(globalTag.id);
      const conversationIds = globalTag.conversation_global_tags?.map(
        (c: { conversation_id: string }) => c.conversation_id
      ) || [];

      if (existingWidget && existingWidget.status === "active") {
        // Widget exists - trigger data update for each linked conversation
        // The update function will skip conversations that already have data
        for (const conversationId of conversationIds) {
          fetch(updateWidgetDataUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ 
              widget_id: existingWidget.id, 
              conversation_id: conversationId 
            }),
          }).catch((err) => console.error(`Failed to trigger data update:`, err));
          dataUpdatesTriggered++;
        }
      } else {
        // No widget or widget is in error/generating state - trigger generation
        fetch(generateWidgetUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ global_tag_id: globalTag.id }),
        }).catch((err) => console.error(`Failed to trigger widget generation for ${globalTag.id}:`, err));
        widgetsToGenerate++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        globalTags: allGlobalTags,
        newTagsCount: insertedGlobalTags.length,
        mappingsCount: mappingsToInsert.length,
        widgetGenerationTriggered: widgetsToGenerate,
        dataUpdatesTriggered: dataUpdatesTriggered,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in round-2-tags:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

