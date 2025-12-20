'use client';

import React, {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send,
  ArrowDown,
  ArrowLeft,
  MoreHorizontal,
  Trash2,
  Pencil,
  LayoutDashboard,
  X,
  ChevronRight,
  Loader2,
  AlertCircle,
  Square,
  Plus,
  GripVertical,
  Maximize2,
  LogOut,
  CheckSquare,
  SquareDashed,
  Merge,
  Check,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import WidgetRenderer to avoid SSR issues with Sandpack
const WidgetRenderer = dynamic(() => import('./components/WidgetRenderer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
    </div>
  ),
});

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

type GlobalTag = {
  id: string;
  tag: string;
  created_at: string;
  conversation_global_tags?: { conversation_id: string }[];
};

type Widget = {
  id: string;
  globalTagId: string;
  globalTag: string;
  name: string;
  description: string | null;
  status: 'generating' | 'active' | 'error';
  conversationIds: string[];
  lastOpenedAt: string | null;
  thumbnailUrl: string | null;
  codeHash: string | null;
};

type WidgetDetail = {
  id: string;
  globalTagId: string;
  name: string;
  description: string | null;
  componentCode: string;
  dataSchema: Record<string, unknown>;
  status: string;
  errorMessage: string | null;
  globalTag: string;
  conversationIds: string[];
  codeHash: string | null;
};

type WidgetDataItem = {
  id: string;
  data: Record<string, unknown>;
};

