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

// Stage 1: UI Type Selection response
interface UITypeSelection {
  selectedType: string;
  reasoning: string;
  editableTimeline: boolean;
}

// Stage 2: Schema Design response
interface SchemaDesignResult {
  dataSchema: Record<string, unknown>;
  schemaReasoning: string;
  fieldDescriptions: Record<string, string>;
}

// Stage 3: Data Extraction response
interface DataExtractionResult {
  extractedData: Record<string, unknown>[];
}

// Stage 4: Code Generation response
interface CodeGenerationResult {
  name: string;
  description: string;
  componentCode: string;
}

// UI Type definitions with rich descriptions
const UI_TYPES_PROMPT = `
You are a UI type selector. Analyze the conversation data and choose the BEST visualization type.

=== AVAILABLE UI TYPES ===

1. **TEXT_DIFF** (Text/Code Diff View)
   - APPEARANCE: Two blocks of text/code displayed side-by-side. The left shows the "before" version, the right shows the "after" version. Additions are highlighted with a subtle green background, deletions with a subtle red background. Line numbers on both sides. A toolbar to toggle between side-by-side and unified diff views.
   - BEST FOR: Grammar checks, code reviews, document version comparisons, proofreading feedback, tracking text changes over time, comparing drafts.

2. **HISTORY** (History/Log View)
   - APPEARANCE: Vertical list grouped by date sections (e.g., "Monday, December 16"). Each entry is a row with timestamp, description, and optional metadata. Entries within the same day are visually grouped. Expandable entries for details.
   - BEST FOR: TEXT-HEAVY chronological logs - journal entries, meeting notes, activity descriptions, mood logs with text descriptions. NOT for numerical data like traffic counts, calories, or expenses (use CHART for those).

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

11. **CHART** (Chart/Visualization View)
    - APPEARANCE: Interactive charts with zinc-900 background. Bar charts for comparisons, line/area charts for trends over time, horizontal bars for rankings. Tooltips on hover showing values. Legend if multiple data series. Optional summary stats cards above/below the chart. Data table toggle for detail view.
    - BEST FOR: Data with numerical values that benefit from visual comparison - hourly traffic patterns, expense breakdowns by category, calorie tracking over time, frequency distributions, progress over days/weeks, workout stats, any data where patterns, trends, or comparisons are more meaningful as visualizations than lists.

=== DECISION CRITERIA ===

Analyze the data and consider IN THIS ORDER (first matching criterion wins):

1. **CHART FIRST**: Does the data have NUMERICAL VALUES (counts, amounts, durations, frequencies, calories, costs, times, scores) that would benefit from VISUAL PATTERNS? -> CHART
   - Traffic patterns by hour/day -> CHART (bar chart)
   - Expense amounts over time -> CHART (line/area chart)
   - Calorie counts per meal -> CHART (bar chart)
   - Workout stats with numbers -> CHART
   - Any data where seeing the SHAPE of numbers matters -> CHART

2. Is there a before/after text relationship? -> TEXT_DIFF
3. Are items being compared side-by-side? -> COMPARISON
4. Does spatial organization help? -> CANVAS
5. Are there items to complete/check off? -> CHECKLIST
6. Is this a collection to browse? -> CARDS
7. Are there aggregate KPIs/metrics? -> DASHBOARD
8. Is it temporal but primarily TEXT-BASED (journal entries, notes, logs without numbers)? -> HISTORY
9. Is it weekly planning/scheduling? -> WEEK
10. Does it span time periods (start/end dates)? -> TIMELINE
11. Is it just a simple list? -> SIMPLE_LIST

IMPORTANT: Prefer CHART over HISTORY when data has numerical values. HISTORY is for text-heavy logs (journal entries, meeting notes). CHART is for number-heavy data (traffic counts, calories, expenses, times).

=== OUTPUT FORMAT ===

Respond with JSON:
{
  "selectedType": "ONE_OF: TEXT_DIFF, HISTORY, WEEK, COMPARISON, CANVAS, TIMELINE, CHECKLIST, CARDS, DASHBOARD, SIMPLE_LIST, CHART",
  "reasoning": "2-3 sentences explaining why this type fits the data best and what visual structure will be most useful for the user.",
  "editableTimeline": true/false  // ONLY relevant for TIMELINE type: true if user would want to edit/plan (e.g., project planning), false if viewing historical/fixed data (e.g., historical events, transit schedules)
}
`;

