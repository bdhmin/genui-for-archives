'use client';

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      const data = (await response.json()) as {
        conversationId: string;
        message: ChatMessage;
      };

      setConversationId(data.conversationId);
      setMessages((prev) => [...prev, data.message]);
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

  return (
    <div className="flex min-h-screen w-full flex-col bg-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Chat UI</h1>
            <p className="text-sm text-zinc-500">
              File-backed history, ready to swap to Supabase later.
            </p>
          </div>
          {conversationId ? (
            <span className="text-xs font-mono text-zinc-500">
              Conversation: {conversationId.slice(0, 8)}
            </span>
          ) : null}
        </div>
      </header>

      <main className="flex grow justify-center px-4 py-6">
        <div className="flex w-full max-w-5xl flex-col gap-4">
          <section className="flex grow flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex grow flex-col gap-3 overflow-y-auto rounded-xl bg-zinc-50 p-4">
              {messages.length === 0 ? (
                <div className="flex grow items-center justify-center text-sm text-zinc-500">
                  Start the conversation with a question.
                </div>
              ) : (
                messages.map((message, index) => (
                  <article
                    key={index}
                    className={`flex ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                        message.role === 'user'
                          ? 'bg-zinc-900 text-white'
                          : 'bg-white text-zinc-900 border border-zinc-200'
                      }`}
                    >
                      {message.content}
                    </div>
                  </article>
                ))
              )}
              <div ref={bottomRef} />
            </div>
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </section>

          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="Send a message..."
              className="min-h-[72px] w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 shadow-inner focus:border-zinc-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="h-[42px] rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {isLoading ? 'Thinking...' : 'Send'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