type ConversationTagGroup = {
  conversationId: string;
  conversationTitle: string;
  tags: { id: string; tag: string; createdAt: string }[];
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
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [highlightedConversationIds, setHighlightedConversationIds] = useState<
    string[]
  >([]);
  const [highlightedWidgetIds, setHighlightedWidgetIds] = useState<Set<string>>(
    new Set()
  );
  const [globalTags, setGlobalTags] = useState<GlobalTag[]>([]);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [taggingConversationIds, setTaggingConversationIds] = useState<
    Set<string>
  >(new Set());
  // Pipeline stage indicators
  const [pipelineStage, setPipelineStage] = useState<
    'idle' | 'tagging' | 'synthesizing' | 'updating' | 'generating'
  >('idle');
  const [showConversationTags, setShowConversationTags] = useState(false);
  const [conversationTagGroups, setConversationTagGroups] = useState<
    ConversationTagGroup[]
  >([]);
  const [isLoadingConversationTags, setIsLoadingConversationTags] =
    useState(false);
  const [selectedWidgetDetail, setSelectedWidgetDetail] =
    useState<WidgetDetail | null>(null);
  const [selectedWidgetData, setSelectedWidgetData] = useState<
    WidgetDataItem[]
  >([]);
  const [isLoadingWidgetDetail, setIsLoadingWidgetDetail] = useState(false);
  // Drag-and-drop state
  const [draggingConversationId, setDraggingConversationId] = useState<
    string | null
  >(null);
  const [dropTargetWidgetId, setDropTargetWidgetId] = useState<string | null>(
    null
  );
  const [isDropTargetNewWidget, setIsDropTargetNewWidget] = useState(false);
  const [processingDropConversationId, setProcessingDropConversationId] =
    useState<string | null>(null);
  const [processingDropWidgetId, setProcessingDropWidgetId] = useState<
    string | null
  >(null);
  // Widget edit mode state
  const [widgetEditMode, setWidgetEditMode] = useState(false);
  const [widgetEditMessages, setWidgetEditMessages] = useState<ChatMessage[]>(
    []
  );
  const [widgetConversationId, setWidgetConversationId] = useState<
    string | null
  >(null);
  const [widgetEditInput, setWidgetEditInput] = useState('');
  const [isWidgetEditLoading, setIsWidgetEditLoading] = useState(false);
  const widgetEditAbortRef = useRef<AbortController | null>(null);
  const widgetEditBottomRef = useRef<HTMLDivElement | null>(null);
  // Dashboard multi-select edit mode
  const [dashboardEditMode, setDashboardEditMode] = useState(false);
  const [selectedWidgetIds, setSelectedWidgetIds] = useState<Set<string>>(
    new Set()
  );
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const router = useRouter();

  // Logout handler
  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      router.push('/login');
      router.refresh();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, [router]);

  // Check if scrolled to bottom (with small threshold)
  const isAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 50;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold
    );
  }, []);

  // Handle user scroll - ignore programmatic scrolls
  const handleScroll = useCallback(() => {
    // Ignore scroll events triggered by programmatic scrolling
    if (isProgrammaticScrollRef.current) {
      return;
    }
    if (isAtBottom()) {
      setUserHasScrolledUp(false);
    } else {
      setUserHasScrolledUp(true);
    }
  }, [isAtBottom]);

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    isProgrammaticScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUserHasScrolledUp(false);
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 100);
  }, []);

  // Stop generation function
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  // Auto-scroll only when AI is generating and user hasn't scrolled up
  useEffect(() => {
    if (isLoading && !userHasScrolledUp) {
      isProgrammaticScrollRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      // Reset flag after scroll animation completes
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
    }
  }, [messages, isLoading, userHasScrolledUp]);

  // Scroll to bottom when conversation loads
  useEffect(() => {
    if (!isLoadingConversation && messages.length > 0) {
      isProgrammaticScrollRef.current = true;
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
    }
  }, [isLoadingConversation, messages.length]);

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

  // Keyboard shortcuts: Cmd+Shift+O to create new conversation, Escape to stop generation
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleCreateConversation();
      }
      // Escape key to stop generation
      if (e.key === 'Escape' && isLoading) {
        e.preventDefault();
        stopGeneration();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, stopGeneration]);

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

  // Fetch widget detail when a widget is selected
  const fetchWidgetDetail = useCallback(async (widgetId: string) => {
    setIsLoadingWidgetDetail(true);
    try {
      const res = await fetch(`/api/widgets/${widgetId}`);
      if (!res.ok) {
        throw new Error('Failed to load widget details');
      }
      const data = await res.json();
      setSelectedWidgetDetail(data.widget);
      setSelectedWidgetData(data.dataItems ?? []);
    } catch (err) {
      console.error('Failed to fetch widget detail:', err);
      setSelectedWidgetDetail(null);
      setSelectedWidgetData([]);
    } finally {
      setIsLoadingWidgetDetail(false);
    }
  }, []);

  const loadConversation = useCallback(
    async (id: string) => {
      setIsLoadingConversation(true);
      setError(null);
      setUserHasScrolledUp(false);
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load conversation');
        }
        const conversation = await res.json();

        // Check if this is a widget-editing conversation
        if (conversation.widgetId) {
          // Open widget edit view
          setIsDashboardOpen(true);
          setSelectedWidgetId(conversation.widgetId);
          setWidgetEditMode(true);
          setWidgetConversationId(conversation.id);
          setWidgetEditMessages(conversation.messages ?? []);
          // Load widget details
          void fetchWidgetDetail(conversation.widgetId);
        } else {
          // Regular conversation
          setConversationId(conversation.id);
          setMessages(conversation.messages ?? []);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load conversation';
        setError(message);
      } finally {
        setIsLoadingConversation(false);
      }
    },
    [fetchWidgetDetail]
  );

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
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete conversation');
      }
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

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setIsLoading(true);
    setError(null);
    setUserHasScrolledUp(false);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: content }),
        signal: abortControllerRef.current.signal,
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

      // Mark conversation as being tagged and track pipeline stages
      setTaggingConversationIds((prev) => new Set(prev).add(newConversationId));
      setPipelineStage('tagging');

      // Pipeline stage progression (approximate timings)
      // Stage 1: Tagging (Round 1) - ~3 seconds
      setTimeout(() => {
        setPipelineStage('synthesizing');
      }, 3000);

      // Stage 2: Synthesizing (Round 2) - ~5 seconds after tagging
      setTimeout(() => {
        setPipelineStage('updating');
      }, 8000);

      // Stage 3: Updating data - ~3 seconds
      setTimeout(() => {
        setPipelineStage('generating');
      }, 11000);

      // Stage 4: Generating UIs - ~5 seconds, then idle
      setTimeout(() => {
        setPipelineStage('idle');
        setTaggingConversationIds((prev) => {
          const next = new Set(prev);
          next.delete(newConversationId!);
          return next;
        });
        // Refresh widgets after pipeline completes
        if (isDashboardOpen) {
          void fetchWidgets();
        }
      }, 16000);

      void fetchConversations();
    } catch (err) {
      // Don't show error if request was aborted (user stopped generation)
      if (err instanceof Error && err.name === 'AbortError') {
        // Generation was stopped by user - no error to show
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
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

  // Widget edit mode handlers
  const sendWidgetEditMessage = async () => {
    const content = widgetEditInput.trim();
    if (!content || isWidgetEditLoading || !selectedWidgetId) return;

    // Create new abort controller for this request
    widgetEditAbortRef.current = new AbortController();

    // Add user message
    setWidgetEditMessages((prev) => [
      ...prev,
      { role: 'user', content, createdAt: new Date().toISOString() },
    ]);
    setWidgetEditInput('');
    setIsWidgetEditLoading(true);
    setWidgetEditMode(true);

    try {
      const response = await fetch(`/api/widgets/${selectedWidgetId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: widgetConversationId,
          message: content,
        }),
        signal: widgetEditAbortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send message');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let assistantContent = '';
      let currentConversationId = widgetConversationId;

      // Insert placeholder assistant message
      setWidgetEditMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', createdAt: new Date().toISOString() },
      ]);

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
            const meta = JSON.parse(data) as {
              conversationId: string;
              widgetId: string;
            };
            currentConversationId = meta.conversationId;
            setWidgetConversationId(meta.conversationId);
            // Add conversation to sidebar if it's new
            setConversations((prev) => {
              const exists = prev.some((c) => c.id === meta.conversationId);
              if (exists) return prev;
              const now = new Date().toISOString();
              const widgetName =
                selectedWidgetDetail?.name ||
                widgets.find((w) => w.id === selectedWidgetId)?.name ||
                'Widget';
              return [
                {
                  id: meta.conversationId,
                  title: `Editing: ${widgetName}`,
                  createdAt: now,
                  updatedAt: now,
                },
                ...prev,
              ];
            });
          } else if (event === 'token') {
            const token = JSON.parse(data) as string;
            assistantContent += token;
            setWidgetEditMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: 'assistant',
                content: assistantContent,
                createdAt: new Date().toISOString(),
              };
              return next;
            });
          } else if (event === 'code_updated') {
            // Refresh widget detail to get new code
            await fetchWidgetDetail(selectedWidgetId);
          } else if (event === 'title') {
            // Update conversation title in sidebar
            const title = JSON.parse(data) as string;
            setConversations((prev) =>
              prev.map((c) =>
                c.id === currentConversationId ? { ...c, title } : c
              )
            );
          } else if (event === 'error') {
            const message = JSON.parse(data) as string;
            throw new Error(message);
          }
        }
      }

      // Ensure final content is set
      if (assistantContent) {
        setWidgetEditMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            content: assistantContent,
            createdAt: new Date().toISOString(),
          };
          return next;
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setIsWidgetEditLoading(false);
      widgetEditAbortRef.current = null;
    }
  };

  const handleWidgetEditSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendWidgetEditMessage();
  };

  const handleWidgetEditKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendWidgetEditMessage();
    }
  };

  const stopWidgetEditGeneration = useCallback(() => {
    if (widgetEditAbortRef.current) {
      widgetEditAbortRef.current.abort();
      widgetEditAbortRef.current = null;
    }
    setIsWidgetEditLoading(false);
  }, []);

  const closeWidgetEditMode = useCallback(() => {
    setWidgetEditMode(false);
    // Keep messages so user can continue editing later
  }, []);

  // Handle "Ask to Fix" from widget error - opens edit mode with error context
  const handleAskToFix = useCallback((errorMessage: string) => {
    setWidgetEditMode(true);
    setWidgetEditInput(errorMessage);
  }, []);

  // Reset widget edit state when widget selection changes
  useEffect(() => {
    if (!selectedWidgetId) {
      setWidgetEditMode(false);
      setWidgetEditMessages([]);
      setWidgetConversationId(null);
      setWidgetEditInput('');
    }
  }, [selectedWidgetId]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Fetch widgets from the new API
  const fetchWidgets = useCallback(async () => {
    setIsLoadingTags(true);
    try {
      const res = await fetch('/api/widgets');
      if (!res.ok) {
        throw new Error('Failed to load widgets');
      }
      const data = await res.json();
      setWidgets(data.widgets ?? []);
    } catch (err) {
      console.error('Failed to fetch widgets:', err);
      // Fallback to tags API if widgets API fails
      try {
        const res = await fetch('/api/tags');
        if (res.ok) {
          const data = await res.json();
          const tags: GlobalTag[] = data.globalTags ?? [];
          setGlobalTags(tags);
          // Create widgets from global tags as fallback
          const fallbackWidgets: Widget[] = tags.map((tag) => ({
            id: tag.id,
            globalTagId: tag.id,
            globalTag: tag.tag,
            name: tag.tag,
            description: null,
            status: 'generating' as const,
            conversationIds:
              tag.conversation_global_tags?.map((m) => m.conversation_id) ?? [],
            lastOpenedAt: null,
            thumbnailUrl: null,
            codeHash: null,
          }));
          setWidgets(fallbackWidgets);
        }
      } catch {
        console.error('Failed to fetch tags fallback');
      }
    } finally {
      setIsLoadingTags(false);
    }
  }, []);

  // Handle widget data changes from the rendered widget
  const handleWidgetDataChange = useCallback(
    async (dataItems: WidgetDataItem[]) => {
      if (!selectedWidgetId) return;

      setSelectedWidgetData(dataItems);

      // Persist to backend
      try {
        await fetch(`/api/widgets/${selectedWidgetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataItems }),
        });
      } catch (err) {
        console.error('Failed to save widget data:', err);
      }
    },
    [selectedWidgetId]
  );

  // Fetch widgets when dashboard opens
  useEffect(() => {
    if (isDashboardOpen) {
      void fetchWidgets();
    }
  }, [isDashboardOpen, fetchWidgets]);

  // Fetch widget detail when a widget is selected
  useEffect(() => {
    if (selectedWidgetId) {
      void fetchWidgetDetail(selectedWidgetId);
    } else {
      setSelectedWidgetDetail(null);
      setSelectedWidgetData([]);
    }
  }, [selectedWidgetId, fetchWidgetDetail]);

  // Handle widget selection
  const handleWidgetSelect = async (widgetId: string) => {
    if (selectedWidgetId === widgetId) {
      // Deselect
      setSelectedWidgetId(null);
      setHighlightedConversationIds([]);
    } else {
      // Select and highlight conversations
      setSelectedWidgetId(widgetId);
      const widget = widgets.find((w) => w.id === widgetId);
      setHighlightedConversationIds(widget?.conversationIds ?? []);

      // Update last_opened_at in the background
      try {
        await fetch(`/api/widgets/${widgetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updateLastOpened: true }),
        });
        // Update local state to reflect the change
        setWidgets((prev) =>
          prev.map((w) =>
            w.id === widgetId
              ? { ...w, lastOpenedAt: new Date().toISOString() }
              : w
          )
        );
      } catch (err) {
        console.error('Failed to update last opened:', err);
      }
    }
  };

  // Handle widget deletion
  const [deletingWidgetId, setDeletingWidgetId] = useState<string | null>(null);

  const handleDeleteWidget = async (e: React.MouseEvent, widgetId: string) => {
    e.stopPropagation(); // Prevent triggering widget selection

    if (
      !confirm(
        'Are you sure you want to delete this widget? This action cannot be undone.'
      )
    ) {
      return;
    }

    setDeletingWidgetId(widgetId);

    try {
      const res = await fetch(`/api/widgets/${widgetId}?deleteWidget=true`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete widget');
      }

      // Remove widget from local state
      setWidgets((prev) => prev.filter((w) => w.id !== widgetId));

      // If this widget was selected, deselect it
      if (selectedWidgetId === widgetId) {
        setSelectedWidgetId(null);
        setSelectedWidgetDetail(null);
        setSelectedWidgetData([]);
        setHighlightedConversationIds([]);
      }
    } catch (err) {
      console.error('Failed to delete widget:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete widget');
    } finally {
      setDeletingWidgetId(null);
    }
  };

  // Dashboard edit mode handlers
  const toggleDashboardEditMode = useCallback(() => {
    setDashboardEditMode((prev) => {
      if (prev) {
        // Exiting edit mode - clear selections
        setSelectedWidgetIds(new Set());
      }
      return !prev;
    });
  }, []);

  const toggleWidgetSelection = useCallback((widgetId: string) => {
    setSelectedWidgetIds((prev) => {
      const next = new Set(prev);
      if (next.has(widgetId)) {
        next.delete(widgetId);
      } else {
        next.add(widgetId);
      }
      return next;
    });
  }, []);

  const selectAllWidgets = useCallback(() => {
    setSelectedWidgetIds(
      new Set(widgets.filter((w) => w.status !== 'generating').map((w) => w.id))
    );
  }, [widgets]);

  const deselectAllWidgets = useCallback(() => {
    setSelectedWidgetIds(new Set());
  }, []);

  // Bulk delete selected widgets
  const handleBulkDelete = async () => {
    if (selectedWidgetIds.size === 0) return;

    const count = selectedWidgetIds.size;
    if (
      !confirm(
        `Are you sure you want to delete ${count} widget${
          count > 1 ? 's' : ''
        }? This action cannot be undone.`
      )
    ) {
      return;
    }

    setIsBulkDeleting(true);

    try {
      const deletePromises = Array.from(selectedWidgetIds).map((widgetId) =>
        fetch(`/api/widgets/${widgetId}?deleteWidget=true`, {
          method: 'DELETE',
        })
      );

      await Promise.all(deletePromises);

      // Remove deleted widgets from local state
      setWidgets((prev) => prev.filter((w) => !selectedWidgetIds.has(w.id)));

      // Clear selection and exit edit mode
      setSelectedWidgetIds(new Set());
      setDashboardEditMode(false);
    } catch (err) {
      console.error('Failed to delete widgets:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to delete some widgets'
      );
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Merge selected widgets
  const handleMergeWidgets = async () => {
    if (selectedWidgetIds.size < 2) {
      setError('Select at least 2 widgets to merge');
      return;
    }

    const count = selectedWidgetIds.size;
    if (
      !confirm(
        `Merge ${count} widgets into one? This will combine all data and regenerate a unified UI. The original widgets will be removed.`
      )
    ) {
      return;
    }

    setIsMerging(true);

    try {
      const res = await fetch('/api/widgets/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          widgetIds: Array.from(selectedWidgetIds),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to merge widgets');
      }

      // Refresh widgets list
      await fetchWidgets();

      // Clear selection and exit edit mode
      setSelectedWidgetIds(new Set());
      setDashboardEditMode(false);
    } catch (err) {
      console.error('Failed to merge widgets:', err);
      setError(err instanceof Error ? err.message : 'Failed to merge widgets');
    } finally {
      setIsMerging(false);
    }
  };

  // Fetch conversation tags (Round 1 tags)
  const fetchConversationTags = useCallback(async () => {
    setIsLoadingConversationTags(true);
    try {
      const res = await fetch('/api/tags/conversation-tags');
      if (!res.ok) {
        throw new Error('Failed to load conversation tags');
      }
      const data = await res.json();
      setConversationTagGroups(data.conversationTags ?? []);
    } catch (err) {
      console.error('Failed to fetch conversation tags:', err);
    } finally {
      setIsLoadingConversationTags(false);
    }
  }, []);

  // Fetch conversation tags when toggled
  useEffect(() => {
    if (showConversationTags) {
      void fetchConversationTags();
    }
  }, [showConversationTags, fetchConversationTags]);

  // Close dashboard
  const closeDashboard = () => {
    setIsDashboardOpen(false);
    setSelectedWidgetId(null);
    setSelectedWidgetDetail(null);
    setSelectedWidgetData([]);
    setHighlightedConversationIds([]);
    setShowConversationTags(false);
    // Exit edit mode and clear selections
    setDashboardEditMode(false);
    setSelectedWidgetIds(new Set());
  };

  // Drag-and-drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, conversationId: string) => {
      e.dataTransfer.setData('text/plain', conversationId);
      e.dataTransfer.effectAllowed = 'copy';
      setDraggingConversationId(conversationId);
      // Open dashboard if not already open
      if (!isDashboardOpen) {
        setIsDashboardOpen(true);
      }
    },
    [isDashboardOpen]
  );

  const handleDragEnd = useCallback(() => {
    setDraggingConversationId(null);
    setDropTargetWidgetId(null);
    setIsDropTargetNewWidget(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleWidgetDragEnter = useCallback(
    (e: React.DragEvent, widgetId: string) => {
      e.preventDefault();
      setDropTargetWidgetId(widgetId);
      setIsDropTargetNewWidget(false);
    },
    []
  );

  const handleWidgetDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only clear if leaving the widget entirely (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDropTargetWidgetId(null);
    }
  }, []);

  const handleNewWidgetDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDropTargetNewWidget(true);
    setDropTargetWidgetId(null);
  }, []);

  const handleNewWidgetDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setIsDropTargetNewWidget(false);
    }
  }, []);

  const handleDropOnWidget = useCallback(
    async (e: React.DragEvent, widgetId: string) => {
      e.preventDefault();
      const conversationId = e.dataTransfer.getData('text/plain');
      if (!conversationId) return;

      setDraggingConversationId(null);
      setDropTargetWidgetId(null);
      setProcessingDropConversationId(conversationId);
      setProcessingDropWidgetId(widgetId);

      try {
        const res = await fetch('/api/widgets/add-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgetId, conversationId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to add conversation to widget');
        }

        // Wait for edge function to process (schema evolution + data extraction)
        // Then poll for updates
        const pollForUpdates = async (attempts = 0): Promise<void> => {
          if (attempts >= 10) {
            console.log('[DropOnWidget] Max polling attempts reached');
            return;
          }

          // Wait progressively longer between attempts
          await new Promise((resolve) =>
            setTimeout(resolve, 1500 + attempts * 500)
          );

          // Refresh widget detail
          if (selectedWidgetId === widgetId) {
            await fetchWidgetDetail(widgetId);
          }

          // Check if data was added by fetching widget
          const checkRes = await fetch(`/api/widgets/${widgetId}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            const dataItems = checkData.dataItems || [];
            const hasConversationData = dataItems.some(
              (item: { sourceConversationId?: string }) =>
                item.sourceConversationId === conversationId
            );

            if (!hasConversationData && attempts < 9) {
              // Keep polling if data not yet available
              console.log(
                `[DropOnWidget] Data not ready, polling attempt ${attempts + 1}`
              );
              return pollForUpdates(attempts + 1);
            }
          }
        };

        // Start polling
        await pollForUpdates();

        // Final refresh of widgets list
        await fetchWidgets();

        // Final refresh of widget detail if selected
        if (selectedWidgetId === widgetId) {
          await fetchWidgetDetail(widgetId);
        }
      } catch (err) {
        console.error('Failed to add conversation to widget:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to add conversation'
        );
      } finally {
        setProcessingDropConversationId(null);
        setProcessingDropWidgetId(null);
      }
    },
    [fetchWidgets, fetchWidgetDetail, selectedWidgetId]
  );

  const handleDropOnNewWidget = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const conversationId = e.dataTransfer.getData('text/plain');
      if (!conversationId) return;

      setDraggingConversationId(null);
      setIsDropTargetNewWidget(false);
      setProcessingDropConversationId(conversationId);

      try {
        const res = await fetch('/api/widgets/add-conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId }), // No widgetId = create new widget
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error || 'Failed to create widget from conversation'
          );
        }

        const result = await res.json();

        // Poll for widget creation to complete
        const pollForWidget = async (attempts = 0): Promise<void> => {
          if (attempts >= 15) {
            console.log('[DropOnNewWidget] Max polling attempts reached');
            return;
          }

          await new Promise((resolve) =>
            setTimeout(resolve, 2000 + attempts * 500)
          );

          // Refresh widgets list
          await fetchWidgets();

          // If we got a widgetId from the response, check if it's ready
          if (result.widgetId) {
            const checkRes = await fetch(`/api/widgets/${result.widgetId}`);
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              if (checkData.widget?.status === 'active') {
                console.log('[DropOnNewWidget] Widget is ready');
                return;
              }
            }
          }

          // Keep polling
          console.log(
            `[DropOnNewWidget] Widget not ready, polling attempt ${
              attempts + 1
            }`
          );
          return pollForWidget(attempts + 1);
        };

        // Start polling
        await pollForWidget();

        // Final refresh
        await fetchWidgets();
      } catch (err) {
        console.error('Failed to create widget from conversation:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to create widget'
        );
      } finally {
        setProcessingDropConversationId(null);
      }
    },
    [fetchWidgets]
  );

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-zinc-900 text-zinc-100">
      <main className="flex min-h-0 grow bg-zinc-900">
        <aside
          className={`flex shrink-0 flex-col gap-4 overflow-hidden bg-zinc-950 px-5 py-6 text-zinc-50 transition-all duration-300 ease-out ${
            isDashboardOpen ? 'w-72' : 'w-80 lg:w-72'
          }`}
        >
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-50">
                GenUI from Conversations
              </h2>
              <p className="text-xs text-zinc-400">
                Automatically Generates UIs from Past Conversations
              </p>
            </div>
            {/* Dashboard Button */}
            <button
              type="button"
              onClick={() => setIsDashboardOpen(true)}
              className={`relative flex h-auto min-h-[40px] w-full flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-sm font-semibold transition-all ${
                isDashboardOpen
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 active:bg-zinc-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span>Generated UIs</span>
              </div>
              {/* Pipeline stage indicator */}
              {pipelineStage !== 'idle' && (
                <div className="flex items-center gap-1.5 text-[10px] font-normal opacity-80">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
                  <span>
                    {pipelineStage === 'tagging' && 'Tagging...'}
                    {pipelineStage === 'synthesizing' && 'Synthesizing...'}
                    {pipelineStage === 'updating' && 'Updating Data...'}
                    {pipelineStage === 'generating' && 'Generating UIs...'}
                  </span>
                </div>
              )}
            </button>
            {/* New Conversation Button */}
            <button
              type="button"
              onClick={() => {
                if (isDashboardOpen) {
                  closeDashboard();
                }
                void handleCreateConversation();
              }}
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
                const isHighlighted = highlightedConversationIds.includes(
                  conversation.id
                );
                const isTagging = taggingConversationIds.has(conversation.id);
                const isDragging = draggingConversationId === conversation.id;
                const isProcessingDrop =
                  processingDropConversationId === conversation.id;
                return (
                  <div
                    key={conversation.id}
                    role="button"
                    tabIndex={0}
                    draggable={!isRenaming}
                    onDragStart={(e) => handleDragStart(e, conversation.id)}
                    onDragEnd={handleDragEnd}
                    onMouseEnter={() => {
                      // Find widgets that contain this conversation and highlight them
                      const widgetIdsWithConversation = widgets
                        .filter((w) =>
                          w.conversationIds.includes(conversation.id)
                        )
                        .map((w) => w.id);
                      if (widgetIdsWithConversation.length > 0) {
                        setHighlightedWidgetIds(
                          new Set(widgetIdsWithConversation)
                        );
                      }
                    }}
                    onMouseLeave={() => {
                      setHighlightedWidgetIds(new Set());
                    }}
                    onClick={() => {
                      if (!isRenaming) {
                        if (isDashboardOpen) {
                          closeDashboard();
                        }
                        void loadConversation(conversation.id);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        !isRenaming &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault();
                        if (isDashboardOpen) {
                          closeDashboard();
                        }
                        void loadConversation(conversation.id);
                      }
                    }}
                    className={`group relative flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-all duration-200 ease-out ${
                      isDragging
                        ? 'opacity-50 ring-2 ring-amber-500 bg-amber-900/20'
                        : isProcessingDrop
                        ? 'opacity-70 ring-2 ring-amber-500/50 bg-amber-900/10'
                        : isHighlighted
                        ? 'bg-amber-600/30 ring-1 ring-amber-500/50 shadow-sm shadow-amber-900/30'
                        : isActive
                        ? 'bg-zinc-700/70 shadow-sm shadow-zinc-900/50'
                        : 'hover:bg-zinc-800/50 active:bg-zinc-700/40'
                    }`}
                  >
                    {/* Tagging/Processing indicator */}
                    {(isTagging || isProcessingDrop) && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-amber-500 animate-pulse" />
                    )}
                    {/* Drag handle */}
                    <div className="mr-1 flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="h-4 w-4 text-zinc-500" />
                    </div>
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
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs text-zinc-400">
                              {formatDate(conversation.createdAt)}
                            </p>
                            {isTagging && (
                              <span className="flex items-center gap-1 text-xs text-amber-500">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Tagging
                              </span>
                            )}
                            {isProcessingDrop && (
                              <span className="flex items-center gap-1 text-xs text-amber-500">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Adding to widget...
                              </span>
                            )}
                          </div>
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
          {/* Logout Button */}
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-auto flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 text-sm text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-200"
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        </aside>
        {/* Main Content Area - Chat or Dashboard */}
        <div className="flex min-h-0 grow">
          {isDashboardOpen ? (
            /* Dashboard View */
            <div className="flex h-full w-full flex-col bg-zinc-900 text-zinc-100 animate-in fade-in slide-in-from-left-4 duration-300">
              {/* Drag instruction banner */}
              {draggingConversationId &&
                !selectedWidgetId &&
                !showConversationTags && (
                  <div className="shrink-0 flex items-center justify-center gap-3 bg-amber-900/30 border-b border-amber-500/30 px-4 py-3 text-amber-300">
                    <GripVertical className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      Drop on a widget to add data, or drop on &quot;Create New
                      Widget&quot; to generate a new UI
                    </span>
                  </div>
                )}

              {/* Dashboard Header - Only show when not in detail view */}
              {!selectedWidgetId && (
                <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-8 py-5">
                  <div>
                    <h1 className="text-2xl font-bold text-zinc-50">
                      {showConversationTags
                        ? 'Conversation Tags'
                        : 'Generated UIs'}
                    </h1>
                    <p className="text-sm text-zinc-400">
                      {showConversationTags
                        ? 'Tags generated from each conversation (Round 1)'
                        : 'Auto-generated UIs from your conversations'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Edit mode toggle - only show when viewing widgets (not conversation tags) */}
                    {!showConversationTags && (
                      <button
                        type="button"
                        onClick={toggleDashboardEditMode}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                          dashboardEditMode
                            ? 'bg-amber-600 text-white hover:bg-amber-500'
                            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                        }`}
                      >
                        {dashboardEditMode ? (
                          <>
                            <Check className="h-4 w-4" />
                            Done
                          </>
                        ) : (
                          <>
                            <Pencil className="h-4 w-4" />
                            Edit
                          </>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowConversationTags(!showConversationTags);
                        // Exit edit mode when switching views
                        if (!showConversationTags) {
                          setDashboardEditMode(false);
                          setSelectedWidgetIds(new Set());
                        }
                      }}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                        showConversationTags
                          ? 'bg-amber-600 text-white hover:bg-amber-500'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
                      }`}
                    >
                      {showConversationTags
                        ? 'Show Generated UIs'
                        : 'See Conversation Tags'}
                    </button>
                    <button
                      type="button"
                      onClick={closeDashboard}
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100"
                      aria-label="Close dashboard"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Dashboard Content */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {showConversationTags ? (
                  /* Conversation Tags View */
                  <div className="flex-1 overflow-y-auto p-8">
                    {isLoadingConversationTags ? (
                      <div className="flex h-64 items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-amber-500" />
                          <p className="text-sm text-zinc-400">
                            Loading conversation tags...
                          </p>
                        </div>
                      </div>
                    ) : conversationTagGroups.length === 0 ? (
                      <div className="flex h-64 flex-col items-center justify-center gap-4">
                        <LayoutDashboard className="h-16 w-16 text-zinc-700" />
                        <div className="text-center">
                          <p className="text-lg font-medium text-zinc-300">
                            No tags yet
                          </p>
                          <p className="text-sm text-zinc-500">
                            Send messages in conversations to generate tags
                            automatically
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-6">
                        <p className="text-sm text-zinc-400">
                          {conversationTagGroups.reduce(
                            (acc, g) => acc + g.tags.length,
                            0
                          )}{' '}
                          tags across {conversationTagGroups.length}{' '}
                          conversations
                        </p>
                        {conversationTagGroups.map((group) => (
                          <div
                            key={group.conversationId}
                            className="rounded-xl border border-zinc-700/50 bg-zinc-800/30 p-5"
                          >
                            <h3 className="mb-3 font-medium text-zinc-200">
                              {group.conversationTitle}
                            </h3>
                            <div className="flex flex-col gap-2">
                              {group.tags.map((tag) => (
                                <div
                                  key={tag.id}
                                  className="flex items-start gap-2 rounded-lg bg-zinc-900/50 p-3 text-sm"
                                >
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                                  <span className="text-zinc-300">
                                    {tag.tag}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : selectedWidgetId ? (
                  /* Detail View - Full screen widget */
                  <div className="flex flex-1 flex-col overflow-hidden bg-zinc-900 animate-in fade-in duration-200">
                    {/* Header bar with back button and title */}
                    <div
                      className={`flex shrink-0 items-center gap-4 border-b px-4 py-3 transition-colors ${
                        dropTargetWidgetId === selectedWidgetId
                          ? 'border-amber-500 bg-amber-900/20'
                          : 'border-zinc-800 bg-zinc-950'
                      }`}
                      onDragEnter={(e) =>
                        selectedWidgetId &&
                        handleWidgetDragEnter(e, selectedWidgetId)
                      }
                      onDragLeave={handleWidgetDragLeave}
                      onDragOver={handleDragOver}
                      onDrop={(e) =>
                        selectedWidgetId &&
                        handleDropOnWidget(e, selectedWidgetId)
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedWidgetId(null);
                          setHighlightedConversationIds([]);
                        }}
                        className="group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                        <span>Back</span>
                      </button>
                      <div className="h-5 w-px bg-zinc-700" />
                      <h2 className="flex-1 text-sm font-medium text-zinc-100">
                        {selectedWidgetDetail?.name ||
                          widgets.find((w) => w.id === selectedWidgetId)
                            ?.globalTag}
                      </h2>
                      {dropTargetWidgetId === selectedWidgetId && (
                        <span className="flex items-center gap-2 text-sm text-amber-400">
                          <Plus className="h-4 w-4" />
                          Drop to add data
                        </span>
                      )}
                      {processingDropWidgetId === selectedWidgetId && (
                        <span className="flex items-center gap-2 text-sm text-amber-400">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing...
                        </span>
                      )}
                      {/* Delete button in widget detail view */}
                      {selectedWidgetId && !deletingWidgetId && (
                        <button
                          type="button"
                          onClick={(e) =>
                            handleDeleteWidget(e, selectedWidgetId)
                          }
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-all hover:bg-red-600/20 hover:text-red-400"
                          title="Delete widget"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Delete</span>
                        </button>
                      )}
                      {deletingWidgetId === selectedWidgetId && (
                        <span className="flex items-center gap-2 text-sm text-red-400">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Deleting...
                        </span>
                      )}
                    </div>

                    {/* Widget Content - Fullscreen or vertical layout when editing */}
                    <div className="relative min-h-0 grow bg-zinc-900 overflow-hidden">
                      {/* Widget Preview - uses absolute positioning for smooth animation */}
                      <div
                        style={{
                          transition:
                            'top 700ms cubic-bezier(0.4, 0, 0.2, 1), left 700ms cubic-bezier(0.4, 0, 0.2, 1), right 700ms cubic-bezier(0.4, 0, 0.2, 1), bottom 700ms cubic-bezier(0.4, 0, 0.2, 1), border-radius 700ms cubic-bezier(0.4, 0, 0.2, 1), border-color 700ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 700ms cubic-bezier(0.4, 0, 0.2, 1)',
                          position: 'absolute',
                          top: widgetEditMode ? '1rem' : '0',
                          left: widgetEditMode ? '1.5rem' : '0',
                          right: widgetEditMode ? '1.5rem' : '0',
                          bottom: widgetEditMode ? '45%' : '0',
                          borderRadius: widgetEditMode ? '1rem' : '0',
                          border: widgetEditMode
                            ? '1px solid rgb(63 63 70)'
                            : '1px solid transparent',
                          boxShadow: widgetEditMode
                            ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                            : '0 0 0 0 rgba(0, 0, 0, 0)',
                        }}
                        className="bg-zinc-900 overflow-hidden"
                      >
                        {/* Fullscreen button when in edit mode */}
                        {widgetEditMode && (
                          <button
                            type="button"
                            onClick={closeWidgetEditMode}
                            className="absolute right-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-400 backdrop-blur-sm transition-all hover:bg-zinc-700 hover:text-zinc-100 hover:scale-105"
                            aria-label="Fullscreen"
                            title="Exit to fullscreen"
                          >
                            <Maximize2 className="h-4 w-4" />
                          </button>
                        )}

                        {isLoadingWidgetDetail ? (
                          <div className="flex h-full items-center justify-center bg-zinc-900">
                            <div className="flex flex-col items-center gap-3">
                              <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
                              <p className="text-sm text-zinc-400">
                                Loading widget...
                              </p>
                            </div>
                          </div>
                        ) : selectedWidgetDetail?.status === 'generating' ? (
                          <div className="flex h-full items-center justify-center bg-zinc-900">
                            <div className="flex flex-col items-center gap-4 text-center">
                              <div className="relative">
                                <div className="h-16 w-16 rounded-full border-4 border-zinc-700" />
                                <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-4 border-transparent border-t-amber-500" />
                              </div>
                              <div>
                                <p className="text-lg font-medium text-zinc-300">
                                  Generating widget...
                                </p>
                                <p className="mt-1 text-sm text-zinc-500">
                                  This may take a moment
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : selectedWidgetDetail?.status === 'error' ? (
                          <div className="flex h-full items-center justify-center bg-zinc-900">
                            <div className="flex flex-col items-center gap-4 text-center px-6">
                              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-900/20">
                                <AlertCircle className="h-8 w-8 text-red-400" />
                              </div>
                              <div>
                                <p className="text-lg font-medium text-red-300">
                                  Failed to generate widget
                                </p>
                                <p className="mt-2 max-w-md text-sm text-zinc-500">
                                  {selectedWidgetDetail.errorMessage ||
                                    'An unknown error occurred while generating this widget'}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : selectedWidgetDetail?.componentCode ? (
                          <WidgetRenderer
                            widgetId={selectedWidgetId}
                            componentCode={selectedWidgetDetail.componentCode}
                            dataItems={selectedWidgetData}
                            onDataChange={handleWidgetDataChange}
                            onAskToFix={handleAskToFix}
                            existingCodeHash={selectedWidgetDetail.codeHash}
                            onThumbnailCaptured={() => {
                              // Refresh widgets list to show new thumbnail
                              void fetchWidgets();
                            }}
                            className="h-full w-full"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center bg-zinc-900">
                            <div className="flex flex-col items-center gap-4 text-center">
                              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
                                <LayoutDashboard className="h-8 w-8 text-zinc-600" />
                              </div>
                              <p className="text-sm text-zinc-500">
                                No widget content available
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Conversation Panel - positioned at bottom when editing */}
                      <div
                        style={{
                          transition: 'all 700ms cubic-bezier(0.4, 0, 0.2, 1)',
                          position: 'absolute',
                          top: widgetEditMode ? '56%' : '100%',
                          left: 0,
                          right: 0,
                          bottom: 0,
                          opacity: widgetEditMode ? 1 : 0,
                          pointerEvents: widgetEditMode ? 'auto' : 'none',
                        }}
                        className="flex justify-center overflow-hidden"
                      >
                        <section className="relative flex min-h-0 w-full max-w-3xl flex-col px-4 sm:px-6">
                          <div className="flex grow flex-col gap-3 overflow-y-auto py-6 pb-24">
                            {widgetEditMessages.length === 0 ? (
                              <div className="flex grow items-center justify-center text-sm text-zinc-300">
                                Ask to make changes to the UI above.
                              </div>
                            ) : (
                              widgetEditMessages.map((msg, idx) => (
                                <article
                                  key={idx}
                                  className={`flex ${
                                    msg.role === 'user'
                                      ? 'justify-end'
                                      : 'justify-start'
                                  }`}
                                >
                                  <div
                                    className={`text-base leading-7 ${
                                      msg.role === 'user'
                                        ? 'max-w-[80%] rounded-2xl bg-zinc-700 px-4 py-3 text-zinc-100'
                                        : 'w-full px-2 py-2 text-zinc-100'
                                    }`}
                                  >
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      className="max-w-none break-words"
                                      components={{
                                        h1: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => (
                                          <h1 className="mt-8 mb-4 text-2xl font-bold first:mt-0">
                                            {children}
                                          </h1>
                                        ),
                                        h2: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => (
                                          <h2 className="mt-8 mb-4 text-xl font-bold first:mt-0">
                                            {children}
                                          </h2>
                                        ),
                                        h3: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => (
                                          <h3 className="mt-6 mb-3 text-lg font-bold first:mt-0">
                                            {children}
                                          </h3>
                                        ),
                                        p: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => {
                                          // Check if children contain a <pre> element (block code)
                                          // If so, render without <p> wrapper to avoid invalid HTML
                                          const checkForPre = (
                                            node: ReactNode
                                          ): boolean => {
                                            if (React.isValidElement(node)) {
                                              if (node.type === 'pre') {
                                                return true;
                                              }
                                              const props = node.props as {
                                                children?: ReactNode;
                                              };
                                              if (props?.children) {
                                                return React.Children.toArray(
                                                  props.children
                                                ).some(checkForPre);
                                              }
                                            }
                                            return false;
                                          };

                                          const hasPreElement =
                                            React.Children.toArray(
                                              children
                                            ).some(checkForPre);

                                          if (hasPreElement) {
                                            return <>{children}</>;
                                          }

                                          return (
                                            <p className="my-4 first:mt-0 last:mb-0">
                                              {children}
                                            </p>
                                          );
                                        },
                                        ul: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => (
                                          <ul className="mt-4 mb-2 list-disc pl-6">
                                            {children}
                                          </ul>
                                        ),
                                        ol: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => (
                                          <ol className="mt-4 mb-2 list-decimal pl-6">
                                            {children}
                                          </ol>
                                        ),
                                        li: ({
                                          children,
                                        }: {
                                          children?: ReactNode;
                                        }) => (
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
                                        hr: () => (
                                          <hr className="my-6 border-zinc-700" />
                                        ),
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
                                              <code
                                                {...props}
                                                className={className}
                                              >
                                                {children}
                                              </code>
                                            </pre>
                                          );
                                        },
                                      }}
                                    >
                                      {msg.content}
                                    </ReactMarkdown>
                                  </div>
                                </article>
                              ))
                            )}
                            <div ref={widgetEditBottomRef} />
                          </div>
                        </section>
                      </div>
                    </div>

                    {/* Fixed Input box at bottom - always in same position */}
                    {selectedWidgetDetail?.componentCode && (
                      <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-6 sm:px-6">
                        <div className="w-full max-w-3xl">
                          <form onSubmit={handleWidgetEditSubmit}>
                            <div className="flex items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-800/95 py-2 pl-4 pr-2 shadow-xl shadow-black/40 backdrop-blur-sm transition-colors focus-within:border-zinc-500 focus-within:bg-zinc-800">
                              <textarea
                                ref={(el) => {
                                  if (el) {
                                    el.style.height = 'auto';
                                    el.style.height = `${Math.min(
                                      el.scrollHeight,
                                      200
                                    )}px`;
                                  }
                                }}
                                value={widgetEditInput}
                                onChange={(e) => {
                                  setWidgetEditInput(e.target.value);
                                  const target = e.target;
                                  target.style.height = 'auto';
                                  target.style.height = `${Math.min(
                                    target.scrollHeight,
                                    200
                                  )}px`;
                                }}
                                onKeyDown={handleWidgetEditKeyDown}
                                rows={1}
                                placeholder="Ask to change this UI..."
                                className="max-h-[200px] min-h-[32px] flex-1 resize-none bg-transparent py-1 text-base leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                              />
                              {isWidgetEditLoading ? (
                                <button
                                  type="button"
                                  onClick={stopWidgetEditGeneration}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition-all hover:bg-red-500 hover:scale-105"
                                  aria-label="Stop generating"
                                >
                                  <Square className="h-3.5 w-3.5 fill-current" />
                                </button>
                              ) : (
                                <button
                                  type="submit"
                                  disabled={!widgetEditInput.trim()}
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-600 text-zinc-100 transition-all hover:bg-zinc-500 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                                  aria-label="Send message"
                                >
                                  <Send className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                            <p className="mt-2 text-center text-xs text-zinc-500">
                              {isWidgetEditLoading
                                ? 'Press Escape or click stop to cancel'
                                : 'Press Enter to send, Shift + Enter for new line'}
                            </p>
                          </form>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Overview - Widget Grid */
                  <div className="flex-1 overflow-y-auto p-8">
                    {isLoadingTags ? (
                      <div className="flex h-64 items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-amber-500" />
                          <p className="text-sm text-zinc-400">
                            Loading widgets...
                          </p>
                        </div>
                      </div>
                    ) : widgets.length === 0 ? (
                      <div
                        className={`flex h-64 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed transition-all mx-4 ${
                          draggingConversationId
                            ? isDropTargetNewWidget
                              ? 'border-amber-500 bg-amber-900/20'
                              : 'border-amber-500/50 bg-amber-900/10'
                            : 'border-transparent'
                        }`}
                        onDragEnter={handleNewWidgetDragEnter}
                        onDragLeave={handleNewWidgetDragLeave}
                        onDragOver={handleDragOver}
                        onDrop={handleDropOnNewWidget}
                      >
                        {draggingConversationId ? (
                          <>
                            <div
                              className={`flex h-16 w-16 items-center justify-center rounded-full ${
                                isDropTargetNewWidget
                                  ? 'bg-amber-900/40 text-amber-400'
                                  : 'bg-amber-900/20 text-amber-500'
                              }`}
                            >
                              <Plus className="h-8 w-8" />
                            </div>
                            <div className="text-center">
                              <p
                                className={`text-lg font-medium ${
                                  isDropTargetNewWidget
                                    ? 'text-amber-300'
                                    : 'text-amber-400'
                                }`}
                              >
                                Drop to Create Widget
                              </p>
                              <p className="text-sm text-zinc-500">
                                A new widget will be generated from this
                                conversation
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <LayoutDashboard className="h-16 w-16 text-zinc-700" />
                            <div className="text-center">
                              <p className="text-lg font-medium text-zinc-300">
                                No widgets yet
                              </p>
                              <p className="text-sm text-zinc-500">
                                Start conversations to generate widgets
                                automatically, or drag a conversation here
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div
                        className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                        onDragOver={handleDragOver}
                      >
                        {widgets.map((widget) => {
                          const isDropTarget = dropTargetWidgetId === widget.id;
                          const isProcessing =
                            processingDropWidgetId === widget.id;
                          const isDeleting = deletingWidgetId === widget.id;
                          const isSelected = selectedWidgetIds.has(widget.id);
                          const canSelect = widget.status !== 'generating';
                          const isHighlightedWidget = highlightedWidgetIds.has(
                            widget.id
                          );
                          return (
                            <div key={widget.id} className="relative group">
                              <button
                                type="button"
                                onClick={() => {
                                  if (dashboardEditMode && canSelect) {
                                    toggleWidgetSelection(widget.id);
                                  } else if (!dashboardEditMode) {
                                    handleWidgetSelect(widget.id);
                                  }
                                }}
                                onDragEnter={(e) =>
                                  !dashboardEditMode &&
                                  handleWidgetDragEnter(e, widget.id)
                                }
                                onDragLeave={
                                  dashboardEditMode
                                    ? undefined
                                    : handleWidgetDragLeave
                                }
                                onDragOver={
                                  dashboardEditMode ? undefined : handleDragOver
                                }
                                onDrop={(e) =>
                                  !dashboardEditMode &&
                                  handleDropOnWidget(e, widget.id)
                                }
                                disabled={isDeleting}
                                className={`w-full flex flex-col gap-4 rounded-xl border p-6 text-left transition-all duration-200 ${
                                  dashboardEditMode
                                    ? isSelected
                                      ? 'border-amber-500 bg-amber-900/20 ring-2 ring-amber-500/50'
                                      : canSelect
                                      ? 'border-zinc-700/50 bg-zinc-800/30 hover:border-zinc-600 hover:bg-zinc-800/50'
                                      : 'border-zinc-700/30 bg-zinc-800/20 opacity-50 cursor-not-allowed'
                                    : isDeleting
                                    ? 'opacity-50 cursor-not-allowed'
                                    : isDropTarget
                                    ? 'border-amber-500 bg-amber-900/30 ring-2 ring-amber-500/50 scale-[1.02]'
                                    : isProcessing
                                    ? 'border-amber-500/50 bg-amber-900/20 animate-pulse'
                                    : isHighlightedWidget
                                    ? 'border-amber-400 bg-amber-900/25 ring-2 ring-amber-400/40 shadow-lg shadow-amber-900/30 scale-[1.01]'
                                    : widget.status === 'generating'
                                    ? 'border-amber-500/30 bg-amber-900/10 hover:border-amber-500/50 hover:bg-amber-900/20'
                                    : widget.status === 'error'
                                    ? 'border-red-500/30 bg-red-900/10 hover:border-red-500/50 hover:bg-red-900/20'
                                    : 'border-zinc-700/50 bg-zinc-800/30 hover:border-zinc-600 hover:bg-zinc-800/50 hover:shadow-xl hover:shadow-zinc-900/50 hover:-translate-y-0.5'
                                }`}
                              >
                                {/* Thumbnail Preview */}
                                {widget.thumbnailUrl &&
                                  widget.status === 'active' &&
                                  !dashboardEditMode && (
                                    <div className="relative -mx-6 -mt-6 mb-4 h-32 overflow-hidden rounded-t-xl bg-zinc-900">
                                      <img
                                        src={widget.thumbnailUrl}
                                        alt={`Preview of ${
                                          widget.name || widget.globalTag
                                        }`}
                                        className="h-full w-full object-cover object-top opacity-80 transition-opacity group-hover:opacity-100"
                                      />
                                      <div className="absolute inset-0 bg-gradient-to-t from-zinc-800/90 via-transparent to-transparent" />
                                    </div>
                                  )}
                                <div className="flex items-start justify-between">
                                  {/* Checkbox in edit mode, icon otherwise */}
                                  {dashboardEditMode ? (
                                    <div
                                      className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all ${
                                        isSelected
                                          ? 'bg-amber-600 text-white'
                                          : canSelect
                                          ? 'bg-zinc-700/50 text-zinc-400'
                                          : 'bg-zinc-700/30 text-zinc-600'
                                      }`}
                                    >
                                      {isSelected ? (
                                        <CheckSquare className="h-6 w-6" />
                                      ) : (
                                        <SquareDashed className="h-6 w-6" />
                                      )}
                                    </div>
                                  ) : !widget.thumbnailUrl ||
                                    widget.status !== 'active' ? (
                                    <div
                                      className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                                        widget.status === 'generating'
                                          ? 'bg-amber-900/30 text-amber-500'
                                          : widget.status === 'error'
                                          ? 'bg-red-900/30 text-red-400'
                                          : 'bg-zinc-700/50 text-amber-500'
                                      }`}
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                      ) : widget.status === 'generating' ? (
                                        <Loader2 className="h-6 w-6 animate-spin" />
                                      ) : widget.status === 'error' ? (
                                        <AlertCircle className="h-6 w-6" />
                                      ) : (
                                        <LayoutDashboard className="h-6 w-6" />
                                      )}
                                    </div>
                                  ) : null}
                                  {!dashboardEditMode && (
                                    <ChevronRight className="h-5 w-5 text-zinc-600 transition-transform group-hover:translate-x-1 group-hover:text-zinc-400" />
                                  )}
                                </div>
                                <div>
                                  <h4 className="text-lg font-medium text-zinc-200 line-clamp-2">
                                    {widget.name || widget.globalTag}
                                  </h4>
                                  <div className="mt-2 flex items-center gap-2">
                                    <p className="text-sm text-zinc-500">
                                      {widget.conversationIds.length}{' '}
                                      conversation
                                      {widget.conversationIds.length !== 1
                                        ? 's'
                                        : ''}
                                    </p>
                                    {widget.status === 'generating' && (
                                      <span className="text-sm text-amber-500">
                                        Generating...
                                      </span>
                                    )}
                                    {widget.status === 'error' && (
                                      <span className="text-sm text-red-400">
                                        Error
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                              {/* Delete button - appears on hover (only when not in edit mode) */}
                              {!dashboardEditMode && (
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleDeleteWidget(e, widget.id)
                                  }
                                  disabled={
                                    isDeleting || widget.status === 'generating'
                                  }
                                  className={`absolute top-3 right-3 p-2 rounded-lg transition-all ${
                                    widget.status === 'generating'
                                      ? 'hidden'
                                      : 'opacity-0 group-hover:opacity-100 bg-zinc-700/80 hover:bg-red-600 text-zinc-400 hover:text-white'
                                  }`}
                                  title="Delete widget"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {/* New Widget Drop Zone */}
                        {draggingConversationId && (
                          <div
                            onDragEnter={handleNewWidgetDragEnter}
                            onDragLeave={handleNewWidgetDragLeave}
                            onDragOver={handleDragOver}
                            onDrop={handleDropOnNewWidget}
                            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 transition-all duration-200 ${
                              isDropTargetNewWidget
                                ? 'border-amber-500 bg-amber-900/20 scale-[1.02]'
                                : 'border-zinc-600 bg-zinc-800/20 hover:border-zinc-500 hover:bg-zinc-800/30'
                            }`}
                          >
                            <div
                              className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                                isDropTargetNewWidget
                                  ? 'bg-amber-900/40 text-amber-500'
                                  : 'bg-zinc-700/50 text-zinc-400'
                              }`}
                            >
                              <Plus className="h-6 w-6" />
                            </div>
                            <div className="text-center">
                              <p
                                className={`text-sm font-medium ${
                                  isDropTargetNewWidget
                                    ? 'text-amber-400'
                                    : 'text-zinc-400'
                                }`}
                              >
                                Create New Widget
                              </p>
                              <p className="text-xs text-zinc-500">
                                Drop conversation here
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Edit Mode Action Bar */}
                    {dashboardEditMode && (
                      <div className="sticky bottom-0 left-0 right-0 mt-4 flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-800/95 p-4 shadow-xl backdrop-blur-sm">
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-zinc-400">
                            {selectedWidgetIds.size} selected
                          </span>
                          <div className="h-4 w-px bg-zinc-600" />
                          <button
                            type="button"
                            onClick={selectAllWidgets}
                            className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                          >
                            Select all
                          </button>
                          {selectedWidgetIds.size > 0 && (
                            <button
                              type="button"
                              onClick={deselectAllWidgets}
                              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                            >
                              Deselect all
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleMergeWidgets}
                            disabled={
                              selectedWidgetIds.size < 2 ||
                              isMerging ||
                              isBulkDeleting
                            }
                            className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-600"
                          >
                            {isMerging ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Merging...
                              </>
                            ) : (
                              <>
                                <Merge className="h-4 w-4" />
                                Merge ({selectedWidgetIds.size})
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleBulkDelete}
                            disabled={
                              selectedWidgetIds.size === 0 ||
                              isBulkDeleting ||
                              isMerging
                            }
                            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
                          >
                            {isBulkDeleting ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Deleting...
                              </>
                            ) : (
                              <>
                                <Trash2 className="h-4 w-4" />
                                Delete ({selectedWidgetIds.size})
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Chat View */
            <div className="flex min-h-0 grow justify-center px-4 sm:px-6">
              <div className="flex h-full w-full max-w-3xl flex-col bg-zinc-900 text-zinc-100">
                <section className="relative flex min-h-0 grow flex-col">
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleScroll}
                    className="flex grow flex-col gap-3 overflow-y-auto p-6"
                  >
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
                                h1: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => (
                                  <h1 className="mt-8 mb-4 text-2xl font-bold first:mt-0">
                                    {children}
                                  </h1>
                                ),
                                h2: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => (
                                  <h2 className="mt-8 mb-4 text-xl font-bold first:mt-0">
                                    {children}
                                  </h2>
                                ),
                                h3: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => (
                                  <h3 className="mt-6 mb-3 text-lg font-bold first:mt-0">
                                    {children}
                                  </h3>
                                ),
                                p: ({ children }: { children?: ReactNode }) => (
                                  <p className="my-4 first:mt-0 last:mb-0">
                                    {children}
                                  </p>
                                ),
                                ul: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => (
                                  <ul className="mt-4 mb-2 list-disc pl-6">
                                    {children}
                                  </ul>
                                ),
                                ol: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => (
                                  <ol className="mt-4 mb-2 list-decimal pl-6">
                                    {children}
                                  </ol>
                                ),
                                li: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => <li className="my-1">{children}</li>,
                                blockquote: ({
                                  children,
                                }: {
                                  children?: ReactNode;
                                }) => (
                                  <blockquote className="my-4 border-l-4 border-zinc-600 pl-4 italic">
                                    {children}
                                  </blockquote>
                                ),
                                hr: () => (
                                  <hr className="my-6 border-zinc-700" />
                                ),
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

                  {/* Scroll to bottom button */}
                  {userHasScrolledUp && (
                    <button
                      type="button"
                      onClick={scrollToBottom}
                      className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-700 text-zinc-100 shadow-lg transition-all hover:bg-zinc-600 hover:scale-105"
                      aria-label="Scroll to bottom"
                    >
                      <ArrowDown className="h-5 w-5" />
                    </button>
                  )}
                </section>

                <div className="shrink-0 border-t border-zinc-800 bg-zinc-900 px-6 pb-6 pt-4">
                  {error ? (
                    <div className="mb-3 text-sm text-red-200">{error}</div>
                  ) : null}
                  <form onSubmit={handleSubmit}>
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-800/50 py-2 pl-4 pr-2 transition-colors focus-within:border-zinc-500 focus-within:bg-zinc-800">
                      <textarea
                        ref={(el) => {
                          if (el) {
                            el.style.height = 'auto';
                            el.style.height = `${Math.min(
                              el.scrollHeight,
                              200
                            )}px`;
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
                        className="max-h-[200px] min-h-[32px] flex-1 resize-none bg-transparent py-1 text-base leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                      />
                      {isLoading ? (
                        <button
                          type="button"
                          onClick={stopGeneration}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition-all hover:bg-red-500 hover:scale-105"
                          aria-label="Stop generating"
                        >
                          <Square className="h-3.5 w-3.5 fill-current" />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={!input.trim()}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-600 text-zinc-100 transition-all hover:bg-zinc-500 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                          aria-label="Send message"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-center text-xs text-zinc-500">
                      {isLoading
                        ? 'Press Escape or click stop to cancel'
                        : 'Press Enter to send, Shift + Enter for new line'}
                    </p>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
