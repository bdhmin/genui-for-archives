import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ChatMessage,
  Conversation,
  getConversationStore,
} from "@/lib/conversationStore";
import { generateConversationTitle } from "@/lib/titleGenerator";
import { triggerRound1Tagging } from "@/lib/taggingService";

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

            // Trigger tagging pipeline asynchronously (fire and forget)
            triggerRound1Tagging(conversation!.id).catch((err) => {
              console.error("[Chat] Failed to trigger tagging:", err);
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

