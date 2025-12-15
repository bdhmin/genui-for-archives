import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { getSupabaseServerClient } from "./supabaseServer";

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
  title: string;
  messages: ChatMessage[];
  widgetId?: string | null;
};

export type ConversationListItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
};

export interface ConversationStore {
  createConversation(options?: { widgetId?: string }): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  getConversationByWidgetId(widgetId: string): Promise<Conversation | null>;
  listConversations(): Promise<ConversationListItem[]>;
  appendMessage(id: string, message: ChatMessage): Promise<Conversation | null>;
  setTitle(id: string, title: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<boolean>;
}

const DATA_FILE = path.join(process.cwd(), "data", "conversations.json");

class FileConversationStore implements ConversationStore {
  private normalize(conversation: Conversation): Conversation {
    return {
      ...conversation,
      title: conversation.title ?? "New conversation",
      updatedAt: conversation.updatedAt ?? conversation.createdAt,
      messages: conversation.messages ?? [],
      widgetId: conversation.widgetId ?? null,
    };
  }

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
    return (parsed.conversations ?? []).map((c) => this.normalize(c));
  }

  private async writeAll(conversations: Conversation[]) {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify({ conversations }, null, 2),
      "utf8"
    );
  }

  async createConversation(options?: { widgetId?: string }): Promise<Conversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      title: "New conversation",
      messages: [],
      widgetId: options?.widgetId ?? null,
    };

    const conversations = await this.readAll();
    conversations.push(conversation);
    await this.writeAll(conversations);
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const conversations = await this.readAll();
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run1',hypothesisId:'H5',location:'lib/conversationStore.ts:File:getConversation',message:'file store get',data:{id,total:conversations.length,firstIds:conversations.slice(0,5).map((c)=>c.id)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H5',location:'lib/conversationStore.ts:File:getConversation:resolved',message:'file store resolved conversation',data:{id,found:!!conversations.find((c)=>c.id===id)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return conversations.find((c) => c.id === id) ?? null;
  }

  async getConversationByWidgetId(widgetId: string): Promise<Conversation | null> {
    const conversations = await this.readAll();
    return conversations.find((c) => c.widgetId === widgetId) ?? null;
  }

  async listConversations(): Promise<ConversationListItem[]> {
    const conversations = await this.readAll();
    return conversations
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, createdAt, updatedAt, title }) => ({
        id,
        createdAt,
        updatedAt,
        title,
      }));
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

  async setTitle(id: string, title: string): Promise<Conversation | null> {
    console.log("[FileStore] setTitle called:", { id, title });
    const conversations = await this.readAll();
    const conversation = conversations.find((c) => c.id === id);
    if (!conversation) {
      console.warn("[FileStore] Conversation not found for title update");
      return null;
    }
    conversation.title = title;
    conversation.updatedAt = new Date().toISOString();
    await this.writeAll(conversations);
    console.log("[FileStore] Title updated successfully");
    return conversation;
  }

  async deleteConversation(id: string): Promise<boolean> {
    const conversations = await this.readAll();
    const next = conversations.filter((c) => c.id !== id);
    if (next.length === conversations.length) return false;
    await this.writeAll(next);
    return true;
  }
}

class SupabaseConversationStore implements ConversationStore {
  private client = getSupabaseServerClient();

  private isMissingTitleColumn(error: any) {
    const message = error?.message ?? "";
    return (
      message.includes('column "title" does not exist') ||
      message.includes("column conversations.title does not exist") ||
      message.includes("Could not find the 'title' column")
    );
  }

  private mapConversation(row: any, messages: ChatMessage[]): Conversation {
    return {
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      title: row.title ?? "New conversation",
      messages: messages ?? [],
      widgetId: row.widget_id ?? null,
    };
  }

