'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { useAppStore, type QueuedMessage } from '@/stores/appStore';
import {
  useMessages,
  useMessagePagination,
  useMessagesLoading,
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

/** Remove a cached scroll position (call when a conversation is deleted). */
export function clearScrollPosition(conversationId: string) {
  scrollPositions.delete(conversationId);
}

// Wrapper that defers messages to ConversationMarkers so marker extraction
// doesn't block higher-priority streaming or message rendering.
function DeferredConversationMarkers({ messages, onScrollToIndex }: {
  messages: readonly Message[];
  onScrollToIndex: (index: number) => void;
}) {
  const deferredMessages = useDeferredValue(messages);
  return <ConversationMarkers messages={deferredMessages} onScrollToIndex={onScrollToIndex} />;
}

// Always mount StreamingMessage so Virtuoso's footer height stays stable across
// pane activation cycles. The parent CachedConversationPane already applies
// `invisible` when inactive, so no extra visibility toggle is needed here.
// Returning null previously caused Virtuoso measurement race conditions when the
// pane reactivated (footer component reference changed → internal reset).
function StreamingMessageGate({
  conversationId,
  worktreePath,
}: {
  conversationId: string;
  worktreePath?: string;
}) {
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
  const isLoadingInitial = useMessagesLoading(conversationId);
  const setMessagePage = useAppStore((s) => s.setMessagePage);
  const setMessagesLoading = useAppStore((s) => s.setMessagesLoading);
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

  // Coarse boolean so scroll-restore effects only re-fire on the 0→N
  // transition rather than on every streaming message.
  const hasMessages = conversationMessages.length > 0;

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

    // Clear stale scroll position — the virtual index space will change
    // after a fresh page load, so any saved dataIndex is invalid.
    scrollPositions.delete(conversationId);

    setMessagesLoading(conversationId, true);

    let cancelled = false;
    async function loadMessages() {
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const page = await getConversationMessages(conversationId!, { limit: 50, compact: true });
          if (cancelled) return;
          const messages = page.messages.map((m) => toStoreMessage(m, conversationId!, { compacted: true }));
          // setMessagePage also clears messagesLoading for this conversation
          setMessagePage(conversationId!, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
          return;
        } catch (error) {
          if (cancelled) return;
          console.error(`Failed to load conversation messages (attempt ${attempt + 1}/${MAX_RETRIES}):`, error);
          if (attempt < MAX_RETRIES - 1) {
            // Exponential backoff with jitter to avoid thundering herd
            const base = 1000 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, base * (0.5 + Math.random() * 0.5)));
            if (cancelled) return;
          }
        }
      }
      // All retries exhausted — clear loading so empty state renders
      if (!cancelled) setMessagesLoading(conversationId!, false);
    }
    loadMessages();
    return () => {
      cancelled = true;
      // Clear loading flag so a stale `true` doesn't persist if the effect
      // is cancelled (e.g. rapid conversation switches) before load completes.
      setMessagesLoading(conversationId!, false);
    };
  }, [conversationId, setMessagePage, setMessagesLoading]);

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
  // Tracks explicit user intent to scroll up (wheel, touch, keyboard).
  // Coupled with forceFollowRef: any code that sets forceFollowRef=true
  // must also clear userScrolledUpRef, otherwise the ResizeObserver guard
  // will still suppress auto-scroll. Use resetFollowState() to do both.
  const userScrolledUpRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const prevIsActiveRef = useRef(isActive);
  // Deferred scroll restoration: when the pane reactivates but messages
  // haven't loaded yet, store the intent here and execute once data arrives.
  const pendingScrollRestoreRef = useRef<string | null>(null);

  // Paint gate: two complementary mechanisms prevent flash-at-top on switch:
  //  1. Paint gate (below): covers the *sync* case — switching between
  //     conversations that already have cached messages. Hides the frame
  //     where Virtuoso measures items before applying initialTopMostItemIndex.
  //  2. Empty guard in VirtualizedMessageList: covers the *async* case —
  //     messages arrive after the switch. Virtuoso doesn't mount until data
  //     exists, so initialTopMostItemIndex is consumed on the first mount.
  const [paintReady, setPaintReady] = useState(true);
  const paintGateConvRef = useRef(conversationId);

  useLayoutEffect(() => {
    if (paintGateConvRef.current !== conversationId && hasMessages) {
      setPaintReady(false);
    }
    paintGateConvRef.current = conversationId;
  }, [conversationId, hasMessages]);

  // Double-rAF matches scheduleScrollRestore — Virtuoso needs the post-paint
  // frame to finish measuring items and applying initialTopMostItemIndex.
  useEffect(() => {
    if (!paintReady) {
      let inner: number;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          setPaintReady(true);
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
  }, [paintReady]);

  /** Reset all follow-state refs atomically. Call when the user submits a
   *  message, clicks "scroll to bottom", or switches conversations. */
  const resetFollowState = useCallback(() => {
    forceFollowRef.current = false;
    userScrolledUpRef.current = false;
  }, []);
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Schedule a double-rAF scroll restore for the given conversation.
  // Double-rAF: first fires before paint, second fires after — Virtuoso needs
  // the post-paint frame to finish measuring items.
  // `messageCount` is captured eagerly by the caller so we don't read a stale
  // closure inside the async rAF callback.
  const scheduleScrollRestore = useCallback((
    targetId: string,
    currentFirstItemIndex: number,
    messageCount: number,
  ): (() => void) => {
    let innerHandle: number;
    const outerHandle = requestAnimationFrame(() => {
      innerHandle = requestAnimationFrame(() => {
        if ((conversationId ?? '') !== targetId) return;
        const saved = scrollPositions.get(targetId);
        if (!saved || saved.wasAtBottom) {
          messageListRef.current?.scrollToBottom('auto');
        } else {
          const lastIndex = currentFirstItemIndex + messageCount - 1;
          if (saved.dataIndex >= currentFirstItemIndex && saved.dataIndex <= lastIndex) {
            messageListRef.current?.scrollToIndex(saved.dataIndex, { align: 'start' });
          } else {
            messageListRef.current?.scrollToBottom('auto');
          }
        }
      });
    });
    return () => {
      cancelAnimationFrame(outerHandle);
      cancelAnimationFrame(innerHandle);
    };
  }, [conversationId]);

  // When the pane becomes active, handle scroll positioning.
  // If messages are already loaded, initialTopMostItemIndex on the freshly-
  // mounted Virtuoso (key={conversationId}) handles positioning — no extra
  // scroll call needed. If messages haven't loaded yet (e.g. evicted while
  // inactive), defer to the separate effect below that fires once data arrives.
  useEffect(() => {
    if (isActive && !prevIsActiveRef.current) {
      const targetId = conversationId ?? '';

      if (!hasMessages) {
        // Defer scroll restoration until messages load.
        pendingScrollRestoreRef.current = targetId;
        prevIsActiveRef.current = isActive;
        return;
      }

      // Messages already loaded — Virtuoso remounts with initialTopMostItemIndex
      // so no scheduleScrollRestore needed. Just clear any stale pending ref.
      pendingScrollRestoreRef.current = null;
    }
    prevIsActiveRef.current = isActive;
  }, [isActive, conversationId, hasMessages]);

  // Deferred scroll restoration: execute once messages arrive after a pane
  // was reactivated with no messages (e.g. after eviction or LRU cache miss).
  // This effect is the counterpart to the early-return branch above: when the
  // activation effect defers (sets pendingScrollRestoreRef), this effect fires
  // once hasMessages flips true and performs the actual scroll restore.
  //
  // When the saved position is "at bottom" (or absent), initialTopMostItemIndex
  // on the freshly-mounted Virtuoso already handles it — skip the extra scroll.
  // Only use scheduleScrollRestore for non-bottom saved positions.
  useEffect(() => {
    const targetId = pendingScrollRestoreRef.current;
    if (!targetId || !isActive || !hasMessages) return;
    if ((conversationId ?? '') !== targetId) {
      pendingScrollRestoreRef.current = null;
      return;
    }

    pendingScrollRestoreRef.current = null;

    const saved = scrollPositions.get(targetId);
    if (!saved || saved.wasAtBottom) {
      // initialTopMostItemIndex: 'LAST' handles bottom positioning on mount
      return;
    }

    return scheduleScrollRestore(targetId, firstItemIndex, conversationMessages.length);
  }, [isActive, conversationId, hasMessages, firstItemIndex, conversationMessages.length, scheduleScrollRestore]);

  // Continuously track the visible range
  const handleRangeChanged = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (!conversationId) return;
    scrollPositions.set(conversationId, {
      dataIndex: range.startIndex,
      wasAtBottom: isAtBottomRef.current,
    });
  }, [conversationId]);

  // Clear follow state on conversation switch
  useEffect(() => {
    resetFollowState();
  }, [conversationId, resetFollowState]);

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
    if (atBottom) resetFollowState();
    // Only update scroll-button state for the active pane to avoid
    // unnecessary re-renders on hidden Virtuoso instances.
    if (isActiveRef.current) setShowScrollButton(!atBottom);
  }, [resetFollowState]);

  const forceScrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    resetFollowState();
    messageListRef.current?.scrollToBottom('auto');
  }, [resetFollowState]);

  // Footer for VirtualizedMessageList
  const messageListFooter = useMemo(() => {
    if (!conversationId) return undefined;
    return (
      <div className="pl-5 pr-12 pb-16">
        <StreamingMessageGate
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
  }, [conversationId, queuedMessages, removeQueuedMessage, worktreePath]);

  // Listen for message submit events to force scroll to bottom.
  // Only the active pane registers the listener to avoid redundant work.
  useEffect(() => {
    if (!isActive) return;
    const handleMessageSubmit = () => {
      forceFollowRef.current = true;
      userScrolledUpRef.current = false; // redundant with forceScrollToBottom but explicit
      forceScrollToBottom();
    };

    window.addEventListener('chat-message-submitted', handleMessageSubmit);
    return () => {
      window.removeEventListener('chat-message-submitted', handleMessageSubmit);
    };
  }, [isActive, forceScrollToBottom]);

  // Pin scroll to bottom when content height changes during streaming.
  // Virtuoso's followOutput only fires on data item changes, not when the
  // footer grows (streaming content lives in the footer). The ResizeObserver
  // is the primary auto-scroll mechanism during streaming.
  //
  // Guard uses userScrolledUpRef (explicit user intent) instead of
  // isAtBottomRef (physical position) to avoid a race condition where rapid
  // content growth outpaces RAF-batched scrolls, causing isAtBottom to flip
  // false and permanently killing auto-scroll.
  useEffect(() => {
    if (!selectedStreaming.isStreaming || !isActive) return;

    const scrollerEl = messageListRef.current?.getScrollerElement();
    if (!scrollerEl) return;
    const contentEl = scrollerEl.firstElementChild;
    if (!contentEl) return;

    // Only reset on streaming start when the user just submitted a message
    // (forceFollowRef is set by handleMessageSubmit). During agent
    // auto-continuation the user may have intentionally scrolled up to read
    // earlier context — don't override that intent.
    if (forceFollowRef.current) {
      userScrolledUpRef.current = false;
    }

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (userScrolledUpRef.current) return;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        scrollerEl.scrollTop = scrollerEl.scrollHeight - scrollerEl.clientHeight;
        rafId = null;
      });
    });

    observer.observe(contentEl);

    // Detect explicit user scroll-up via wheel, touch, and keyboard events.
    // Small thresholds filter out trackpad inertia jitter and imprecise touches.
    const WHEEL_THRESHOLD = -3; // px — ignore sub-pixel trackpad noise
    const TOUCH_THRESHOLD = 5;  // px — ignore accidental finger drift

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < WHEEL_THRESHOLD) userScrolledUpRef.current = true;
    };
    let lastTouchY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0;
      if (currentY - lastTouchY > TOUCH_THRESHOLD) userScrolledUpRef.current = true;
      lastTouchY = currentY;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') {
        userScrolledUpRef.current = true;
      }
    };

    scrollerEl.addEventListener('wheel', handleWheel, { passive: true });
    scrollerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollerEl.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollerEl.addEventListener('keydown', handleKeyDown);

    return () => {
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      scrollerEl.removeEventListener('wheel', handleWheel);
      scrollerEl.removeEventListener('touchstart', handleTouchStart);
      scrollerEl.removeEventListener('touchmove', handleTouchMove);
      scrollerEl.removeEventListener('keydown', handleKeyDown);
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
    <div className={cn(
      'flex flex-col absolute inset-0',
      isActive ? 'z-10' : 'invisible pointer-events-none z-0'
    )}>
      {/* Messages — opacity gate hides the single frame where Virtuoso measures
           items before applying initialTopMostItemIndex */}
      <div className="relative flex-1 min-h-0" style={{ opacity: paintReady ? 1 : 0 }}>
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
            (!conversationId || (conversationMessages.length === 0 && !isLoadingInitial)) ? (
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
