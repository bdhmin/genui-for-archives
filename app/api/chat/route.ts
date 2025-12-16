import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ChatMessage,
  Conversation,
  getConversationStore,
} from "@/lib/conversationStore";
import { generateConversationTitle } from "@/lib/titleGenerator";
import { 
  triggerRound1Tagging,
  triggerRound2Tagging,
  updateLinkedWidgets,
  getLinkedWidgetsContext,
  LinkedWidgetContext,
} from "@/lib/taggingService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

type WidgetDataUpdate = {
  widgetId: string;
  widgetName: string;
  data?: Record<string, unknown>;
  action: "add" | "update" | "replace" | "delete";
  targetDate?: string;
  targetType?: string;
  reasoning: string;
};

/**
 * Format a date as YYYY-MM-DD in local timezone (not UTC)
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build a system prompt that includes widget context and chain-of-thought instructions
 * @param widgets - Linked widgets with their schemas and data
 * @param userMessageDate - The date when the user's message was sent (for relative date resolution)
 */
function buildSystemPromptWithWidgetContext(
  widgets: LinkedWidgetContext[],
  userMessageDate?: Date
): string {
  // Use the user's message date for relative date resolution, or fall back to current date
  const referenceDate = userMessageDate || new Date();
  const formattedDate = referenceDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  // Use local date, not UTC, to avoid timezone issues
  const isoDate = formatLocalDate(referenceDate);

  if (widgets.length === 0) {
    return `You are a helpful assistant. Today is ${formattedDate}.

You help users with their questions and tasks. Be conversational and helpful.`;
  }

  const widgetDescriptions = widgets.map(w => {
    const schemaStr = JSON.stringify(w.dataSchema, null, 2);
    const recentDataStr = w.recentData.length > 0 
      ? JSON.stringify(w.recentData.slice(0, 5), null, 2)
      : "No data yet";
    
    return `### Widget: ${w.name}
ID: ${w.id}
Description: ${w.description || "No description"}
Data Schema:
${schemaStr}
Recent Data (last 5 entries):
${recentDataStr}`;
  }).join("\n\n");

  return `You are a helpful assistant with access to connected data widgets. Today is ${formattedDate} (${isoDate}).

## Connected Widgets
This conversation is linked to the following data-tracking widgets:

${widgetDescriptions}

## Your Responsibilities

1. **Answer the user's question** naturally and helpfully
2. **Proactively identify data opportunities** - when the user mentions information that could populate or update a widget, note it

## Chain-of-Thought Data Analysis

Before responding, think through these questions (internally, don't include in response):
- Does this message contain information relevant to any connected widget?
- Should I extract data to add to a widget?
- Is this updating/correcting existing data (same date/type) or adding new data?
- What specific data fields can I extract?

## Data Output Format

If you identify data operations needed for a widget, include a special block at the END of your response:

\`\`\`widget-data
{
  "thinking": "Your reasoning about what data to extract and why",
  "updates": [
    {
      "widgetId": "widget-uuid",
      "widgetName": "Widget Name",
      "data": { ...data matching the widget's schema... },
      "action": "add" | "update" | "replace" | "delete",
      "targetDate": "YYYY-MM-DD (for delete/update to match)",
      "targetType": "optional type field to match (e.g., 'dinner')",
      "reasoning": "Why this operation"
    }
  ]
}
\`\`\`

ACTIONS:
- "add" - Add new data entry
- "update" or "replace" - Update existing entry matching targetDate + targetType
- "delete" - Remove existing entry matching targetDate + targetType (no data field needed)

IMPORTANT:
- The "date" field should use "${isoDate}" for anything referring to "today", "tonight", "now"
- Use "delete" if user says something was wrong, didn't happen, or wants to remove data
- Use "update"/"replace" if correcting existing data with new values
- Use "add" for new distinct entries
- Be aggressive about correcting data - if user says "actually" or "I meant", update/delete accordingly
- Only include the widget-data block if there's actually relevant data operations
- The widget-data block should be at the very end of your response, after your natural response

## Examples

Example 1 - Adding data:
User: "I had a caesar salad for lunch, about 400 calories"

Response: "That sounds healthy! Caesar salads are a great choice."

\`\`\`widget-data
{
  "thinking": "User mentioned a meal (lunch) with specific food and calories.",
  "updates": [
    {
      "widgetId": "...",
      "widgetName": "Meal Tracker",
      "data": { "id": "lunch-${isoDate}", "date": "${isoDate}", "meal": "lunch", "food": "Caesar salad", "calories": 400 },
      "action": "add",
      "reasoning": "User reported their lunch meal"
    }
  ]
}
\`\`\`

Example 2 - Correcting data:
User: "Actually, I didn't have lunch today, I skipped it"

Response: "No problem! Sometimes it's fine to skip a meal."

\`\`\`widget-data
{
  "thinking": "User says they didn't have lunch - need to delete any lunch entry for today.",
  "updates": [
    {
      "widgetId": "...",
      "widgetName": "Meal Tracker",
      "action": "delete",
      "targetDate": "${isoDate}",
      "targetType": "lunch",
      "reasoning": "User clarified they skipped lunch"
    }
  ]
}
\`\`\`

Example 3 - Updating data:
User: "Wait, that lunch was actually pizza, not salad"

Response: "Got it, I'll update that!"

\`\`\`widget-data
{
  "thinking": "User is correcting the lunch entry - pizza instead of salad.",
  "updates": [
    {
      "widgetId": "...",
      "widgetName": "Meal Tracker",
      "data": { "id": "lunch-${isoDate}", "date": "${isoDate}", "meal": "lunch", "food": "Pizza", "calories": 600 },
      "action": "update",
      "targetDate": "${isoDate}",
      "targetType": "lunch",
      "reasoning": "Correcting lunch entry from salad to pizza"
    }
  ]
}
\`\`\``;
}

