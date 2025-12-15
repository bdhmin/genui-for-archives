import { NextResponse } from "next/server";
import { getConversationStore } from "@/lib/conversationStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = getConversationStore();
    const conversations = await store.listConversations();
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("List conversations error", error);
    return NextResponse.json(
      { error: "Failed to list conversations" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const store = getConversationStore();
    const conversation = await store.createConversation();
    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Create conversation error", error);
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}

