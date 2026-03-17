'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { useAppStore, type QueuedMessage } from '@/stores/appStore';
import {
  useMessages,
  useMessagePagination,
  useHasUserMessages,
  useStreamingConversationArea,
} from '@/stores/selectors';
import { ConversationMarkers } from '@/components/conversation/ConversationMarkers';
import { Button } from '@/components/ui/button';
import { ChevronDown, GitBranch, Sparkles, Bug, TestTube2, Eye, RefreshCw, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { StreamingMessage } from '@/components/conversation/StreamingMessage';
import { QueuedMessageBubble } from '@/components/conversation/QueuedMessageBubble';
import { VirtualizedMessageList, type VirtualizedMessageListHandle } from '@/components/conversation/VirtualizedMessageList';
import { ChatSearchBar, countSearchMatches } from '@/components/conversation/ChatSearchBar';
import { useShortcut } from '@/hooks/useShortcut';
import { getConversationMessages, toStoreMessage } from '@/lib/api';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';

// Stable empty array to avoid re-renders from selector
const EMPTY_QUEUED_MESSAGES: readonly QueuedMessage[] = [];

// Module-level scroll position cache shared across all CachedConversationPane
// instances. Keyed by conversationId so each conversation remembers its position.
// Stored outside the component to avoid ref-in-render lint issues since we read it
// during render to compute initialTopMostItemIndex for Virtuoso.
const scrollPositions = new Map<string, { dataIndex: number; wasAtBottom: boolean }>();

// Wrapper that defers messages to ConversationMarkers so marker extraction
// doesn't block higher-priority streaming or message rendering.
function DeferredConversationMarkers({ messages, onScrollToIndex }: {
  messages: readonly Message[];
  onScrollToIndex: (index: number) => void;
}) {
  const deferredMessages = useDeferredValue(messages);
  return <ConversationMarkers messages={deferredMessages} onScrollToIndex={onScrollToIndex} />;
}

// Gate that conditionally renders StreamingMessage based on pane visibility.
function StreamingMessageGate({
  isActive,
  conversationId,
  worktreePath,
}: {
  isActive: boolean;
  conversationId: string;
  worktreePath?: string;
}) {
  if (!isActive) return null;
  return (
    <ErrorBoundary
      section="StreamingMessage"
      fallback={<InlineErrorFallback message="Error displaying streaming message" />}
    >
      <StreamingMessage conversationId={conversationId} worktreePath={worktreePath} />
    </ErrorBoundary>
  );
}

interface CachedConversationPaneProps {
  conversationId: string | null;
  isActive: boolean;
  worktreePath?: string;
  sessionName?: string;
  sessionBranch?: string;
  hasConversations: boolean;
  children?: React.ReactNode;
}

export function CachedConversationPane({
  conversationId,
  isActive,
  worktreePath,
  sessionName,
  sessionBranch,
  hasConversations,
  children,
}: CachedConversationPaneProps) {
  // Message data from store
  const allConversationMessages = useMessages(conversationId);
  const pagination = useMessagePagination(conversationId);
  const setMessagePage = useAppStore((s) => s.setMessagePage);
  const prependMessages = useAppStore((s) => s.prependMessages);
  const setLoadingMoreMessages = useAppStore((s) => s.setLoadingMoreMessages);
  const hasUserMessages = useHasUserMessages(conversationId);

  // Streaming state
  const selectedStreaming = useStreamingConversationArea(conversationId);
  const queuedMessages = useAppStore(
    (s) => conversationId ? s.queuedMessages[conversationId] ?? EMPTY_QUEUED_MESSAGES : EMPTY_QUEUED_MESSAGES
  );
  const removeQueuedMessage = useAppStore((s) => s.removeQueuedMessage);

  // Hide the setupInfo system card once the user has sent their first message
  const conversationMessages = useMemo(() => {
    if (!conversationId) return allConversationMessages;
    if (!hasUserMessages) return allConversationMessages;
    return allConversationMessages.filter(m => !(m.role === 'system' && m.setupInfo));
  }, [allConversationMessages, conversationId, hasUserMessages]);

  // Load messages on-demand when conversation is selected (paginated)
  useEffect(() => {
    if (!conversationId) return;

    const state = useAppStore.getState();
    const messageCount = state.messagesByConversation[conversationId]?.length ?? 0;
    const existingPagination = state.messagePagination[conversationId];

    // Only skip if we have pagination AND messages in the store.
    // removeWorkspace / removeSession clear messagesByConversation but may leave
    // stale messagePagination entries, producing pagination-with-no-messages.
    // Without this guard the effect would bail out and render a blank screen.
    if (existingPagination && messageCount > 0) return;

    // Messages arrived inline (e.g. via WebSocket) — skip paginated load.
    if (messageCount > 0) return;

    let cancelled = false;
    async function loadMessages() {
      try {
        const page = await getConversationMessages(conversationId!, { limit: 50, compact: true });
        if (cancelled) return;
        const messages = page.messages.map((m) => toStoreMessage(m, conversationId!, { compacted: true }));
        setMessagePage(conversationId!, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
      } catch (error) {
        console.error('Failed to load conversation messages:', error);
      }
    }
    loadMessages();
    return () => { cancelled = true; };
  }, [conversationId, setMessagePage]);

  // Chat search state - keyed by conversation to auto-reset
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchState, setSearchState] = useState<{ convId: string | null; query: string; matchIndex: number }>({
    convId: null,
    query: '',
    matchIndex: 0,
  });

  // Derive search values, resetting if conversation changed
  const searchQuery = searchState.convId === conversationId ? searchState.query : '';
  const currentMatchIndex = searchState.convId === conversationId ? searchState.matchIndex : 0;

  const debouncedSearchQuery = useDeferredValue(searchQuery);

  const setSearchQuery = useCallback((query: string) => {
    setSearchState({ convId: conversationId, query, matchIndex: 0 });
  }, [conversationId]);

  const setCurrentMatchIndex = useCallback((indexOrFn: number | ((prev: number) => number)) => {
    setSearchState((prev) => ({
      ...prev,
      convId: conversationId,
      matchIndex: typeof indexOrFn === 'function' ? indexOrFn(prev.matchIndex) : indexOrFn,
    }));
  }, [conversationId]);

  // Single-pass search computation
  const { searchMatches, messageHasMatches } = useMemo(() => {
    if (!debouncedSearchQuery) {
      return {
        searchMatches: { total: 0, messageOffsets: [] as number[] },
        messageHasMatches: [] as boolean[],
      };
    }

    let total = 0;
    const messageOffsets: number[] = [];
    const hasMatches: boolean[] = [];

    for (const message of conversationMessages) {
      messageOffsets.push(total);
      const count = countSearchMatches(message.content, debouncedSearchQuery);
      total += count;
      hasMatches.push(count > 0);
    }

    return {
      searchMatches: { total, messageOffsets },
      messageHasMatches: hasMatches,
    };
  }, [conversationMessages, debouncedSearchQuery]);

  const clampedMatchIndex = searchMatches.total > 0
    ? Math.min(currentMatchIndex, searchMatches.total - 1)
    : 0;

  // Pagination: compute firstItemIndex for Virtuoso scroll stability when prepending
  const VIRTUAL_BASE_INDEX = 100_000;
  const firstItemIndex = pagination
    ? VIRTUAL_BASE_INDEX - (pagination.totalCount - conversationMessages.length)
    : VIRTUAL_BASE_INDEX;

  // Load older messages when user scrolls to top
  const handleStartReached = useCallback(async () => {
    if (!conversationId || !pagination?.hasMore || pagination?.isLoadingMore) return;

    setLoadingMoreMessages(conversationId, true);
    try {
      const page = await getConversationMessages(conversationId, {
        before: pagination.oldestPosition ?? undefined,
        limit: 50,
        compact: true,
      });
      const messages = page.messages.map((m) => toStoreMessage(m, conversationId, { compacted: true }));
      prependMessages(conversationId, messages, page.hasMore, page.oldestPosition ?? 0);
    } catch (error) {
      console.error('Failed to load older messages:', error);
      setLoadingMoreMessages(conversationId, false);
    }
  }, [conversationId, pagination, setLoadingMoreMessages, prependMessages]);

  // Search navigation handlers
  const goToNextMatch = useCallback(() => {
    if (searchMatches.total > 0) {
      setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.total);
    }
  }, [searchMatches.total, setCurrentMatchIndex]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.total > 0) {
      setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.total) % searchMatches.total);
    }
  }, [searchMatches.total, setCurrentMatchIndex]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  // Auto-scroll management via Virtuoso
  const messageListRef = useRef<VirtualizedMessageListHandle>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const forceFollowRef = useRef(false);
  const isActiveRef = useRef(isActive);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Continuously track the visible range
  const handleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (!conversationId) return;
    scrollPositions.set(conversationId, {
      dataIndex: range.startIndex,
      wasAtBottom: isAtBottomRef.current,
    });
  }, [conversationId]);

  // Clear forceFollow on conversation switch
  useEffect(() => {
    forceFollowRef.current = false;
  }, [conversationId]);

  const initialTopMostItemIndex = useMemo(() => {
    if (!conversationId) return { index: 'LAST' as const, align: 'end' as const };
    const saved = scrollPositions.get(conversationId);
    if (saved && !saved.wasAtBottom) {
      return { index: saved.dataIndex, align: 'start' as const };
    }
    return { index: 'LAST' as const, align: 'end' as const };
  }, [conversationId]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (atBottom) forceFollowRef.current = false;
    // Only update scroll-button state for the active pane to avoid
    // unnecessary re-renders on hidden Virtuoso instances.
    if (isActiveRef.current) setShowScrollButton(!atBottom);
  }, []);

  const forceScrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    messageListRef.current?.scrollToBottom('auto');
  }, []);

  // Footer for VirtualizedMessageList
  const messageListFooter = useMemo(() => {
    if (!conversationId) return undefined;
    return (
      <div className="pl-5 pr-12 pb-16">
        <StreamingMessageGate
          isActive={isActive}
          conversationId={conversationId}
          worktreePath={worktreePath}
        />
        {queuedMessages.length > 0 && (
          <QueuedMessageBubble
            messages={queuedMessages}
            onDelete={(messageId) => {
              if (conversationId) {
                removeQueuedMessage(conversationId, messageId);
              }
            }}
          />
        )}
      </div>
    );
  }, [conversationId, isActive, queuedMessages, removeQueuedMessage, worktreePath]);

  // Listen for message submit events to force scroll to bottom.
  // Only the active pane registers the listener to avoid redundant work.
  useEffect(() => {
    if (!isActive) return;
    const handleMessageSubmit = () => {
      forceFollowRef.current = true;
      forceScrollToBottom();
    };

    window.addEventListener('chat-message-submitted', handleMessageSubmit);
    return () => {
      window.removeEventListener('chat-message-submitted', handleMessageSubmit);
    };
  }, [isActive, forceScrollToBottom]);

  // Pin scroll to bottom when content height changes during streaming.
  // Virtuoso's followOutput only fires on new items/footer changes, not when
  // existing content changes height (e.g., lazy-loaded EditToolDetail resolving
  // inside a Suspense boundary, or CollapsibleContent expanding).
  useEffect(() => {
    if (!selectedStreaming.isStreaming || !isActive) return;

    const scrollerEl = messageListRef.current?.getScrollerElement();
    if (!scrollerEl) return;
    const contentEl = scrollerEl.firstElementChild;
    if (!contentEl) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (!isAtBottomRef.current && !forceFollowRef.current) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        scrollerEl.scrollTop = scrollerEl.scrollHeight - scrollerEl.clientHeight;
        rafId = null;
      });
    });

    observer.observe(contentEl);

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [selectedStreaming.isStreaming, isActive]);

  // Scroll handler for conversation markers minimap
  const handleMarkerScrollToIndex = useCallback((index: number) => {
    messageListRef.current?.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
  }, []);

  // Register keyboard shortcuts for search (only enabled for the active pane)
  useShortcut('searchChat', useCallback(() => {
    setSearchOpen(true);
  }, []), { enabled: isActive });

  useShortcut('searchNextMatch', useCallback(() => {
    if (searchOpen) goToNextMatch();
  }, [searchOpen, goToNextMatch]), { enabled: isActive });

  useShortcut('searchPrevMatch', useCallback(() => {
    if (searchOpen) goToPrevMatch();
  }, [searchOpen, goToPrevMatch]), { enabled: isActive });

  // Scroll to current match when it changes
  useEffect(() => {
    if (!isActive) return;
    if (!searchQuery || searchMatches.total === 0) return;

    const matchElement = document.querySelector(`mark[data-match-index="${clampedMatchIndex}"]`);
    if (matchElement) {
      matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isActive, clampedMatchIndex, searchQuery, searchMatches.total]);

  // Scroll to the message containing the current search match
  useEffect(() => {
    if (!isActive) return;
    if (!debouncedSearchQuery || searchMatches.total === 0) return;
    const offsets = searchMatches.messageOffsets;
    let targetIndex = 0;
    for (let i = 0; i < offsets.length; i++) {
      const nextOffset = offsets[i + 1] ?? searchMatches.total;
      if (clampedMatchIndex >= offsets[i] && clampedMatchIndex < nextOffset) {
        targetIndex = i;
        break;
      }
    }
    messageListRef.current?.scrollToIndex(targetIndex, { align: 'center', behavior: 'smooth' });
  }, [isActive, clampedMatchIndex, debouncedSearchQuery, searchMatches]);

  return (
    <div className={isActive ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        {/* Chat Search Bar */}
        <ChatSearchBar
          isOpen={searchOpen}
          onClose={closeSearch}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          currentMatchIndex={clampedMatchIndex}
          totalMatches={searchMatches.total}
          onNextMatch={goToNextMatch}
          onPrevMatch={goToPrevMatch}
          partialResults={pagination?.hasMore}
          isSearchPending={searchQuery !== debouncedSearchQuery}
        />
        <VirtualizedMessageList
          key={conversationId ?? 'none'}
          ref={messageListRef}
          messages={conversationMessages}
          worktreePath={worktreePath}
          searchQuery={debouncedSearchQuery}
          currentMatchIndex={clampedMatchIndex}
          searchMatches={searchMatches}
          messageHasMatches={messageHasMatches}
          initialTopMostItemIndex={initialTopMostItemIndex}
          onRangeChanged={handleRangeChanged}
          onAtBottomStateChange={handleAtBottomStateChange}
          onStartReached={isActive && pagination?.hasMore ? handleStartReached : undefined}
          firstItemIndex={firstItemIndex}
          isLoadingOlder={pagination?.isLoadingMore}
          emptyState={
            (!conversationId || conversationMessages.length === 0) ? (
              !hasConversations
                ? <SessionHomeState sessionName={sessionBranch || sessionName} />
                : <ConversationEmptyState sessionName={sessionName} />
            ) : undefined
          }
          footer={messageListFooter}
          isStreaming={selectedStreaming.isStreaming}
          // When inactive, force pendingPlanApproval=true to suppress Virtuoso
          // auto-follow — we don't want hidden panes scrolling in the background.
          pendingPlanApproval={isActive ? selectedStreaming.hasPendingPlanApproval : true}
          forceFollowRef={forceFollowRef}
        />
        {/* Conversation markers minimap — deferred so marker extraction doesn't
             block streaming updates or message appends */}
        {isActive && conversationMessages.length > 3 && (
          <DeferredConversationMarkers
            messages={conversationMessages}
            onScrollToIndex={handleMarkerScrollToIndex}
          />
        )}
        {/* Fade overlay at bottom of messages */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-chat-background to-transparent pointer-events-none z-10" />
      </div>

      {/* Chat Input with floating scroll button */}
      <div className="shrink-0 relative">
        {/* Scroll to bottom button - floating */}
        <div className={cn(
          "absolute -top-7 right-4 z-10 transition-opacity duration-200",
          showScrollButton ? "opacity-100" : "opacity-0 pointer-events-none"
        )}>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 gap-1 pl-1 pr-2 text-xs rounded-full border border-border/50 bg-background/30 backdrop-blur-sm text-muted-foreground/70 hover:text-muted-foreground hover:bg-background/50 transition-colors"
            onClick={forceScrollToBottom}
          >
            <ChevronDown className="h-3 w-3" />
            Scroll to bottom
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- Local sub-components (moved from ConversationArea) ---

const QUICK_ACTIONS = [
  { icon: Bug, label: 'Fix a bug', prompt: 'Fix a bug: ' },
  { icon: TestTube2, label: 'Write tests', prompt: 'Write tests for ' },
  { icon: Sparkles, label: 'Add a feature', prompt: 'Add a feature: ' },
  { icon: Eye, label: 'Review code', prompt: 'Review the code in ' },
  { icon: RefreshCw, label: 'Refactor', prompt: 'Refactor ' },
  { icon: FileText, label: 'Documentation', prompt: 'Write documentation for ' },
];

function SessionHomeState({ sessionName }: { sessionName?: string }) {
  const handleTemplateClick = useCallback((prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('session-home-template-selected', { detail: { text: prompt } }),
    );
  }, []);

  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="max-w-md mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 text-brand text-sm font-medium mb-6 animate-scale-in">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display mb-2">
          What would you like to work on?
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          Type below to start, or pick a quick action
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {QUICK_ACTIONS.map(({ icon: Icon, label, prompt }) => (
            <button
              key={label}
              type="button"
              onClick={() => handleTemplateClick(prompt)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer text-left"
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConversationEmptyState({ sessionName }: { sessionName?: string }) {
  return (
    <div className="pt-3 pl-5 pr-12 pb-10 animate-fade-in">
      <div className="max-w-lg mx-auto text-center">
        {sessionName && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand/10 text-brand text-sm font-medium mb-6 animate-scale-in">
            <GitBranch className="w-4 h-4" />
            {sessionName}
          </div>
        )}
        <h2 className="font-display text-[1.375rem] leading-[1.25] tracking-display mb-2">New Session</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Describe your task below. An AI agent will work on it in an isolated git branch.
        </p>
        <div className="text-left bg-background rounded-lg p-4 space-y-3 border border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Example tasks</p>
          <div className="space-y-2 text-sm stagger-children">
            <p className="text-muted-foreground">&quot;Add user authentication with JWT tokens&quot;</p>
            <p className="text-muted-foreground">&quot;Write unit tests for the payment service&quot;</p>
            <p className="text-muted-foreground">&quot;Refactor the API to use async/await&quot;</p>
          </div>
        </div>
      </div>
    </div>
  );
}
