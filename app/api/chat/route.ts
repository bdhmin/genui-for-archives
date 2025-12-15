import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ChatMessage,
  Conversation,
  getConversationStore,
} from "@/lib/conversationStore";
import { generateConversationTitle } from "@/lib/titleGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

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

    const userMessage: ChatMessage = {
      role: "user",
      content: input,
      createdAt: new Date().toISOString(),
    };

    await store.appendMessage(conversation.id, userMessage);
    const updated = await store.getConversation(conversation.id);
    const history = updated?.messages ?? [userMessage];

    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history.map(({ role, content }) => ({ role, content })),
      stream: true,
    });

    const encoder = new TextEncoder();
    let fullContent = "";

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
              controller.enqueue(
                encoder.encode(
                  `event:token\ndata:${JSON.stringify(delta)}\n\n`
                )
              );
            }

            const assistantMessage: ChatMessage = {
              role: "assistant",
              content: fullContent,
              createdAt: new Date().toISOString(),
            };

            await store.appendMessage(conversation!.id, assistantMessage);

            // Check if we need to generate a title
            const updatedConvo = await store.getConversation(conversation!.id);
            const currentTitle = updatedConvo?.title ?? "";
            const shouldGenerateTitle =
              !currentTitle || currentTitle === "New conversation";

            console.log("[Title Gen] Check:", {
              currentTitle,
              shouldGenerateTitle,
              conversationId: conversation!.id,
            });

            if (shouldGenerateTitle) {
              try {
                const title = await generateConversationTitle({
                  userMessage: input,
                  assistantMessage: fullContent,
                });
                console.log("[Title Gen] Generated title:", title);
                await store.setTitle(conversation!.id, title);
                console.log("[Title Gen] Title saved successfully");
                // Send title update event so frontend can update immediately
                controller.enqueue(
                  encoder.encode(
                    `event:title\ndata:${JSON.stringify(title)}\n\n`
                  )
                );
                console.log("[Title Gen] Title event sent to frontend");
              } catch (titleError) {
                console.error("[Title Gen] Error:", titleError);
              }
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