// Stage 2: Schema Design prompt
const SCHEMA_DESIGN_PROMPT = `
You are a data schema designer. Given a UI type and conversation content, design the optimal data schema.

Your job is to:
1. Analyze what data is actually present in the conversations
2. Design a JSON Schema that captures all relevant fields
3. Ensure the schema is appropriate for the selected UI type

=== SCHEMA DESIGN PRINCIPLES ===

1. **Always include an "id" field** - Every item needs a unique identifier

2. **CRITICAL FOR CHART TYPE - MUST HAVE NUMERICAL DATA:**
   If UI type is CHART, the schema MUST include:
   - A numerical "value" field (type: number) - this is what gets visualized on the Y-axis
   - A "label" or "hour" or "category" field - this is what appears on the X-axis
   - Example for traffic: { id, hour: number (0-23), trafficCount: number, date: string }
   - Example for calories: { id, mealName: string, calories: number, date: string }
   - Example for expenses: { id, category: string, amount: number, date: string }
   - DO NOT create text-only schemas for CHART - charts need NUMBERS to visualize!

3. **Match the UI type requirements:**
   - CHART: MUST have numerical fields (value, count, amount, etc.) - NO text-only schemas
   - HISTORY: Include "date" field, "description", text-based details
   - DASHBOARD: Include "value", "previousValue", "label", "unit" fields
   - TIMELINE: Include "startDate", "endDate", "title" fields
   - CHECKLIST: Include "task", "completed" (boolean), optional "priority"
   - CARDS: Include "title", "description", optional "tags" array
   - COMPARISON: Include "name" and "attributes" object
   - WEEK: Include "date", "title", optional "category"
   - CANVAS: Include "title", "content", "x", "y" positions
   - TEXT_DIFF: Include "originalText", "revisedText", "title"
   - SIMPLE_LIST: Include "text" field

4. **Use appropriate field types:**
   - Dates: { "type": "string", "format": "date" } or "date-time"
   - Numbers: { "type": "number" } - REQUIRED for CHART type
   - Booleans: { "type": "boolean" }
   - Arrays: { "type": "array", "items": { ... } }
   - Objects: { "type": "object", "properties": { ... } }

5. **For CHART: Convert qualitative data to quantitative:**
   - "Heavy traffic" -> trafficLevel: 3 (or trafficCount: number)
   - "Peak at 5pm" -> hour: 17, isPeak: true
   - "Busy morning" -> timePeriod: "morning", busyScore: number
   - Charts CANNOT visualize text - they need NUMBERS

=== OUTPUT FORMAT ===

Respond with JSON:
{
  "dataSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      // ... other fields based on data and UI type
    },
    "required": ["id", ...]
  },
  "schemaReasoning": "2-3 sentences explaining why these fields were chosen and how they support the UI type.",
  "fieldDescriptions": {
    "fieldName": "What this field represents and where it comes from in the conversations"
  }
}
`;

// Stage 3: Data Extraction prompt
const DATA_EXTRACTION_PROMPT = `
You are a data extractor. Given a specific JSON schema and conversation content, extract ALL matching data items.

Your job is to:
1. Read through all conversations carefully
2. Extract every piece of data that matches the schema
3. Return an array of items, each conforming exactly to the schema

=== EXTRACTION RULES ===

1. **Be thorough** - Extract EVERY data point mentioned, don't skip any
2. **Generate unique IDs** - Each item needs a unique "id" (use descriptive slugs like "lunch-dec-15" or UUIDs)
3. **Use conversation dates** - When items mention dates, use them. When not specified, use the conversation date.
4. **Infer missing values** - If a field is in the schema but not explicitly stated, make reasonable inferences or use null
5. **Normalize data** - Convert text descriptions to appropriate field values (e.g., "high priority" -> "high")
6. **Don't fabricate** - Only extract data that's actually mentioned in conversations

=== EXAMPLE ===

If the schema has { id, date, description, calories } and a conversation says:
"I had a salad for lunch today, about 350 calories"

Extract:
{
  "id": "salad-lunch-dec-19",
  "date": "2024-12-19",
  "description": "Salad for lunch",
  "calories": 350
}

=== OUTPUT FORMAT ===

Respond with JSON:
{
  "extractedData": [
    { ... item matching schema ... },
    { ... item matching schema ... }
  ]
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

    CHART: `