  private mapMessage(row: any): ChatMessage {
    return {
      role: row.role as ChatRole,
      content: row.content,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async createConversation(options?: { widgetId?: string }): Promise<Conversation> {
    let data, error;
    const insertData: { title: string; widget_id?: string } = { title: "New conversation" };
    if (options?.widgetId) {
      insertData.widget_id = options.widgetId;
    }

    ({ data, error } = await this.client
      .from("conversations")
      .insert(insertData)
      .select()
      .single());

    if (error && this.isMissingTitleColumn(error)) {
      // Fallback without title column (for older schemas)
      const fallbackData: { widget_id?: string } = {};
      if (options?.widgetId) {
        fallbackData.widget_id = options.widgetId;
      }
      ({ data, error } = await this.client
        .from("conversations")
        .insert(fallbackData)
        .select()
        .single());
    }

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create conversation");
    }

    return this.mapConversation(data, []);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const { data: convo, error: convoError } = await this.client
      .from("conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (convoError || !convo) {
      return null;
    }

    const { data: rows, error: msgError } = await this.client
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    if (msgError) {
      throw new Error(msgError.message);
    }

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run1',hypothesisId:'H6',location:'lib/conversationStore.ts:Supabase:getConversation',message:'supabase get result',data:{id,convoFound:!!convo,messageCount:(rows ?? []).length,convoError:!!convoError,msgError:!!msgError},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H6',location:'lib/conversationStore.ts:Supabase:getConversation:result',message:'supabase get result run2',data:{id,convoFound:!!convo,messageCount:(rows ?? []).length,convoError:!!convoError,msgError:!!msgError},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const messages = (rows ?? []).map((row) => this.mapMessage(row));
    return this.mapConversation(convo, messages);
  }

  async getConversationByWidgetId(widgetId: string): Promise<Conversation | null> {
    const { data: convo, error: convoError } = await this.client
      .from("conversations")
      .select("*")
      .eq("widget_id", widgetId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (convoError || !convo) {
      return null;
    }

    const { data: rows, error: msgError } = await this.client
      .from("messages")
      .select("*")
      .eq("conversation_id", convo.id)
      .order("created_at", { ascending: true });

    if (msgError) {
      throw new Error(msgError.message);
    }

    const messages = (rows ?? []).map((row) => this.mapMessage(row));
    return this.mapConversation(convo, messages);
  }

  async listConversations(): Promise<ConversationListItem[]> {
    let data, error;
    ({ data, error } = await this.client
      .from("conversations")
      .select("id, created_at, updated_at, title")
      .order("updated_at", { ascending: false }));

    if (error && this.isMissingTitleColumn(error)) {
      ({ data, error } = await this.client
        .from("conversations")
        .select("id, created_at, updated_at")
        .order("updated_at", { ascending: false }));
    }

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: { id: string; created_at: string; updated_at: string; title?: string }) => ({
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      title: row.title ?? "New conversation",
    }));
  }

  async appendMessage(
    id: string,
    message: ChatMessage
  ): Promise<Conversation | null> {
    const { error: insertError } = await this.client.from("messages").insert({
      conversation_id: id,
      role: message.role,
      content: message.content,
      created_at: message.createdAt,
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    const { error: updateError } = await this.client
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return this.getConversation(id);
  }

  async setTitle(id: string, title: string): Promise<Conversation | null> {
    console.log("[Supabase] setTitle called:", { id, title });
    const { error } = await this.client
      .from("conversations")
      .update({ title })
      .eq("id", id);

    if (error) {
      console.error("[Supabase] setTitle error:", error.message, error);
      if (this.isMissingTitleColumn(error)) {
        console.warn("[Supabase] Title column missing in database, title not saved");
        return this.getConversation(id);
      }
      throw new Error(error.message);
    }

    console.log("[Supabase] Title updated successfully");
    return this.getConversation(id);
  }

  async deleteConversation(id: string): Promise<boolean> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/conversationStore.ts:deleteConversation:start',message:'delete conversation start',data:{id,store:'supabase'},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!id) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/conversationStore.ts:deleteConversation:missingId',message:'missing id',data:{id},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      throw new Error("Missing conversation id for delete");
    }
    const { error: msgError } = await this.client
      .from("messages")
      .delete()
      .eq("conversation_id", id);

    if (msgError) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/conversationStore.ts:deleteConversation:messagesError',message:'delete messages failed',data:{id,error:msgError.message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      throw new Error(msgError.message);
    }

    const { error: convoError } = await this.client
      .from("conversations")
      .delete()
      .eq("id", id);

    if (convoError) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/conversationStore.ts:deleteConversation:convoError',message:'delete convo failed',data:{id,error:convoError.message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      throw new Error(convoError.message);
    }

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/conversationStore.ts:deleteConversation:success',message:'delete conversation success',data:{id},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return true;
  }
}

let store: ConversationStore | null = null;

export function getConversationStore(): ConversationStore {
  if (!store) {
    const canUseSupabase =
      !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    store = canUseSupabase
      ? new SupabaseConversationStore()
      : new FileConversationStore();
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

