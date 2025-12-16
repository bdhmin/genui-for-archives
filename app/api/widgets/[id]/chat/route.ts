import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import {
  ChatMessage,
  getConversationStore,
} from "@/lib/conversationStore";
import { generateConversationTitle } from "@/lib/titleGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes for code generation

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

type RouteParams = {
  params: Promise<{ id: string }>;
};

// System prompt for widget code editing
const WIDGET_EDIT_SYSTEM_PROMPT = `You are a React component editor that modifies existing widget code based on user requests.

You will receive:
1. The current React component code
2. The current data schema
3. The user's request for changes

Your response MUST be in this exact format:
1. First, provide a brief explanation of what you're changing (1-3 sentences)
2. Then output the COMPLETE updated component code wrapped in a code block with \`\`\`jsx and \`\`\`

CRITICAL RULES:
- ALWAYS output the COMPLETE component code, not just the changed parts
- The component must be self-contained and work exactly as before but with the requested changes
- Keep the same function signature: function Widget({ data, onDataChange }) { ... }
- Keep export default Widget; at the end
- Preserve all existing functionality unless explicitly asked to remove it
- Use ONLY React hooks (useState, useEffect, useMemo, useCallback, useRef)
- Use ONLY Tailwind CSS for styling
- Use ONLY lucide-react for icons - import at top: import { Plus, Trash2, Edit2, Check, X, Calendar } from 'lucide-react';
- NEVER use emoji or text symbols for icons - ALWAYS use Lucide icons
- Icon sizing: className="w-4 h-4" (small), "w-5 h-5" (medium)

DESIGN SYSTEM - FOLLOW EXACTLY:
- Background: bg-zinc-900, bg-zinc-800, bg-zinc-800/30
- Text: text-zinc-100 (primary), text-zinc-400 (secondary), text-zinc-500 (muted)
- Accent: amber-500, amber-600 (highlights, progress, active states)
- Buttons: rounded-xl bg-zinc-700 hover:bg-zinc-600 (primary), bg-zinc-800 hover:bg-zinc-700 (secondary)
- Inputs: rounded-xl border border-zinc-700/50 bg-zinc-800
- Cards: rounded-2xl border border-zinc-700/50 bg-zinc-800/30 p-5
- Use transitions: transition-colors duration-200
- NEVER use semantic colors (no red for delete, no green for add)

Example response format:
---
I'll add a search filter to help you quickly find items. The search will filter the list in real-time as you type.

\`\`\`jsx
function Widget({ data, onDataChange }) {
  const [searchTerm, setSearchTerm] = useState('');
  // ... rest of the complete component code
}

export default Widget;
\`\`\`
---`;

export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { id: widgetId } = await params;
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

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const supabase = getSupabaseServerClient();
    const store = getConversationStore();

    // Fetch widget details
    const { data: widget, error: widgetError } = await supabase
      .from("ui_widgets")
      .select("id, name, component_code, data_schema")
      .eq("id", widgetId)
      .single();

    if (widgetError || !widget) {
      return NextResponse.json(
        { error: "Widget not found" },
        { status: 404 }
      );
    }

    // Get or create conversation for this widget
    let conversation = body.conversationId
      ? await store.getConversation(body.conversationId)
      : await store.getConversationByWidgetId(widgetId);

    let isNewConversation = false;
    if (!conversation) {
      conversation = await store.createConversation({ widgetId });
      isNewConversation = true;
    }

    // Add user message
    const userMessage: ChatMessage = {
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };
    await store.appendMessage(conversation.id, userMessage);

    // Get updated conversation with all messages
    const updated = await store.getConversation(conversation.id);
    const history = updated?.messages ?? [userMessage];

    // Build messages for OpenAI
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: WIDGET_EDIT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Current widget: "${widget.name}"

Current component code:
\`\`\`jsx
${widget.component_code}
\`\`\`

Current data schema:
\`\`\`json
${JSON.stringify(widget.data_schema, null, 2)}
\`\`\`

Previous conversation context:
${history.slice(0, -1).map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n")}

User's request: ${input}`,
      },
    ];

    // Stream response from OpenAI
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: openaiMessages,
      stream: true,
      temperature: 0.7,
    });

    const encoder = new TextEncoder();
    let fullContent = "";

    const readable = new ReadableStream({
      start(controller) {
        // Send conversation ID and widget ID first
        controller.enqueue(
          encoder.encode(
            `event:meta\ndata:${JSON.stringify({
              conversationId: conversation!.id,
              widgetId,
            })}\n\n`
          )
        );

        (async () => {
          try {
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content ?? "";
              if (!delta) continue;
              fullContent += delta;
              controller.enqueue(
                encoder.encode(
                  `event:token\ndata:${JSON.stringify(delta)}\n\n`
                )
              );
            }

            // Save assistant message
            const assistantMessage: ChatMessage = {
              role: "assistant",
              content: fullContent,
              createdAt: new Date().toISOString(),
            };
            await store.appendMessage(conversation!.id, assistantMessage);

            // Generate title for new conversations
            if (isNewConversation) {
              try {
                const title = await generateConversationTitle({
                  userMessage: input,
                  assistantMessage: fullContent,
                });
                await store.setTitle(conversation!.id, title);
                // Send title update to frontend
                controller.enqueue(
                  encoder.encode(
                    `event:title\ndata:${JSON.stringify(title)}\n\n`
                  )
                );
              } catch (titleError) {
                console.error("[Widget Chat] Failed to generate title:", titleError);
              }
            }

            // Extract code from response
            const codeMatch = fullContent.match(/```(?:jsx|javascript|js)?\n([\s\S]*?)```/);
            if (codeMatch && codeMatch[1]) {
              const newCode = codeMatch[1].trim();
              
              // Update widget component code in database
              const { error: updateError } = await supabase
                .from("ui_widgets")
                .update({ 
                  component_code: newCode,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", widgetId);

              if (updateError) {
                console.error("[Widget Chat] Failed to update widget code:", updateError);
                controller.enqueue(
                  encoder.encode(
                    `event:error\ndata:${JSON.stringify("Failed to save code changes")}\n\n`
                  )
                );
              } else {
                // Send code update event
                controller.enqueue(
                  encoder.encode(
                    `event:code_updated\ndata:${JSON.stringify({ 
                      success: true,
                      widgetId,
                    })}\n\n`
                  )
                );
              }
            }

            controller.enqueue(
              encoder.encode(`event:done\ndata:done\n\n`)
            );
          } catch (error) {
            console.error("[Widget Chat] Stream error:", error);
            controller.enqueue(
              encoder.encode(
                `event:error\ndata:${JSON.stringify("Stream error occurred")}\n\n`
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
    console.error("[Widget Chat] API error:", error);
    return NextResponse.json(
      { error: "Unexpected error while processing request" },
      { status: 500 }
    );
  }
}