=== CHART SPECIFIC PATTERNS ===

**DATA SCHEMA:**
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "label": { "type": "string" },
    "value": { "type": "number" },
    "category": { "type": "string" },
    "date": { "type": "string" }
  }
}

**RECHARTS IMPORTS:**
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie } from 'recharts';

**COMPONENT STRUCTURE:**
- Wrap ALL charts in ResponsiveContainer: <ResponsiveContainer width="100%" height={300}>
- Use zinc theme colors for chart elements:
  - Grid lines: stroke="#3f3f46" (zinc-700)
  - Axis text: fill="#a1a1aa" fontSize={12} (zinc-400)
  - Axis lines: stroke="#52525b" (zinc-600)
  - Primary data: fill="#f59e0b" or stroke="#f59e0b" (amber-500)
  - Secondary data: fill="#52525b" or stroke="#71717a" (zinc-600/zinc-500)
  - Tooltip: contentStyle={{ backgroundColor: '#27272a', border: '1px solid #3f3f46', borderRadius: '12px', padding: '8px 12px' }}
  - Tooltip text: labelStyle={{ color: '#a1a1aa' }} itemStyle={{ color: '#fafafa' }}
- Summary stats above chart: grid of stat cards with key numbers
- Optional data table below chart for detail view toggle

**CHART TYPE SELECTION - Choose based on data:**
- Bar chart (BarChart): comparing discrete categories (traffic by hour, expenses by category, counts per group)
- Line chart (LineChart): trends over time with continuous data (daily progress, temperature over time)
- Area chart (AreaChart): cumulative or volume data (total spending over time, accumulated values)
- Horizontal bar (BarChart layout="vertical"): rankings or comparisons (top items, leaderboards)
- Pie/Donut chart (PieChart): proportions of a whole (budget breakdown, time allocation)

**STYLING:**
- Chart container: rounded-2xl bg-zinc-800/30 p-6
- Chart title: text-sm font-medium text-zinc-400 mb-4
- Stat cards above: grid grid-cols-2 md:grid-cols-3 gap-4 mb-6
- Each stat card: rounded-xl bg-zinc-800/30 p-4
- Stat value: text-2xl font-bold text-zinc-100
- Stat label: text-xs text-zinc-500 mt-1
- Bar radius for rounded tops: radius={[4, 4, 0, 0]}

**IMPLEMENTATION HINTS:**
- Group/aggregate data using useMemo for performance
- For hourly data: create array of 24 hours, aggregate values per hour
- For daily data: group by date string, sum values
- For category data: group by category, count or sum
- Include add/edit/delete UI for individual data points (list below chart)
- Show totals, averages, or other relevant stats as summary cards
- Use tickFormatter on axes to format dates/numbers nicely

**EXAMPLE STRUCTURE:**
\`\`\`jsx
const chartData = useMemo(() => {
  // Transform data for chart
  return processedData;
}, [data]);

return (
  <div className="flex flex-col gap-6">
    {/* Summary Stats */}
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-xl bg-zinc-800/30 p-4">
        <div className="text-2xl font-bold text-zinc-100">{total}</div>
        <div className="text-xs text-zinc-500 mt-1">Total</div>
      </div>
    </div>
    
    {/* Chart */}
    <div className="rounded-2xl bg-zinc-800/30 p-6">
      <h3 className="text-sm font-medium text-zinc-400 mb-4">Chart Title</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
          <XAxis dataKey="label" stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
          <YAxis stroke="#52525b" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#27272a', border: '1px solid #3f3f46', borderRadius: '12px' }}
            labelStyle={{ color: '#a1a1aa' }}
            itemStyle={{ color: '#fafafa' }}
          />
          <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    
    {/* Data list for add/edit/delete */}
    <div className="flex flex-col gap-2">
      {data.map(item => (
        <div key={item.id} className="flex items-center justify-between py-3 border-b border-zinc-800/50">
          {/* Item content with edit/delete buttons */}
        </div>
      ))}
    </div>
  </div>
);
\`\`\`
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

CRITICAL QUESTION: Does this data contain NUMERICAL VALUES (counts, amounts, times, calories, costs, frequencies, durations, scores)?
- If YES -> strongly prefer CHART for visual patterns
- If NO (mostly text/descriptions) -> consider HISTORY or other types

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
    // STAGE 2: Schema Design
    // ============================================
    console.log(`[Stage 2] Designing schema for ${uiTypeSelection.selectedType}...`);

    const schemaResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: SCHEMA_DESIGN_PROMPT,
          },
          {
            role: "user",
            content: `Design a data schema for a **${uiTypeSelection.selectedType}** widget.

