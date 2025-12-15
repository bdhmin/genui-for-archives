'use client';

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { JSX, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

type ConversationListItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>(
    []
  );
  const [isListLoading, setIsListLoading] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = useCallback(async () => {
    setIsListLoading(true);
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) {
        throw new Error('Failed to load conversations');
      }
      const data = (await res.json()) as {
        conversations?: ConversationListItem[];
      };
      setConversations(data.conversations ?? []);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Unable to load conversations'
      );
    } finally {
      setIsListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  const loadConversation = useCallback(async (id: string) => {
    setIsLoadingConversation(true);
    setError(null);
    try {
      // #region agent log
      fetch(
        'http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'H4',
            location: 'app/page.tsx:loadConversation:start',
            message: 'load conversation click',
            data: {
              id,
              listCount: conversations.length,
              activeId: conversationId,
            },
            timestamp: Date.now(),
          }),
        }
      ).catch(() => {});
      // #endregion
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load conversation');
      }
      const conversation = await res.json();
      // #region agent log
      fetch(
        'http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'run1',
            hypothesisId: 'H4',
            location: 'app/page.tsx:loadConversation:success',
            message: 'load conversation success',
            data: {
              requestedId: id,
              responseId: conversation.id,
              messageCount: conversation.messages?.length ?? 0,
            },
            timestamp: Date.now(),
          }),
        }
      ).catch(() => {});
      // #endregion
      setConversationId(conversation.id);
      setMessages(conversation.messages ?? []);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load conversation';
      setError(message);
    } finally {
      setIsLoadingConversation(false);
    }
  }, []);

  const handleCreateConversation = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/conversations', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create conversation');
      }
      const conversation = await res.json();
      const summary: ConversationListItem = {
        id: conversation.id,
        title: conversation.title ?? 'New conversation',
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      };
      setConversationId(summary.id);
      setMessages([]);
      setInput('');
      setConversations((prev) => [
        summary,
        ...prev.filter((c) => c.id !== summary.id),
      ]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create conversation';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      // #region agent log
      fetch(
        'http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'pre-fix',
            hypothesisId: 'H2',
            location: 'app/page.tsx:handleDeleteConversation:start',
            message: 'delete click',
            data: { id, conversationId },
            timestamp: Date.now(),
          }),
        }
      ).catch(() => {});
      // #endregion
      // #region agent log
      fetch(
        'http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'pre-fix',
            hypothesisId: 'H2',
            location: 'app/page.tsx:handleDeleteConversation:url',
            message: 'delete fetch url',
            data: { url: `/api/conversations/${id}` },
            timestamp: Date.now(),
          }),
        }
      ).catch(() => {});
      // #endregion
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete conversation');
      }
      // #region agent log
      fetch(
        'http://127.0.0.1:7243/ingest/b72aacd3-270e-4da7-85dc-2bd1f75d46d8',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'debug-session',
            runId: 'pre-fix',
            hypothesisId: 'H2',
            location: 'app/page.tsx:handleDeleteConversation:success',
            message: 'delete success',
            data: { id },
            timestamp: Date.now(),
          }),
        }
      ).catch(() => {});
      // #endregion
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete conversation';
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || isLoading) return;

    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: content }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let newConversationId = conversationId;
      let assistantContent = '';

      // Insert placeholder assistant message
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
      const assistantIndex = messages.length + 1; // after user message

      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const lines = part.split('\n');
          let event = '';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event:')) {
              event = line.replace('event:', '').trim();
            } else if (line.startsWith('data:')) {
              data = line.replace('data:', '').trim();
            }
          }

          if (event === 'meta') {
            const meta = JSON.parse(data) as { conversationId: string };
            newConversationId = meta.conversationId;
            setConversationId(meta.conversationId);
          } else if (event === 'token') {
            const token = JSON.parse(data) as string;
            assistantContent += token;
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIndex] = {
                role: 'assistant',
                content: assistantContent,
              };
              return next;
            });
          } else if (event === 'error') {
            const message = JSON.parse(data) as string;
            throw new Error(message);
          }
        }
      }

      // ensure final content set
      if (assistantContent) {
        setMessages((prev) => {
          const next = [...prev];
          next[assistantIndex] = {
            role: 'assistant',
            content: assistantContent,
          };
          return next;
        });
      }

      if (!newConversationId) {
        throw new Error('Missing conversation id in stream');
      }

      void fetchConversations();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="flex min-h-screen w-full flex-col bg-zinc-900 text-zinc-100">
      <main className="flex grow bg-zinc-900">
        <aside className="flex w-80 shrink-0 flex-col gap-4 bg-zinc-950 px-5 py-6 text-zinc-50 lg:w-72">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-50">
                Conversations
              </h2>
              <p className="text-xs text-zinc-400">Sorted by created date</p>
            </div>
            <button
              type="button"
              onClick={handleCreateConversation}
              disabled={isCreating}
              className="flex h-8 items-center gap-1 rounded-md bg-zinc-100 px-3 text-xs font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? '...' : 'Add +'}
            </button>
          </div>
          <div className="flex grow flex-col gap-2 overflow-y-auto">
            {isListLoading ? (
              <div className="py-4 text-center text-xs text-zinc-500">
                Loading conversations...
              </div>
            ) : conversations.length === 0 ? (
              <div className="py-4 text-center text-xs text-zinc-500">
                No conversations yet.
              </div>
            ) : (
              conversations.map((conversation) => {
                const isActive = conversation.id === conversationId;
                return (
                  <div
                    key={conversation.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void loadConversation(conversation.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void loadConversation(conversation.id);
                      }
                    }}
                    className={`group flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition ${
                      isActive ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-50">
                        {conversation.title || 'Untitled'}
                      </p>
                      <p className="truncate text-xs text-zinc-400">
                        {formatDate(conversation.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteConversation(conversation.id);
                      }}
                      disabled={deletingId === conversation.id}
                      className="text-xs text-zinc-500 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Delete conversation ${conversation.title}`}
                    >
                      {deletingId === conversation.id ? '...' : '×'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>
        <div className="flex grow justify-center px-4 sm:px-6">
          <div className="flex w-full max-w-5xl flex-col gap-4 bg-zinc-900 px-6 py-6 text-zinc-100">
            <section className="flex grow flex-col gap-3">
              <div className="flex grow flex-col gap-3 overflow-y-auto rounded-xl bg-zinc-900 p-2">
                {isLoadingConversation ? (
                  <div className="flex grow items-center justify-center text-sm text-zinc-300">
                    Loading conversation...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex grow items-center justify-center text-sm text-zinc-300">
                    Start the conversation with a question.
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <article
                      key={index}
                      className={`flex ${
                        message.role === 'user'
                          ? 'justify-end'
                          : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'bg-zinc-100 text-zinc-900'
                            : 'bg-zinc-800 text-zinc-100'
                        }`}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          className={`prose prose-sm max-w-none break-words prose-pre:whitespace-pre-wrap prose-pre:bg-zinc-800 prose-pre:text-zinc-100 prose-code:text-[0.95em] ${
                            message.role === 'user' ? '' : 'prose-invert'
                          }`}
                          components={{
                            code({
                              inline,
                              className,
                              children,
                              ...props
                            }: {
                              inline?: boolean;
                              className?: string;
                              children?: ReactNode;
                            }) {
                              if (inline) {
                                return (
                                  <code
                                    className={`rounded bg-zinc-800/20 px-1 py-[1px] ${
                                      message.role === 'user'
                                        ? 'text-white'
                                        : 'text-zinc-900'
                                    }`}
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                );
                              }
                              return (
                                <pre className="overflow-auto rounded-lg bg-zinc-900 p-3 text-zinc-100">
                                  <code {...props} className={className}>
                                    {children}
                                  </code>
                                </pre>
                              );
                            },
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    </article>
                  ))
                )}
                <div ref={bottomRef} />
              </div>
              {error ? (
                <div className="px-1 text-sm text-red-200">{error}</div>
              ) : null}
            </section>

            <form onSubmit={handleSubmit} className="flex items-end gap-3 pt-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                placeholder="Send a message..."
                className="min-h-[72px] w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="h-[40px] rounded-lg bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Thinking...' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
