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

    // Fetch existing global tags to prevent duplicates
    const { data: existingGlobalTags } = await supabase
      .from("global_tags")
      .select("id, tag");

    const existingTagsList = (existingGlobalTags || [])
      .map(t => `- "${t.tag}" (ID: ${t.id})`)
      .join("\n");

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
            content: `You are a tag clustering expert. Your PRIMARY goal is to CREATE NEW GLOBAL TAGS for EACH DISTINCT TOPIC you see in the conversation tags.

CRITICAL: A single conversation can discuss MULTIPLE different topics! You must create a SEPARATE global tag for EACH distinct topic mentioned, even if they're in the same conversation.

You will receive:
1. EXISTING global tags (if any) - these already have UI widgets built for them
2. Conversation tags to categorize - EACH tag represents a specific request/topic

YOUR TASK:
1. Look at EACH conversation tag individually (not just the overall conversation)
2. For EACH distinct topic/request, determine if it needs its own global tag
3. A single conversation should be mapped to MULTIPLE global tags if it discusses multiple topics
4. DEFAULT TO CREATING NEW TAGS for any topic not EXACTLY matching an existing tag

WHEN TO REUSE AN EXISTING TAG:
- The conversation tag is about the same specific topic
- You would display the same UI with the same data fields
- Use similar text of the existing tag
- Examples of topics that should be reused:
  - "Workspace Setup" vs "Office Furniture" vs "Ergonomics" vs "Home Office Budget"
  - "Daily Exercise Log" vs "Running Goals" vs "Gym Membership" vs "Workout Plans"
  - "Book Recommendations" vs "Reading Progress" vs "Library Visits" vs "Book Notes"
  - "Travel Plans" vs "Flight Bookings" vs "Hotel Research" vs "Trip Budgets"
  - "Calorie Tracking" vs "Meal Planning" vs "Recipes"
  - "Learning about a new JS Framework" vs "React vs Vue vs Svelte vs Angular"


WHEN TO CREATE A NEW TAG:
- ANY new topic, subject, or category you see in the conversation tags
- ANY topic that doesn't really match an existing global tag in a meaningful way
- If a conversation discusses topic A and topic B, create TWO global tags (one for each)
- Examples of topics that MUST ALWAYS be separate:
  - "Restaurant Recommendations" vs "Calorie Tracking"
  - "Grocery Lists" vs "Calorie Tracking"
  - "Grammar Correction" vs "Writing Help"
- New tags should be short phrases (3-6 words)
- Be SPECIFIC - use subtopics, not generic categories

CRITICAL RULE FOR MULTI-TOPIC CONVERSATIONS:
If a conversation has tags about calories AND tags about exercise, that conversation MUST appear in BOTH a calories global tag AND an exercise global tag. Don't just pick one - include it in ALL relevant global tags.

OUTPUT FORMAT:
{
  "global_tags": [
    {
      "tag": "Exact existing tag text OR new tag phrase",
      "source_conversation_ids": ["conv-id-1", "conv-id-2"],
      "is_new": true
    }
  ]
}

CRITICAL REQUIREMENTS:
1. EVERY global tag MUST have at least one conversation ID in source_conversation_ids
2. Use the EXACT conversation IDs from the input (the UUIDs in parentheses)
3. A global tag with empty source_conversation_ids is INVALID - do not create it
4. Each conversation ID should appear in at least one global tag

Respond with valid JSON.`,
          },
          {
            role: "user",
            content: `EXISTING GLOBAL TAGS:
${existingTagsList || "(none - all tags will be new)"}

CONVERSATION TAGS TO CATEGORIZE:
${allTagsText}

INSTRUCTIONS:
1. For each conversation, identify ALL distinct topics discussed
2. Create or reuse a global tag for EACH topic
3. Include the conversation's UUID in the source_conversation_ids for EVERY relevant global tag
4. EVERY global tag in your response MUST have at least one conversation ID

Return your response as JSON.`,
          },
        ],
        temperature: 0.4,
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
    const rawGlobalTags = parsedResponse.global_tags || [];
    
    // Log what the AI returned
    console.log(`[Round2] AI returned ${rawGlobalTags.length} global tags`);
    for (const tag of rawGlobalTags) {
      console.log(`[Round2] Tag: "${tag.tag}" -> conversations: ${JSON.stringify(tag.source_conversation_ids || [])}`);
    }
    
    // Filter out tags with no conversation IDs (invalid)
    const globalTags = rawGlobalTags.filter(tag => {
      const hasConversations = tag.source_conversation_ids && tag.source_conversation_ids.length > 0;
      if (!hasConversations) {
        console.warn(`[Round2] Skipping tag "${tag.tag}" - no source_conversation_ids`);
      }
      return hasConversations;
    });
    
    console.log(`[Round2] After filtering: ${globalTags.length} valid global tags`);

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
    
    let widgetsToGenerate = 0;

    const widgetGenerationResults: { globalTagId: string; success: boolean; error?: string }[] = [];

    // Only trigger widget generation for tags that don't have active widgets
    // Data updates are NOT triggered here - they happen via add-conversation or chat routes
    // This prevents overwhelming the worker pool with too many simultaneous edge function calls
    for (const globalTag of allGlobalTags || []) {
      const existingWidget = widgetByGlobalTag.get(globalTag.id);

      if (existingWidget && existingWidget.status === "active") {
        // Widget already exists and is active - skip, data updates happen elsewhere
        console.log(`[Round2] Widget already active for ${globalTag.id}, skipping`);
      } else {
        // No widget or widget is in error/generating state - trigger generation (fire-and-forget)
        console.log(`[Round2] Triggering widget generation for global tag: ${globalTag.id} (${globalTag.tag})`);
        widgetsToGenerate++;
        
        // Fire-and-forget: don't await, just trigger the generation
        fetch(generateWidgetUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ global_tag_id: globalTag.id }),
        })
          .then(async (genResponse) => {
            console.log(`[Round2] Widget gen response status for ${globalTag.id}: ${genResponse.status}`);
          })
          .catch((err) => {
            console.error(`[Round2] Failed to trigger widget generation for ${globalTag.id}:`, err);
          });
        
        widgetGenerationResults.push({
          globalTagId: globalTag.id,
          success: true, // We just triggered it, actual success is async
          error: undefined,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        globalTags: allGlobalTags,
        newTagsCount: insertedGlobalTags.length,
        mappingsCount: mappingsToInsert.length,
        widgetGenerationTriggered: widgetsToGenerate,
        widgetGenerationResults: widgetGenerationResults,
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

