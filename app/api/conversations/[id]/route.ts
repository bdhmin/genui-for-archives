import { NextResponse } from "next/server";
import { getConversationStore } from "@/lib/conversationStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: { id: string };
};

export async function GET(req: Request, { params }: Params) {
  try {
    const store = getConversationStore();
    let idFromUrl: string | null = null;
    try {
      const parsed = new URL(req.url ?? "");
      const parts = parsed.pathname.split("/").filter(Boolean);
      idFromUrl = parts[parts.length - 1] ?? null;
    } catch {
      idFromUrl = null;
    }
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H7',location:'app/api/conversations/[id]/route.ts:GET:start',message:'get conversation start',data:{paramsId:params?.id ?? null, idFromUrl, reqUrl:req?.url ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const resolvedId = params?.id ?? idFromUrl ?? undefined;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H7',location:'app/api/conversations/[id]/route.ts:GET:resolvedId',message:'resolved id',data:{paramsId:params?.id ?? null,idFromUrl,resolvedId:resolvedId ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const conversation = resolvedId ? await store.getConversation(resolvedId) : null;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId:'H7',location:'app/api/conversations/[id]/route.ts:GET:result',message:'get conversation result',data:{resolvedId:resolvedId ?? null,found:!!conversation,storeType:store?.constructor?.name ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return NextResponse.json(conversation);
  } catch (error) {
    console.error("Get conversation error", error);
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const store = getConversationStore();
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'fix1',hypothesisId:'H1',location:'app/api/conversations/[id]/route.ts:DELETE:start',message:'delete request',data:{id:params?.id ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'fix1',hypothesisId:'H1',location:'app/api/conversations/[id]/route.ts:DELETE:context',message:'delete context',data:{idParam:params?.id ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'fix1',hypothesisId:'H1',location:'app/api/conversations/[id]/route.ts:DELETE:requrl',message:'delete request url',data:{url:_req.url ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let idFromUrl: string | null = null;
    try {
      const parsed = new URL(_req.url ?? '');
      const parts = parsed.pathname.split('/').filter(Boolean);
      idFromUrl = parts[parts.length - 1] ?? null;
    } catch {
      idFromUrl = null;
    }
    const id = params?.id ?? idFromUrl;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'fix1',hypothesisId:'H1',location:'app/api/conversations/[id]/route.ts:DELETE:resolvedId',message:'resolved id',data:{idParam:params?.id ?? null,idFromUrl},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!id) {
      return NextResponse.json(
        { error: "Conversation id missing" },
        { status: 400 }
      );
    }
    const deleted = await store.deleteConversation(id);
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'fix1',hypothesisId:'H1',location:'app/api/conversations/[id]/route.ts:DELETE:result',message:'delete result',data:{id,deleted},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!deleted) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete conversation error", error);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}

