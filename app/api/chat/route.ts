import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ChatMessage,
  Conversation,
  getConversationStore,
} from "@/lib/conversationStore";

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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: history.map(({ role, content }) => ({ role, content })),
      max_output_tokens: 500,
    });

    const assistantContent = completion.choices[0]?.message?.content ?? "";
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantContent,
      createdAt: new Date().toISOString(),
    };

    await store.appendMessage(conversation.id, assistantMessage);

    return NextResponse.json({
      conversationId: conversation.id,
      message: assistantMessage,
    });
  } catch (error) {
    console.error("Chat API error", error);
    return NextResponse.json(
      { error: "Unexpected error while generating response" },
      { status: 500 }
    );
  }
}

