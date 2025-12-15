import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type Conversation = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export interface ConversationStore {
  createConversation(): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  appendMessage(id: string, message: ChatMessage): Promise<Conversation | null>;
}

const DATA_FILE = path.join(process.cwd(), "data", "conversations.json");

class FileConversationStore implements ConversationStore {
  private async ensureFile() {
    const dir = path.dirname(DATA_FILE);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(DATA_FILE, JSON.stringify({ conversations: [] }, null, 2), "utf8");
    }
  }

  private async readAll(): Promise<Conversation[]> {
    await this.ensureFile();
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as { conversations?: Conversation[] };
    return parsed.conversations ?? [];
  }

  private async writeAll(conversations: Conversation[]) {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify({ conversations }, null, 2),
      "utf8"
    );
  }

  async createConversation(): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    const conversations = await this.readAll();
    conversations.push(conversation);
    await this.writeAll(conversations);
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const conversations = await this.readAll();
    return conversations.find((c) => c.id === id) ?? null;
  }

  async appendMessage(
    id: string,
    message: ChatMessage
  ): Promise<Conversation | null> {
    const conversations = await this.readAll();
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) return null;

    conversation.messages.push(message);
    conversation.updatedAt = new Date().toISOString();
    await this.writeAll(conversations);
    return conversation;
  }
}

let store: ConversationStore | null = null;

export function getConversationStore(): ConversationStore {
  if (!store) {
    store = new FileConversationStore();
  }
  return store;
}

// Future: swap FileConversationStore with a Supabase/Postgres implementation
// that matches the ConversationStore interface for minimal changes.
// Suggested Supabase schema (minimal):
// - conversations(id uuid primary key, created_at timestamptz, updated_at timestamptz)
// - messages(id uuid primary key, conversation_id uuid references conversations(id),
//            role text, content text, created_at timestamptz)
// Implement ConversationStore methods by mapping to these tables.