/**
 * Parse widget-data block from AI response and extract updates
 */
function parseWidgetDataFromResponse(content: string): {
  cleanContent: string;
  updates: WidgetDataUpdate[];
  thinking: string | null;
} {
  // Match the widget-data code block
  const widgetDataRegex = /```widget-data\s*\n([\s\S]*?)\n```/;
  const match = content.match(widgetDataRegex);

  if (!match) {
    return { cleanContent: content, updates: [], thinking: null };
  }

  try {
    const jsonContent = match[1].trim();
    const parsed = JSON.parse(jsonContent) as {
      thinking?: string;
      updates?: WidgetDataUpdate[];
    };

    // Remove the widget-data block from the response
    const cleanContent = content.replace(widgetDataRegex, "").trim();

    return {
      cleanContent,
      updates: parsed.updates || [],
      thinking: parsed.thinking || null,
    };
  } catch (err) {
    console.error("[Chat] Failed to parse widget-data block:", err);
    // If parsing fails, return the original content
    return { cleanContent: content, updates: [], thinking: null };
  }
}

/**
 * Apply widget data updates to the database
 */
async function applyWidgetDataUpdates(
  updates: WidgetDataUpdate[],
  conversationId: string
): Promise<void> {
  if (updates.length === 0) return;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn("[Chat] Supabase not configured, skipping widget updates");
    return;
  }

  console.log(`[Chat] Applying ${updates.length} widget data update(s)`);

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch all existing data once for efficiency
  const widgetIds = [...new Set(updates.map(u => u.widgetId))];
  const existingDataByWidget: Record<string, { id: string; data: Record<string, unknown> }[]> = {};
  
  for (const wId of widgetIds) {
    const { data } = await supabase
      .from("ui_widget_data")
      .select("id, data")
      .eq("widget_id", wId);
    existingDataByWidget[wId] = (data || []) as { id: string; data: Record<string, unknown> }[];
  }

  // Helper to find matching entry
  const findMatchingEntry = (widgetId: string, targetDate: string, targetType?: string) => {
    const entries = existingDataByWidget[widgetId] || [];
    return entries.find((existing) => {
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

  for (const update of updates) {
    try {
      console.log(`[Chat] Processing ${update.action} for widget ${update.widgetName}:`, {
        reasoning: update.reasoning,
      });

      if (update.action === "delete") {
        // Delete operation
        const targetDate = update.targetDate || (update.data?.date as string);
        if (!targetDate) {
          console.warn(`[Chat] Delete operation missing targetDate`);
          continue;
        }
        
        const matchingEntry = findMatchingEntry(update.widgetId, targetDate, update.targetType);
        if (matchingEntry) {
          const { error } = await supabase
            .from("ui_widget_data")
            .delete()
            .eq("id", matchingEntry.id);
          
          if (error) {
            console.error(`[Chat] Failed to delete widget data:`, error);
          } else {
            console.log(`[Chat] Deleted widget data entry for ${targetDate}`);
            // Remove from local cache
            const entries = existingDataByWidget[update.widgetId];
            const idx = entries?.indexOf(matchingEntry);
            if (idx !== undefined && idx > -1) entries?.splice(idx, 1);
          }
        } else {
          console.log(`[Chat] No matching entry found to delete for ${targetDate}`);
        }
        
      } else if (update.action === "replace" || update.action === "update") {
        // Update/replace operation
        const targetDate = update.targetDate || (update.data?.date as string) || "";
        
        const matchingEntry = findMatchingEntry(update.widgetId, targetDate, update.targetType);
        if (matchingEntry && update.data) {
          const { error } = await supabase
            .from("ui_widget_data")
            .update({
              data: update.data,
              source_conversation_id: conversationId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", matchingEntry.id);

          if (error) {
            console.error(`[Chat] Failed to update widget data:`, error);
          } else {
            console.log(`[Chat] Updated existing widget data entry`);
          }
        } else if (update.data) {
          // No existing entry, insert new
          const { error } = await supabase.from("ui_widget_data").insert({
            widget_id: update.widgetId,
            data: update.data,
            source_conversation_id: conversationId,
          });

          if (error) {
            console.error(`[Chat] Failed to insert widget data:`, error);
          } else {
            console.log(`[Chat] Inserted new widget data entry (no match to update)`);
          }
        }
        
      } else if (update.action === "add" && update.data) {
        // Add operation - always insert new
        const { error } = await supabase.from("ui_widget_data").insert({
          widget_id: update.widgetId,
          data: update.data,
          source_conversation_id: conversationId,
        });

        if (error) {
          console.error(`[Chat] Failed to add widget data:`, error);
        } else {
          console.log(`[Chat] Added new widget data entry`);
        }
      }
    } catch (err) {
      console.error(`[Chat] Error processing widget update:`, err);
    }
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatRequest;
    const input = body.message?.trim();

    if (!input) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing" },
        { status: 500 }
      );
    }

    const store = getConversationStore();
    let conversation: Conversation | null = null;

    if (body.conversationId) {
      conversation = await store.getConversation(body.conversationId);
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }
    } else {
      conversation = await store.createConversation();
    }

    // Fetch linked widgets context for proactive data population
    let linkedWidgets: LinkedWidgetContext[] = [];
    if (body.conversationId) {
      const widgetContext = await getLinkedWidgetsContext(body.conversationId);
      if (widgetContext.success) {
        linkedWidgets = widgetContext.widgets;
        console.log(`[Chat] Found ${linkedWidgets.length} linked widgets for conversation`);
      }
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };

    await store.appendMessage(conversation.id, userMessage);
    const updated = await store.getConversation(conversation.id);
    const history = updated?.messages ?? [userMessage];

    // Use the user's message timestamp for relative date resolution
    // This ensures "today" refers to when the user sent the message, not when it's processed
    const userMessageTimestamp = new Date(userMessage.createdAt);

    // Build messages with system prompt if we have linked widgets
    const systemPrompt = buildSystemPromptWithWidgetContext(linkedWidgets, userMessageTimestamp);
    const messagesForAI: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
      ...history.map(({ role, content }) => ({ 
        role: role as "user" | "assistant", 
        content 
      })),
    ];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesForAI,
      stream: true,
    });

    const encoder = new TextEncoder();
    let fullContent = "";
    let streamedContent = ""; // Track what we've actually streamed to user
    let widgetDataBlockStarted = false;

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event:meta\ndata:${JSON.stringify({
              conversationId: conversation!.id,
            })}\n\n`
          )
        );

        (async () => {
          try {
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (!delta) continue;
              fullContent += delta;
              
              // Check if we're entering a widget-data block
              if (!widgetDataBlockStarted && fullContent.includes("```widget-data")) {
                widgetDataBlockStarted = true;
                // Stream only content before the widget-data block
                const blockStart = fullContent.indexOf("```widget-data");
                const contentToStream = fullContent.slice(streamedContent.length, blockStart);
                if (contentToStream) {
                  streamedContent += contentToStream;
                  controller.enqueue(
                    encoder.encode(
                      `event:token\ndata:${JSON.stringify(contentToStream)}\n\n`
                    )
                  );
                }
                continue;
              }
              
              // Skip streaming if we're inside the widget-data block
              if (widgetDataBlockStarted) {
                continue;
              }
              
              // Normal streaming
              streamedContent += delta;
              controller.enqueue(
                encoder.encode(
                  `event:token\ndata:${JSON.stringify(delta)}\n\n`
                )
              );
            }

            // Parse widget data updates from the response
            const { cleanContent, updates, thinking } = parseWidgetDataFromResponse(fullContent);
            
            if (thinking) {
              console.log("[Chat] AI data thinking:", thinking);
            }

            const assistantMessage: ChatMessage = {
              role: "assistant",
              content: cleanContent, // Store clean content without widget-data block
              createdAt: new Date().toISOString(),
            };

            await store.appendMessage(conversation!.id, assistantMessage);

            // Apply widget data updates if any were extracted
            if (updates.length > 0) {
              console.log(`[Chat] Applying ${updates.length} widget update(s) from AI response`);
              applyWidgetDataUpdates(updates, conversation!.id).catch((err) => {
                console.error("[Chat] Failed to apply widget updates:", err);
              });
            }

            // Trigger tagging pipeline asynchronously
            // Round 1: Generate conversation-level tags
            // Round 2: Create global tags and trigger widget generation
            triggerRound1Tagging(conversation!.id)
              .then((round1Result) => {
                console.log("[Chat] Round 1 tagging result:", JSON.stringify(round1Result));
                if (round1Result.success) {
                  // Explicitly trigger round 2 to create global tags
                  return triggerRound2Tagging();
                }
                return null;
              })
              .then((round2Result) => {
                if (round2Result) {
                  console.log("[Chat] Round 2 tagging result:", JSON.stringify(round2Result));
                }
              })
              .catch((err) => {
                console.error("[Chat] Failed to trigger tagging:", err);
              });

            // Update any widgets linked to this conversation with the new data
            // This handles data extraction via edge functions for conversations
            // that don't have explicit AI-suggested updates
            updateLinkedWidgets(conversation!.id).catch((err) => {
              console.error("[Chat] Failed to update linked widgets:", err);
            });

            const shouldGenerateTitle =
              !conversation?.title ||
              conversation.title === "New conversation";

            if (shouldGenerateTitle) {
              const title = await generateConversationTitle({
                userMessage: input,
                assistantMessage: fullContent,
              });
              await store.setTitle(conversation!.id, title);
            }

            controller.enqueue(
              encoder.encode(`event:done\ndata:done\n\n`)
            );
          } catch (error) {
            console.error("Stream error", error);
            controller.enqueue(
              encoder.encode(
                `event:error\ndata:${JSON.stringify("stream error")}\n\n`
              )
            );
          } finally {
            controller.close();
          }
        })();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error", error);
    return NextResponse.json(
      { error: "Unexpected error while generating response" },
      { status: 500 }
    );
  }
}

