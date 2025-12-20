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

// Stage 1: UI Type Selection response
interface UITypeSelection {
  selectedType: string;
  reasoning: string;
  editableTimeline: boolean;
}

// UI Type definitions with rich descriptions
const UI_TYPES_PROMPT = `
You are a UI type selector. Analyze the conversation data and choose the BEST visualization type.

=== AVAILABLE UI TYPES ===

1. **TEXT_DIFF** (Text/Code Diff View)
   - APPEARANCE: Two blocks of text/code displayed side-by-side. The left shows the "before" version, the right shows the "after" version. Additions are highlighted with a subtle green background, deletions with a subtle red background. Line numbers on both sides. A toolbar to toggle between side-by-side and unified diff views.
   - BEST FOR: Grammar checks, code reviews, document version comparisons, proofreading feedback, tracking text changes over time, comparing drafts.

2. **HISTORY** (History/Log View)
   - APPEARANCE: Vertical list grouped by date sections (e.g., "Monday, December 16"). Each entry is a row with timestamp, description, and optional metadata. Entries within the same day are visually grouped. Expandable entries for details. A summary bar at top/bottom showing totals or averages.
   - BEST FOR: Tracking things over time - meals, workouts, expenses, mood logs, journal entries, daily habits, activity logs. Any data where chronological order and date grouping is meaningful.

3. **WEEK** (Week Calendar View)
   - APPEARANCE: 7-column grid layout with day headers (Mon, Tue, Wed...). Current day is highlighted. Items are placed in their respective day cells as small cards or chips. Scrollable if many items per day. Week navigation arrows to go forward/backward. Optional: color-coding by category.
   - BEST FOR: Weekly planning, habit tracking, meal planning, scheduling, class schedules, workout plans, weekly goals. Any data with a natural weekly rhythm.

4. **COMPARISON** (Comparison Table View)
   - APPEARANCE: Multi-column table where each column represents an item being compared. Row headers on the left list attributes/features being compared. Cells contain the values for each item. Highlight differences with subtle background colors. Optionally, a "winner" indicator per row. Sticky headers for scrolling.
   - BEST FOR: Product comparisons, decision matrices, feature comparisons between options, pros/cons analysis, comparing multiple approaches or alternatives, apartment hunting, car shopping.

5. **CANVAS** (Freeform Canvas View)
   - APPEARANCE: A 2D freeform space where items appear as draggable cards. Cards can be moved freely and clustered/grouped spatially. Optional grid snapping. Zoom in/out controls. Cards can have different sizes. Clustering zones or grouping areas can be defined. Connections/lines between related cards (optional).
   - BEST FOR: Mind mapping, mood boards, brainstorming, spatial organization, clustering related ideas, visual thinking, grouping concepts, creative planning, mood/inspiration boards.

6. **TIMELINE** (Gantt/Timeline View)
   - APPEARANCE: Horizontal time axis at top (can be hours, days, weeks depending on data). Items appear as horizontal bars spanning their start-to-end times. Overlapping items stack vertically. Time markers and grid lines. Zoom controls for different time scales. Optional: drag handles to resize/move items if editable.
   - BEST FOR: Project planning with start/end dates, historical events spanning time periods, transit schedules (train/bus arrivals and departures), availability windows, booking calendars, overlapping events visualization, Gantt charts.

7. **CHECKLIST** (Checklist/Todo View)
   - APPEARANCE: Vertical list with checkboxes on the left. Completed items show strikethrough or muted styling. Optional priority indicators (dots or badges). Drag to reorder. Inline editing. Progress bar at top showing completion percentage. Grouping by category or due date.
   - BEST FOR: Tasks, todos, goals to achieve, shopping lists, packing lists, any list of items that need to be completed or checked off.

8. **CARDS** (Cards/Gallery View)
   - APPEARANCE: Grid of cards, each containing a title, optional image/icon, description snippet, and tags. Cards can be different sizes. Filterable by tags or categories. Hover to show more details. Click to expand or edit. Masonry or uniform grid layout.
   - BEST FOR: Collections - recipes, bookmarks, ideas, notes, articles to read, movie/book lists, inspiration collections, any curated set of items.

9. **DASHBOARD** (Dashboard/Stats View)
   - APPEARANCE: Multiple stat cards showing key numbers prominently. Progress bars or rings for percentages. Mini charts (sparklines, bar charts). Comparison to previous period. Grid layout organizing different metrics. Color-coded status indicators using amber accent.
   - BEST FOR: KPIs, summaries, tracking numerical goals, fitness stats, financial summaries, any data that benefits from aggregate views, averages, trends, or at-a-glance metrics.

10. **SIMPLE_LIST** (Simple List View)
    - APPEARANCE: Clean vertical list without complex structure. Each item is a row with minimal styling. Optional icons or bullets. Inline editing. Add new item at bottom. No grouping or complex hierarchy.
    - BEST FOR: Quick notes, simple enumerations, bookmarks, links, any straightforward list that doesn't need dates, checkboxes, or complex organization.

=== DECISION CRITERIA ===

Analyze the data and consider:
1. Is the data temporal (dates matter)? -> HISTORY, WEEK, or TIMELINE
2. Is there a before/after relationship? -> TEXT_DIFF
3. Are items being compared against each other? -> COMPARISON
4. Does spatial organization help understanding? -> CANVAS
5. Are there items to complete? -> CHECKLIST
6. Is this a collection to browse? -> CARDS
7. Are there numerical metrics to summarize? -> DASHBOARD
8. Is it just a simple list of things? -> SIMPLE_LIST

=== OUTPUT FORMAT ===

Respond with JSON:
{
  "selectedType": "ONE_OF: TEXT_DIFF, HISTORY, WEEK, COMPARISON, CANVAS, TIMELINE, CHECKLIST, CARDS, DASHBOARD, SIMPLE_LIST",
  "reasoning": "2-3 sentences explaining why this type fits the data best and what visual structure will be most useful for the user.",
  "editableTimeline": true/false  // ONLY relevant for TIMELINE type: true if user would want to edit/plan (e.g., project planning), false if viewing historical/fixed data (e.g., historical events, transit schedules)
}
`;