GLOBAL TAG: ${globalTag.tag}

UI TYPE: ${uiTypeSelection.selectedType}
UI TYPE REASONING: ${uiTypeSelection.reasoning}
${uiTypeSelection.selectedType === "CHART" ? `
CRITICAL FOR CHART: The schema MUST include NUMERICAL fields that can be visualized:
- A "value" or "count" or "amount" field with type: number
- A "label" or "category" or "hour" field for the X-axis
- Example: { id, hour: number, trafficCount: number, date: string }
- DO NOT create a schema with only text fields - charts need NUMBERS!
` : ""}
CONVERSATION TAGS (what the user discussed):
${tagsList}

CONVERSATIONS WITH DATES:
${conversationsText}

Design the optimal schema for this UI type and data.`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!schemaResponse.ok) {
      const errorText = await schemaResponse.text();
      throw new Error(`Schema Design API error: ${errorText}`);
    }

    const schemaData = await schemaResponse.json();
    const schemaContent = schemaData.choices[0]?.message?.content;

    if (!schemaContent) {
      throw new Error("No content in Schema Design response");
    }

    const schemaResult: SchemaDesignResult = JSON.parse(schemaContent);
    console.log(`[Stage 2] Schema designed with fields:`, Object.keys(schemaResult.dataSchema.properties || {}));
    console.log(`[Stage 2] Reasoning: ${schemaResult.schemaReasoning}`);

    // ============================================
    // STAGE 3: Data Extraction
    // ============================================
    console.log(`[Stage 3] Extracting data using schema...`);

    const extractionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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
            content: DATA_EXTRACTION_PROMPT,
          },
          {
            role: "user",
            content: `Extract all data matching this schema from the conversations.

=== DATA SCHEMA ===
${JSON.stringify(schemaResult.dataSchema, null, 2)}

=== FIELD DESCRIPTIONS ===
${JSON.stringify(schemaResult.fieldDescriptions, null, 2)}

=== CONVERSATIONS WITH DATES ===
${conversationsText}

