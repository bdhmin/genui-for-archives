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
import { Send, MoreHorizontal, Trash2, Pencil } from 'lucide-react';

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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

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

  const handleRenameConversation = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) {
      setRenamingId(null);
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to rename conversation');
      }
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim() } : c))
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to rename conversation';
      setError(message);
    } finally {
      setRenamingId(null);
      setRenameValue('');
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
            // If this is a new conversation (not in the list), add it to sidebar
            setConversations((prev) => {
              const exists = prev.some((c) => c.id === meta.conversationId);
              if (exists) return prev;
              const now = new Date().toISOString();
              return [
                {
                  id: meta.conversationId,
                  title: 'New conversation',
                  createdAt: now,
                  updatedAt: now,
                },
                ...prev,
              ];
            });
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
          } else if (event === 'title') {
            const title = JSON.parse(data) as string;
            console.log('[Frontend] Received title event:', {
              title,
              newConversationId,
            });
            // Update the conversation title in the sidebar immediately
            setConversations((prev) =>
              prev.map((c) =>
                c.id === newConversationId ? { ...c, title } : c
              )
            );
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

      // Note: We don't call fetchConversations() here anymore because
      // the sidebar is already updated via SSE events (meta for new conversations,
      // title for title updates). This prevents the database from overwriting
      // titles that were just set via SSE but not yet persisted.
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
    <div className="flex h-screen w-full flex-col overflow-hidden bg-zinc-900 text-zinc-100">
      <main className="flex min-h-0 grow bg-zinc-900">
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-hidden bg-zinc-950 px-5 py-6 text-zinc-50 lg:w-72">
          <div className="flex flex-col gap-3">
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
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 text-sm font-semibold text-zinc-100 transition-all hover:bg-zinc-700 active:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
              ) : (
                <>
                  <span>New Conversation</span>
                  <span className="text-lg leading-none">+</span>
                </>
              )}
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
                const isMenuOpen = menuOpenId === conversation.id;
                const isRenaming = renamingId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (!isRenaming) void loadConversation(conversation.id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !isRenaming &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        void loadConversation(conversation.id);
                      }
                    }}
                    className={`group relative flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-all duration-200 ease-out ${
                      isActive
                        ? 'bg-zinc-700/70 shadow-sm shadow-zinc-900/50'
                        : 'hover:bg-zinc-800/50 active:bg-zinc-700/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              void handleRenameConversation(
                                conversation.id,
                                renameValue
                              );
                            } else if (e.key === 'Escape') {
                              setRenamingId(null);
                              setRenameValue('');
                            }
                          }}
                          onBlur={() => {
                            void handleRenameConversation(
                              conversation.id,
                              renameValue
                            );
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                          className="w-full rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-50 outline-none ring-1 ring-zinc-600 focus:ring-zinc-500"
                        />
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium text-zinc-50">
                            {conversation.title || 'Untitled'}
                          </p>
                          <p className="truncate text-xs text-zinc-400">
                            {formatDate(conversation.createdAt)}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="relative" ref={isMenuOpen ? menuRef : null}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuOpenId(isMenuOpen ? null : conversation.id);
                        }}
                        className="rounded p-1 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-300"
                        aria-label="Conversation options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {isMenuOpen && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              setRenamingId(conversation.id);
                              setRenameValue(conversation.title || '');
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              void handleDeleteConversation(conversation.id);
                            }}
                            disabled={deletingId === conversation.id}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingId === conversation.id
                              ? 'Deleting...'
                              : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
        <div className="flex min-h-0 grow justify-center px-4 sm:px-6">
          <div className="flex h-full w-full max-w-3xl flex-col bg-zinc-900 text-zinc-100">
            <section className="flex min-h-0 grow flex-col">
              <div className="flex grow flex-col gap-3 overflow-y-auto p-6">
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
                        className={`text-base leading-7 ${
                          message.role === 'user'
                            ? 'max-w-[80%] rounded-2xl bg-zinc-700 px-4 py-3 text-zinc-100'
                            : 'w-full px-2 py-2 text-zinc-100'
                        }`}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          className="max-w-none break-words"
                          components={{
                            h1: ({ children }: { children?: ReactNode }) => (
                              <h1 className="mt-8 mb-4 text-2xl font-bold first:mt-0">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }: { children?: ReactNode }) => (
                              <h2 className="mt-8 mb-4 text-xl font-bold first:mt-0">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }: { children?: ReactNode }) => (
                              <h3 className="mt-6 mb-3 text-lg font-bold first:mt-0">
                                {children}
                              </h3>
                            ),
                            p: ({ children }: { children?: ReactNode }) => (
                              <p className="my-4 first:mt-0 last:mb-0">
                                {children}
                              </p>
                            ),
                            ul: ({ children }: { children?: ReactNode }) => (
                              <ul className="mt-4 mb-2 list-disc pl-6">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }: { children?: ReactNode }) => (
                              <ol className="mt-4 mb-2 list-decimal pl-6">
                                {children}
                              </ol>
                            ),
                            li: ({ children }: { children?: ReactNode }) => (
                              <li className="my-1">{children}</li>
                            ),
                            blockquote: ({
                              children,
                            }: {
                              children?: ReactNode;
                            }) => (
                              <blockquote className="my-4 border-l-4 border-zinc-600 pl-4 italic">
                                {children}
                              </blockquote>
                            ),
                            hr: () => <hr className="my-6 border-zinc-700" />,
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
                                    className="rounded bg-zinc-600 px-1.5 py-0.5 text-sm"
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                );
                              }
                              return (
                                <pre className="my-4 overflow-auto rounded-lg bg-zinc-800 p-4 text-sm text-zinc-100">
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
            </section>

            <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 px-6 pb-6 pt-4">
              {error ? (
                <div className="mb-3 text-sm text-red-200">{error}</div>
              ) : null}
              <form onSubmit={handleSubmit} className="relative">
                <div className="relative flex items-end rounded-2xl border border-zinc-700 bg-zinc-800/50 transition-colors focus-within:border-zinc-500 focus-within:bg-zinc-800">
                  <textarea
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
                      }
                    }}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      const target = e.target;
                      target.style.height = 'auto';
                      target.style.height = `${Math.min(
                        target.scrollHeight,
                        200
                      )}px`;
                    }}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Send a message..."
                    className="max-h-[200px] min-h-[48px] w-full resize-none bg-transparent py-3 pl-4 pr-14 text-base leading-7 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="absolute bottom-2 right-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-900 transition-all hover:bg-white hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                    aria-label="Send message"
                  >
                    {isLoading ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="mt-2 text-center text-xs text-zinc-500">
                  Press Enter to send, Shift + Enter for new line
                </p>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
