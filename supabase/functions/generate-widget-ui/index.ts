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

=== DESIGN SYSTEM - FOLLOW THIS EXACTLY ===

The widget MUST match this exact design system from the parent application:

**COLOR PALETTE (zinc-based dark theme with amber accent):**
- Background primary: bg-zinc-900 (#18181b)
- Background elevated/cards: bg-zinc-800, bg-zinc-800/30, bg-zinc-800/50
- Background sidebar/darker: bg-zinc-950
- Hover states: bg-zinc-700, bg-zinc-700/50
- Active/hover subtle: bg-zinc-600
- Text primary: text-zinc-100, text-zinc-50 (#fafafa)
- Text secondary: text-zinc-400
- Text muted/placeholder: text-zinc-500
- Accent/highlight: amber-500, amber-600 (use for active states, highlights, progress, important actions)
- Error states: red-400, red-500
- Borders: border-zinc-700, border-zinc-700/50, border-zinc-800

**TYPOGRAPHY:**
- Use clean, geometric sans-serif appearance (the parent uses Hanken Grotesk)
- Text sizes: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl
- Font weights: font-medium, font-semibold, font-bold

**COMPONENT PATTERNS:**
- Cards: rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-5
- Buttons primary: rounded-xl bg-zinc-700 text-zinc-100 hover:bg-zinc-600
- Buttons secondary: rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700
- Buttons subtle: rounded-xl bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300
- Delete/destructive buttons: rounded-xl bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 (NO red colors)
- Input fields: rounded-xl bg-zinc-800 border border-zinc-700/50 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600
- Tags/badges: rounded-xl bg-zinc-800/50 px-3 py-2 text-sm text-zinc-400
- Accent dots/indicators: h-1.5 w-1.5 rounded-full bg-amber-500

**MINIMAL COLOR PHILOSOPHY - CRITICAL:**
- Use a MONOCHROMATIC color palette - only zinc grays with amber as the sole accent
- ALL buttons should be zinc-based (zinc-700, zinc-800) - NOT semantic colors
- NEVER use red for delete, green for add/save, or blue for edit
- Delete buttons: use zinc-800 with zinc-400 text, hover to zinc-700 - differentiate with icon or text, NOT color
- Add/Save buttons: use zinc-700 with zinc-100 text - NOT green
- Edit buttons: use zinc-800 with zinc-400 text - NOT blue
- Amber (amber-500, amber-600) is ONLY for: progress indicators, important highlights, active states
- The aesthetic should be calm, neutral, and sophisticated - not a rainbow of action colors

**BORDERS & SHADOWS:**
- Subtle borders: border border-zinc-700/30 (softer, more transparent)
- Highlighted borders: border-zinc-600 (NOT amber - keep it subtle)
- Shadows: shadow-sm shadow-zinc-900/30 (soft, minimal shadows)
- ALWAYS use generous border radius: rounded-xl (12px) or rounded-2xl (16px)
- Avoid sharp corners entirely - everything should feel soft and rounded

**SPACING:**
- Cards: p-5 or p-6
- Gaps: gap-2, gap-3, gap-4, gap-6
- Section padding: px-6 py-4, p-8

**INTERACTIVE STATES:**
- Hover transitions: transition-colors duration-200 (subtle, no scale transforms)
- Loading spinners: animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400
- Focus states: focus:border-zinc-600 focus:outline-none (subtle, no rings)
- Hover backgrounds: hover:bg-zinc-800/50 or hover:bg-zinc-700/50 (very subtle)

**EMPTY STATES:**
- Center content with flex items-center justify-center
- Large muted icon (text-zinc-600 or text-zinc-700)
- Title in text-zinc-300, description in text-zinc-500

**SPECIFIC UI PATTERNS TO USE:**
- Date groupings: Use section headers with text-sm font-medium text-zinc-500 (muted)
- List items: rounded-xl p-4 with hover:bg-zinc-800/30 - keep backgrounds flat
- Inline actions: Small icon buttons with p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50
- Form rows: flex items-center gap-4 with labels as text-sm text-zinc-500
- Summary/total rows: rounded-xl p-4 with font-medium text-zinc-300
- All interactive elements should have rounded-lg or rounded-xl corners

**CRITICAL STYLING RULES:**
- ALWAYS use GENEROUS rounded corners: rounded-xl (12px) or rounded-2xl (16px) - NEVER sharp corners
- Smaller elements use rounded-lg (8px) minimum - buttons, badges, small inputs
- ALWAYS use proper padding: p-4, p-5, p-6 for containers - generous spacing
- ALWAYS use gap utilities for spacing between items: gap-3, gap-4, gap-6
- ALWAYS use proper margins between sections: mb-4, mb-6, mt-4, mt-6
- ALWAYS apply border-radius to inputs, buttons, and cards
- Use px-4 py-2.5 for button padding, px-5 py-3 for larger buttons
- Font is already Hanken Grotesk from parent - just use font-sans if needed
- THE UI SHOULD FEEL SOFT, CALM, AND MINIMAL - like a premium notes app

**FLAT DESIGN - MINIMAL BACKGROUNDS:**
- Use ONE consistent background: bg-zinc-900 - DO NOT layer multiple backgrounds
- Separate items with BORDERS (border-b border-zinc-800) or SPACING (gap, py) - NOT different background colors
- Avoid nested cards with different background shades - keep it flat
- Only use bg-zinc-800 sparingly for interactive elements like buttons or inputs
- The overall look should be FLAT and CLEAN, not layered with multiple shades

**EXAMPLE CODE PATTERNS - FOLLOW EXACTLY:**

Main container (flat, no extra background):
\`<div className="flex flex-col gap-4">\`

List item row (use border for separation, NOT background):
\`<div className="flex items-center justify-between py-4 border-b border-zinc-800/50 last:border-b-0">\`

Date section header:
\`<h3 className="text-sm font-medium text-zinc-500 pt-4 pb-2">December 15, 2025</h3>\`

Primary button (neutral, NOT colored):
\`<button className="rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-100 hover:bg-zinc-600 transition-colors">\`

Secondary/subtle button:
\`<button className="rounded-xl bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300 transition-colors">\`

Delete button (NO red - use neutral with icon):
\`<button className="rounded-xl bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300 transition-colors">\`

Input field:
\`<input className="w-full rounded-xl border border-zinc-700/50 bg-zinc-800 px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none" />\`

Summary/total row (subtle, minimal):
\`<div className="mt-4 pt-4 border-t border-zinc-800/50 flex justify-between items-center">\`

Action links (text-based, no color):
\`<button className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Edit</button>\`

Icon buttons (small, subtle):
\`<button className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors">\`

**ICONS - USE LUCIDE-REACT:**
- ALWAYS use lucide-react for icons - it is available in the sandbox
- Import icons at the top of the component: import { Plus, Trash2, Edit2, Check, X, Calendar, ChevronDown } from 'lucide-react';
- Common icons: Plus (add), Trash2 (delete), Edit2/Pencil (edit), Check (confirm), X (cancel/close), Calendar (dates), ChevronDown/ChevronUp (expand/collapse)
- Icon sizing: className="w-4 h-4" for small, "w-5 h-5" for medium, "w-6 h-6" for large
- Icon colors: Use text color classes like text-zinc-400, text-zinc-500, hover:text-zinc-300
- Example: <Trash2 className="w-4 h-4" /> inside a button
- NEVER use emoji or text symbols for icons - ALWAYS use Lucide icons

COMPONENT REQUIREMENTS:
- Must be a single, self-contained React functional component
- Create a TIMELINE or HISTORY view - show data chronologically
- Group or display items by date
- Use React hooks (useState, useEffect, useMemo, useCallback, useRef) - they are already available, DO NOT import them
- Use ONLY Tailwind CSS for styling - STRICTLY follow the design system above
- Use ONLY lucide-react for icons - you MUST import these (e.g., import { Plus, Trash2 } from 'lucide-react')
- Component receives props: { data, onDataChange }
- data is an array matching your dataSchema
- onDataChange(newData) should be called when user edits data
- Include add, edit, and delete functionality
- Show summaries/totals where appropriate (e.g., total calories per day)
- Handle empty state gracefully with centered content and muted styling

COMPONENT CODE FORMAT:
- Start with imports: import { IconName1, IconName2 } from 'lucide-react';
- Then: function Widget({ data, onDataChange }) {
- End with: export default Widget;
- Include inline comments for complex logic
- CRITICAL - IMPORTS:
  * DO import from 'lucide-react' (e.g., import { Plus, Trash2 } from 'lucide-react')
  * DO NOT import React hooks (useState, useEffect, useMemo, useCallback, useRef) - these are already imported in the wrapper code
  * DO NOT import React itself - React is available globally
  * The wrapper code already provides: React, useState, useEffect, useMemo, useCallback, useRef
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