Extract EVERY piece of data that matches this schema. Be thorough - don't miss any data points.`,
          },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!extractionResponse.ok) {
      const errorText = await extractionResponse.text();
      throw new Error(`Data Extraction API error: ${errorText}`);
    }

    const extractionData = await extractionResponse.json();
    const extractionContent = extractionData.choices[0]?.message?.content;

    if (!extractionContent) {
      throw new Error("No content in Data Extraction response");
    }

    const extractionResult: DataExtractionResult = JSON.parse(extractionContent);
    console.log(`[Stage 3] Extracted ${extractionResult.extractedData.length} data items`);

    // ============================================
    // STAGE 4: Code Generation
    // ============================================
    console.log(`[Stage 4] Generating ${uiTypeSelection.selectedType} component code...`);

    // Build type-specific instructions based on selected UI type
    const typeSpecificInstructions = getTypeSpecificInstructions(uiTypeSelection.selectedType, uiTypeSelection.editableTimeline);

    const codeResponse = await fetch("https://api.openai.com/v1/chat/completions", {
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

The UI type and data schema have already been decided. Your ONLY job is to generate the React component code.

=== EXACT DATA SCHEMA (use these exact field names) ===
${JSON.stringify(schemaResult.dataSchema, null, 2)}

=== SAMPLE DATA (this is what the component will receive) ===
${JSON.stringify(extractionResult.extractedData.slice(0, 3), null, 2)}

${typeSpecificInstructions}

Generate a JSON response with:
1. "name": A concise widget name (e.g., "Recipe Collection", "Task Tracker", "Expense Dashboard")
2. "description": One sentence describing what this widget shows
3. "componentCode": A complete React functional component as a string

CRITICAL REQUIREMENTS:
- Use the EXACT field names from the schema above (data.fieldName)
- The component receives { data, onDataChange } props where data is an array matching the schema
- DO NOT generate any data - data extraction is already done
- Focus ONLY on creating a polished UI component

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

**CHARTS - USE RECHARTS (for CHART UI type):**
- Recharts is available in the sandbox for data visualization
- Import from 'recharts': BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie
- ALWAYS wrap charts in ResponsiveContainer for responsive sizing: <ResponsiveContainer width="100%" height={300}>
- Theme colors for charts:
  - Primary data: fill="#f59e0b" (amber-500)
  - Secondary data: fill="#52525b" (zinc-600)
  - Grid lines: stroke="#3f3f46" (zinc-700)
  - Axis lines: stroke="#52525b", tick fill="#a1a1aa"
  - Tooltip: contentStyle={{ backgroundColor: '#27272a', border: '1px solid #3f3f46', borderRadius: '12px' }}
- Use radius={[4, 4, 0, 0]} on Bar components for rounded top corners
- Add CartesianGrid with strokeDasharray="3 3" and vertical={false} for clean look

COMPONENT REQUIREMENTS:
- Must be a single, self-contained React functional component
- Generate the ${uiTypeSelection.selectedType} UI type as specified
- Use the EXACT field names from the schema provided above
- Use React hooks (useState, useEffect, useMemo, useCallback, useRef) - they are already available, DO NOT import them
- Use ONLY Tailwind CSS for styling - STRICTLY follow the design system above
- Use lucide-react for icons - you MUST import these (e.g., import { Plus, Trash2 } from 'lucide-react')
- For CHART UI type: Use recharts for visualizations - import from 'recharts'
- Component receives props: { data, onDataChange }
- data is an array matching the schema above
- onDataChange(newData) should be called when user edits data
- Include add, edit, and delete functionality appropriate for the UI type
- Handle empty state gracefully with centered content and muted styling

COMPONENT CODE FORMAT:
- Start with imports: import { IconName1, IconName2 } from 'lucide-react';
- For CHART type, also import from 'recharts'
- CRITICAL - FUNCTION NAME MUST BE "Widget": function Widget({ data, onDataChange }) {
- End with: export default Widget;
- The function MUST be named exactly "Widget" - not TrafficHistory, not DataView, not anything else - EXACTLY "Widget"

CRITICAL - IMPORTS:
  * DO import from 'lucide-react'
  * DO import from 'recharts' for CHART UI type
  * DO NOT import React hooks - these are already available
  * DO NOT import React itself - React is available globally`,
          },
          {
            role: "user",
            content: `Generate ONLY the React component code for a **${uiTypeSelection.selectedType}** widget.

WIDGET NAME THEME: ${globalTag.tag}

The data schema and extracted data have already been provided in the system prompt.
Your ONLY job is to write the component code that renders this data beautifully.

CRITICAL: The function MUST be named "Widget" exactly. Example:
function Widget({ data, onDataChange }) {
  // component code
}
export default Widget;

Generate the JSON response with: name, description, and componentCode.`,
          },
        ],
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    if (!codeResponse.ok) {
      const errorText = await codeResponse.text();
      throw new Error(`Code Generation API error: ${errorText}`);
    }

    const codeData = await codeResponse.json();
    const codeContent = codeData.choices[0]?.message?.content;

    if (!codeContent) {
      throw new Error("No content in Code Generation response");
    }

    const codeResult: CodeGenerationResult = JSON.parse(codeContent);
    console.log(`[Stage 4] Generated component: ${codeResult.name}`);

    // Update widget with generated code and schema
    const { error: updateError } = await supabase
      .from("ui_widgets")
      .update({
        name: codeResult.name,
        description: codeResult.description,
        component_code: codeResult.componentCode,
        data_schema: schemaResult.dataSchema,
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

      // Insert extracted data from Stage 3
      if (extractionResult.extractedData && extractionResult.extractedData.length > 0) {
        const dataRows = extractionResult.extractedData.map((item, index) => ({
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

    console.log(`[generate-widget-ui] Successfully generated widget with ${extractionResult.extractedData.length} data items`);

    return new Response(
      JSON.stringify({
        success: true,
        widgetId,
        name: codeResult.name,
        description: codeResult.description,
        dataCount: extractionResult.extractedData?.length || 0,
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