// Helper function to get type-specific component generation instructions
function getTypeSpecificInstructions(uiType: string, editableTimeline: boolean): string {
  const baseInstructions: Record<string, string> = {
    TEXT_DIFF: `
=== TEXT_DIFF SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "title": { "type": "string" },
    "originalText": { "type": "string" },
    "revisedText": { "type": "string" },
    "date": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Two-panel layout with side-by-side text blocks
- Left panel: "Original" header, original text with line numbers
- Right panel: "Revised" header, revised text with line numbers
- Implement simple diff highlighting:
  - For additions (text in revised not in original): bg-emerald-500/10 text-emerald-400
  - For deletions (text in original not in revised): bg-red-500/10 text-red-400 line-through
- Use monospace font for code: font-mono
- Line numbers: text-zinc-600 text-xs pr-4 select-none
- Toggle button to switch between side-by-side and unified view
- Word-level or line-level diff based on content type

**IMPLEMENTATION HINTS:**
- Split text by lines for line-by-line comparison
- Use a simple diff algorithm: compare lines, mark added/removed
- For word-level: split by spaces and compare tokens
- Scrollable panels with overflow-y-auto
- Max height constraint: max-h-96
`,

    HISTORY: `
=== HISTORY SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "date": { "type": "string", "format": "date" },
    "description": { "type": "string" },
    "details": { "type": "string" },
    "value": { "type": "number" }
  }
}

**COMPONENT STRUCTURE:**
- Group items by date using section headers
- Date headers: text-sm font-medium text-zinc-500 pt-6 pb-2 first:pt-0
- Each entry is a row with border-b border-zinc-800/50 last:border-b-0
- Show time if available, otherwise just the description
- Expandable entries for long content
- Summary bar showing totals/averages at bottom
- Add new entry form at top

**IMPLEMENTATION HINTS:**
- Group data by date using useMemo
- Sort by date descending (newest first)
- Format dates nicely: "Monday, December 16, 2024"
- Use ChevronDown/ChevronUp for expand/collapse
`,

    WEEK: `
=== WEEK SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "date": { "type": "string", "format": "date" },
    "title": { "type": "string" },
    "category": { "type": "string" },
    "completed": { "type": "boolean" }
  }
}

**COMPONENT STRUCTURE:**
- 7-column CSS Grid: grid grid-cols-7 gap-2
- Day headers: text-xs font-medium text-zinc-500 text-center pb-2
- Current day column: highlighted with border-amber-500/30 or bg-zinc-800/30
- Each day cell: min-h-24 rounded-xl p-2 border border-zinc-800/30
- Items inside cells: small chips/badges, text-xs rounded-lg px-2 py-1
- Week navigation: arrows at top to go prev/next week
- Show week range in header: "Dec 16 - Dec 22, 2024"

**IMPLEMENTATION HINTS:**
- Calculate week start (Monday) from current date
- getDay() returns 0 for Sunday, adjust for Monday start
- Use date-fns style calculations or manual Date math
- Place items in correct column based on their date
- Overflow: show +N more if too many items in a day
`,

    COMPARISON: `
=== COMPARISON SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "attributes": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    }
  }
}

**COMPONENT STRUCTURE:**
- Table layout with sticky first column (attribute names)
- First row: item headers/names (sticky top)
- Each subsequent row: one attribute compared across all items
- Highlight best values with amber accent dot
- Cells: p-3 border-b border-zinc-800/30
- Header cells: bg-zinc-900 sticky top-0 z-10
- Attribute column: bg-zinc-900 sticky left-0 text-zinc-400 text-sm

**IMPLEMENTATION HINTS:**
- Extract all unique attributes from items
- Build a grid where rows = attributes, columns = items
- Use CSS sticky for frozen headers/columns
- Allow adding new items (columns) and attributes (rows)
- Horizontal scroll for many items: overflow-x-auto
`,

    CANVAS: `
=== CANVAS SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "title": { "type": "string" },
    "content": { "type": "string" },
    "x": { "type": "number" },
    "y": { "type": "number" },
    "color": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Container: relative w-full h-96 bg-zinc-900 rounded-2xl overflow-hidden
- Each item: absolute positioned card with drag capability
- Card style: rounded-xl bg-zinc-800 p-3 shadow-lg cursor-grab active:cursor-grabbing
- Optional zoom controls: buttons at bottom-right
- Add button: fixed position at bottom

**IMPLEMENTATION HINTS:**
- Track dragging state: { isDragging, dragId, startX, startY, offsetX, offsetY }
- onMouseDown: set dragging state, calculate offset from card corner
- onMouseMove: update position based on mouse - offset
- onMouseUp: save new position via onDataChange
- Touch events: onTouchStart, onTouchMove, onTouchEnd mirror mouse events
- Use transform: translate for smooth dragging, not left/top
- Prevent text selection during drag: select-none on container
- Grid snapping optional: round to nearest 20px
`,

    TIMELINE: `
=== TIMELINE SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "title": { "type": "string" },
    "startDate": { "type": "string", "format": "date-time" },
    "endDate": { "type": "string", "format": "date-time" },
    "category": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Container: relative w-full overflow-x-auto
- Time axis at top: flex with time markers, sticky
- Content area below: relative, items positioned absolutely
- Each item: horizontal bar spanning start to end
- Overlapping items stack vertically (calculate rows)
- Time scale: show appropriate units (hours/days/weeks)
${editableTimeline ? `
**EDITABLE MODE:**
- Drag handles on bar ends for resize
- Drag bar center to move entire item
- onMouseDown on handle: start resize mode
- onMouseDown on bar: start move mode
- Update start/end dates on drop
` : `
**READ-ONLY MODE:**
- No drag handles or resize capability
- Hover to show details tooltip
- Click to expand/show more info
`}

**IMPLEMENTATION HINTS:**
- Calculate time range: min(startDates) to max(endDates)
- Convert dates to pixel positions: (date - minDate) / (maxDate - minDate) * containerWidth
- Bar width = endPosition - startPosition
- Row assignment: find first row where bar doesn't overlap existing bars
- Zoom: multiply time scale, adjust container width
`,

    CHECKLIST: `
=== CHECKLIST SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "task": { "type": "string" },
    "completed": { "type": "boolean" },
    "priority": { "type": "string" },
    "dueDate": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Progress bar at top showing completion %
- List of items with checkboxes
- Checkbox: w-5 h-5 rounded-lg border-2 border-zinc-600 (checked: bg-amber-500 border-amber-500)
- Completed items: text-zinc-500 line-through
- Priority indicator: small dot before task (high: amber, normal: zinc)
- Inline edit on click
- Drag to reorder

**IMPLEMENTATION HINTS:**
- Calculate completion: completed.length / total.length * 100
- Toggle: update completed boolean in onDataChange
- Sort: incomplete first, then by priority, then by date
`,

    CARDS: `
=== CARDS SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "title": { "type": "string" },
    "description": { "type": "string" },
    "tags": { "type": "array", "items": { "type": "string" } },
    "imageUrl": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Grid layout: grid grid-cols-2 md:grid-cols-3 gap-4
- Each card: rounded-2xl border border-zinc-700/30 p-4 hover:border-zinc-600 transition-colors
- Card has: title (font-medium), description (text-sm text-zinc-400), tags row
- Tags: flex flex-wrap gap-2, each tag is rounded-lg bg-zinc-800/50 px-2 py-1 text-xs
- Filter bar at top: clickable tags to filter
- Add card button

**IMPLEMENTATION HINTS:**
- Collect all unique tags from items for filter bar
- Filter: show items that have selected tag (or all if no filter)
- Masonry layout optional: use columns CSS or manual calculation
`,

    DASHBOARD: `
=== DASHBOARD SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "label": { "type": "string" },
    "value": { "type": "number" },
    "previousValue": { "type": "number" },
    "unit": { "type": "string" },
    "date": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Grid of stat cards: grid grid-cols-2 md:grid-cols-4 gap-4
- Each stat card: rounded-2xl bg-zinc-800/30 p-5
- Large number display: text-3xl font-bold text-zinc-100
- Label below: text-sm text-zinc-500
- Change indicator: text-xs (positive: text-emerald-400, negative: text-red-400)
- Optional: sparkline mini chart (using simple divs for bars)
- Summary row at bottom with totals

**IMPLEMENTATION HINTS:**
- Calculate aggregates: sum, average, min, max
- Change %: ((current - previous) / previous * 100).toFixed(1)
- For sparklines: normalize values to max height, render as flex with small divs
`,

    SIMPLE_LIST: `
=== SIMPLE_LIST SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "text": { "type": "string" }
  }
}

**COMPONENT STRUCTURE:**
- Clean vertical list
- Each item: py-3 border-b border-zinc-800/50 last:border-b-0
- Minimal styling, focus on content
- Inline edit on click
- Delete button on hover
- Add new item input at bottom

**IMPLEMENTATION HINTS:**
- Keep it simple - no complex grouping or hierarchy
- Focus on quick add/edit/delete workflow
`,
  };

  return baseInstructions[uiType] || baseInstructions["SIMPLE_LIST"];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("[generate-widget-ui] Received request");
    
    const body = await req.json();
    console.log("[generate-widget-ui] Request body:", JSON.stringify(body));
    
    const { global_tag_id, widgetId: providedWidgetId, isMerge, globalTagId } = body;

    // Support both global_tag_id and globalTagId for flexibility
    const effectiveGlobalTagId = global_tag_id || globalTagId;
    
    console.log("[generate-widget-ui] Params:", { 
      effectiveGlobalTagId, 
      providedWidgetId, 
      isMerge,
      global_tag_id,
      globalTagId 
    });

    if (!effectiveGlobalTagId) {
      console.error("[generate-widget-ui] Missing global_tag_id");
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

    // For merge operations, we have a pre-created widget; otherwise check for existing
    let existingWidget: { id: string; status: string } | null = null;
    
    if (providedWidgetId && isMerge) {
      // Merge case: widget was pre-created by the merge API
      console.log("[generate-widget-ui] Merge case - looking for widget:", providedWidgetId);
      const { data: mergeWidget, error: mergeError } = await supabase
        .from("ui_widgets")
        .select("id, status")
        .eq("id", providedWidgetId)
        .single();
      
      if (mergeError) {
        console.error("[generate-widget-ui] Error fetching merge widget:", mergeError);
      }
      existingWidget = mergeWidget;
      console.log("[generate-widget-ui] Found merge widget:", existingWidget);
    } else {
      // Normal case: check if widget exists for this global tag
      console.log("[generate-widget-ui] Normal case - checking for existing widget");
      const { data: tagWidget } = await supabase
        .from("ui_widgets")
        .select("id, status")
        .eq("global_tag_id", effectiveGlobalTagId)
        .single();
      existingWidget = tagWidget;
    }

    if (existingWidget && existingWidget.status === "active" && !isMerge) {
      console.log("[generate-widget-ui] Widget already active, skipping");
      return new Response(
        JSON.stringify({ success: true, message: "Widget already exists", widgetId: existingWidget.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch the global tag
    console.log("[generate-widget-ui] Fetching global tag:", effectiveGlobalTagId);
    const { data: globalTag, error: tagError } = await supabase
      .from("global_tags")
      .select("id, tag")
      .eq("id", effectiveGlobalTagId)
      .single();

    if (tagError || !globalTag) {
      console.error("[generate-widget-ui] Global tag not found:", tagError);
      throw new Error(`Global tag not found: ${tagError?.message || "unknown"}`);
    }
    console.log("[generate-widget-ui] Found global tag:", globalTag.tag);

    // Fetch linked conversation tags
    const { data: conversationLinks } = await supabase
      .from("conversation_global_tags")
      .select("conversation_id")
      .eq("global_tag_id", effectiveGlobalTagId);

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
          global_tag_id: effectiveGlobalTagId,
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

    // ============================================
    // STAGE 1: UI Type Selection (Chain of Thought)
    // ============================================
    console.log(`[Stage 1] Selecting UI type for global tag: ${globalTag.tag}`);
    
    const typeSelectionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: UI_TYPES_PROMPT,
          },
          {
            role: "user",
            content: `Analyze this data and select the best UI type:

GLOBAL TAG: ${globalTag.tag}

DETAILED CONVERSATION TAGS (what the user discussed):
${tagsList}

CONVERSATIONS WITH DATES:
${conversationsText}

Based on this data, which UI type would be MOST useful? Consider:
- What is the nature of the data?
- How would the user want to interact with it?
- What visual structure would make it most useful?

Select the optimal UI type and explain your reasoning.`,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent selection
        response_format: { type: "json_object" },
      }),
    });

    if (!typeSelectionResponse.ok) {
      const errorText = await typeSelectionResponse.text();
      throw new Error(`UI Type Selection API error: ${errorText}`);
    }

    const typeSelectionData = await typeSelectionResponse.json();
    const typeSelectionContent = typeSelectionData.choices[0]?.message?.content;

    if (!typeSelectionContent) {
      throw new Error("No content in UI Type Selection response");
    }

    const uiTypeSelection: UITypeSelection = JSON.parse(typeSelectionContent);
    console.log(`[Stage 1] Selected type: ${uiTypeSelection.selectedType}`);
    console.log(`[Stage 1] Reasoning: ${uiTypeSelection.reasoning}`);
    if (uiTypeSelection.selectedType === "TIMELINE") {
      console.log(`[Stage 1] Timeline editable: ${uiTypeSelection.editableTimeline}`);
    }

    // ============================================
    // STAGE 2: Widget Generation
    // ============================================
    console.log(`[Stage 2] Generating ${uiTypeSelection.selectedType} widget...`);

    // Build type-specific instructions based on selected UI type
    const typeSpecificInstructions = getTypeSpecificInstructions(uiTypeSelection.selectedType, uiTypeSelection.editableTimeline);

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
            content: `You are a React component generator. You will generate a **${uiTypeSelection.selectedType}** widget.

The UI type has already been selected. Your job is to:
1. Generate the React component code for this specific UI type
2. Extract relevant data from the conversations
3. Follow the design system exactly

${typeSpecificInstructions}

Generate a JSON response with:
1. "name": A concise widget name that reflects the UI type (e.g., "Recipe Collection", "Task Tracker", "Expense Dashboard")
2. "description": One sentence describing what this widget shows
3. "dataSchema": A JSON Schema appropriate for your chosen UI type
4. "componentCode": A complete React functional component as a string
5. "initialData": An array of data items EXTRACTED FROM THE CONVERSATIONS

CRITICAL - DATA EXTRACTION:
- Extract ACTUAL data mentioned in the conversations (meals, calories, items, amounts, etc.)
- Include dates when relevant (some UI types need them, some don't)
- If a conversation mentions "I had soup and rice for lunch", extract that as a data item
- Be thorough - extract every relevant data point mentioned
- Each item MUST have an "id" and relevant fields for the data type

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
- Section headers/groupings: Use text-sm font-medium text-zinc-500 (muted) - works for dates, categories, statuses, etc.
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

Section header (for dates, categories, or any grouping):
\`<h3 className="text-sm font-medium text-zinc-500 pt-4 pb-2">Section Title</h3>\`

Primary button (neutral, NOT colored):
\`<button className="rounded-xl bg-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-100 hover:bg-zinc-600 transition-colors">\`

Secondary/subtle button:
\`<button className="rounded-xl bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300 transition-colors">\`

Delete button (NO red - use neutral with icon):
\`<button className="rounded-xl bg-zinc-800/50 px-4 py-2.5 text-sm text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-300 transition-colors">\`

Input field:
\`<input className="w-full rounded-xl border border-zinc-700/50 bg-zinc-800 px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none" />\`

Summary/footer row (subtle, minimal):
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
- Generate the ${uiTypeSelection.selectedType} UI type as specified
- Follow the type-specific patterns provided above
- Use React hooks (useState, useEffect, useMemo, useCallback, useRef) - they are already available, DO NOT import them
- Use ONLY Tailwind CSS for styling - STRICTLY follow the design system above
- Use ONLY lucide-react for icons - you MUST import these (e.g., import { Plus, Trash2 } from 'lucide-react')
- Component receives props: { data, onDataChange }
- data is an array matching your dataSchema
- onDataChange(newData) should be called when user edits data
- Include add, edit, and delete functionality appropriate for the UI type
- Show summaries/totals/stats where appropriate for the data
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
- Organize data in a way that makes sense for your chosen UI type

EXAMPLE DATA SCHEMAS (choose what fits):

For a checklist/todo:
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "task": { "type": "string" },
    "completed": { "type": "boolean" },
    "priority": { "type": "string" }
  }
}

For a recipe collection:
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "ingredients": { "type": "array" },
    "instructions": { "type": "string" },
    "tags": { "type": "array" }
  }
}

For tracking with dates (only when temporal makes sense):
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "date": { "type": "string", "format": "date" },
    "description": { "type": "string" },
    "amount": { "type": "number" }
  }
}`,
          },
          {
            role: "user",
            content: `Generate a **${uiTypeSelection.selectedType}** widget for this theme.

GLOBAL TAG: ${globalTag.tag}

SELECTED UI TYPE: ${uiTypeSelection.selectedType}
REASONING: ${uiTypeSelection.reasoning}
${uiTypeSelection.selectedType === "TIMELINE" ? `EDITABLE TIMELINE: ${uiTypeSelection.editableTimeline}` : ""}

DETAILED CONVERSATION TAGS (what the user discussed):
${tagsList}

CONVERSATIONS WITH DATES:
${conversationsText}

IMPORTANT:
1. Generate a ${uiTypeSelection.selectedType} widget following the type-specific patterns
2. Extract every piece of relevant data mentioned in these conversations
3. Follow the design system exactly
4. Create a polished, production-ready component

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

    // For merge operations, preserve the existing migrated data
    // For normal operations, delete existing and insert new initial data
    if (!isMerge) {
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
    }
    // For merges, the data was already migrated by the merge API, so we keep it

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

