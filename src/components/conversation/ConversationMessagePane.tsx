'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
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
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { StreamingMessage } from '@/components/conversation/StreamingMessage';
import { OllamaProgressBlock } from '@/components/conversation/OllamaProgressBlock';
import { QueuedMessageBubble } from '@/components/conversation/QueuedMessageBubble';
import { VirtualizedMessageList, type VirtualizedMessageListHandle } from '@/components/conversation/VirtualizedMessageList';
import { ChatSearchBar, countSearchMatches } from '@/components/conversation/ChatSearchBar';
import { useShortcut } from '@/hooks/useShortcut';
import { getConversationMessages, toStoreMessage } from '@/lib/api';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';

// Stable empty array to avoid re-renders from selector
const EMPTY_QUEUED_MESSAGES: readonly QueuedMessage[] = [];

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
// pane activation cycles. Returning null previously caused Virtuoso measurement
// race conditions when the pane reactivated.
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

interface ConversationMessagePaneProps {
  conversationId: string;
  /** True only when the parent session is active AND this is the selected conversation. */
  isActive: boolean;
  worktreePath?: string;
  /** Empty state to show when the conversation has no messages and isn't loading. */
  emptyState?: React.ReactNode;
}

export function ConversationMessagePane({
  conversationId,
  isActive,
  worktreePath,
  emptyState,
}: ConversationMessagePaneProps) {
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
    (s) => s.queuedMessages[conversationId] ?? EMPTY_QUEUED_MESSAGES
  );
  const removeQueuedMessage = useAppStore((s) => s.removeQueuedMessage);

  // Only unsent queued messages stay in the footer — sent messages are rendered
  // inline in the StreamingMessage timeline at their chronological position.
  const unsentQueuedMessages = useMemo(
    () => queuedMessages.filter(m => !m.sent),
    [queuedMessages]
  );

  // Hide the setupInfo system card once the user has sent their first message.
  // Also filter out user messages embedded in an assistant's timeline — they
  // render inline within the assistant message, not as standalone rows.
  // The embeddedInTimeline flag is set in memory during streaming but is NOT
  // persisted to the DB. On reload, we reconstruct it by scanning assistant
  // timelines for user_message entries referencing standalone message IDs.
  const conversationMessages = useMemo(() => {
    // Build set of message IDs referenced by assistant timeline user_message entries.
    // This reconstructs the embeddedInTimeline flag for messages loaded from the DB.
    const embeddedIds = new Set<string>();
    for (const m of allConversationMessages) {
      if (m.role === 'assistant' && m.timeline) {
        for (const entry of m.timeline) {
          if (entry.type === 'user_message') {
            embeddedIds.add(entry.messageId);
          }
        }
      }
    }

    let msgs = allConversationMessages;
    if (hasUserMessages) {
      msgs = msgs.filter(m => !(m.role === 'system' && m.setupInfo));
    }
    // Filter using both the in-memory flag (streaming path) and the
    // reconstructed set (historical/reload path).
    msgs = msgs.filter(m => !m.embeddedInTimeline && !embeddedIds.has(m.id));
    return msgs;
  }, [allConversationMessages, hasUserMessages]);

  const hasMessages = conversationMessages.length > 0;

  // Load messages on-demand when conversation is mounted (paginated)
  useEffect(() => {
    const state = useAppStore.getState();
    const messageCount = state.messagesByConversation[conversationId]?.length ?? 0;
    const existingPagination = state.messagePagination[conversationId];

    if (existingPagination && messageCount > 0) return;
    if (messageCount > 0) return;

    setMessagesLoading(conversationId, true);

    const controller = new AbortController();
    async function loadMessages() {
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const page = await getConversationMessages(conversationId, { limit: 50, compact: true, signal: controller.signal });
          if (controller.signal.aborted) return;
          const messages = page.messages.map((m) => toStoreMessage(m, conversationId, { compacted: true }));
          setMessagePage(conversationId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          console.error(`Failed to load conversation messages (attempt ${attempt + 1}/${MAX_RETRIES}):`, error);
          if (attempt < MAX_RETRIES - 1) {
            const base = 1000 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, base * (0.5 + Math.random() * 0.5)));
            if (controller.signal.aborted) return;
          }
        }
      }
      if (!controller.signal.aborted) setMessagesLoading(conversationId, false);
    }
    loadMessages();
    return () => {
      controller.abort();
      setMessagesLoading(conversationId, false);
    };
  }, [conversationId, setMessagePage, setMessagesLoading]);

  // Chat search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const debouncedSearchQuery = useDeferredValue(searchQuery);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentMatchIndex(0);
  }, []);

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
    if (!pagination?.hasMore || pagination?.isLoadingMore) return;

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
  }, [searchMatches.total]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.total > 0) {
      setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.total) % searchMatches.total);
    }
  }, [searchMatches.total]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
  }, []);

  // Auto-scroll management via Virtuoso
  const messageListRef = useRef<VirtualizedMessageListHandle>(null);
  const [showScrollButton, setShowScrollButtonRaw] = useState(false);
  const showScrollButtonRef = useRef(false);
  // Wrapper that deduplicates state updates — avoids redundant React reconciliation
  // when scroll handlers fire 60+ times/sec with the same value.
  const setShowScrollButton = useCallback((show: boolean) => {
    if (showScrollButtonRef.current === show) return;
    showScrollButtonRef.current = show;
    setShowScrollButtonRaw(show);
  }, []);
  const isAtBottomRef = useRef(true);
  const forceFollowRef = useRef(false);
  const userScrolledUpRef = useRef(false);
  const isStreamingRef = useRef(selectedStreaming.isStreaming);
  const isActiveRef = useRef(isActive);
  const prevIsStreamingForScrollRef = useRef(false);

  /** Reset all follow-state refs atomically. */
  const resetFollowState = useCallback(() => {
    forceFollowRef.current = false;
    userScrolledUpRef.current = false;
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);
  useEffect(() => {
    isStreamingRef.current = selectedStreaming.isStreaming;
  }, [selectedStreaming.isStreaming]);

  // Scroll to latest messages when pane re-activates after being hidden.
  // The pane uses visibility:hidden (not display:none) while inactive, so
  // Virtuoso's ResizeObserver continues firing and its size cache stays warm.
  // A full remount is unnecessary — scrollToBottom is sufficient. We defer
  // to a rAF to ensure the browser has processed the visibility change.
  const prevIsActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (isActive && !wasActive && hasMessages) {
      resetFollowState();
      const rafId = requestAnimationFrame(() => {
        messageListRef.current?.scrollToBottom('auto');
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isActive, hasMessages, resetFollowState]);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    if (!isActiveRef.current) return;
    if (atBottom) resetFollowState();
    setShowScrollButton(!atBottom);
  }, [resetFollowState, setShowScrollButton]);

  const forceScrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    resetFollowState();
    messageListRef.current?.scrollToBottom('auto');
  }, [resetFollowState, setShowScrollButton]);

  // Footer for VirtualizedMessageList
  const messageListFooter = useMemo(() => (
    <div className="pl-5 pr-12 pb-16">
      <OllamaProgressBlock />
      <StreamingMessageGate
        conversationId={conversationId}
        worktreePath={worktreePath}
      />
      {unsentQueuedMessages.length > 0 && (
        <QueuedMessageBubble
          messages={unsentQueuedMessages}
          onDelete={(messageId) => {
            removeQueuedMessage(conversationId, messageId);
          }}
        />
      )}
    </div>
  ), [conversationId, unsentQueuedMessages, removeQueuedMessage, worktreePath]);

  // Listen for message submit events to force scroll to bottom.
  useEffect(() => {
    if (!isActive) return;
    const handleMessageSubmit = () => {
      forceFollowRef.current = true;
      userScrolledUpRef.current = false;
      forceScrollToBottom();
    };

    window.addEventListener('chat-message-submitted', handleMessageSubmit);
    return () => {
      window.removeEventListener('chat-message-submitted', handleMessageSubmit);
    };
  }, [isActive, forceScrollToBottom]);

  // Pin scroll to bottom when content height changes during streaming.
  useEffect(() => {
    if (!selectedStreaming.isStreaming || !isActive) return;

    const scrollerEl = messageListRef.current?.getScrollerElement();
    if (!scrollerEl) return;
    const contentEl = scrollerEl.firstElementChild;
    if (!contentEl) return;

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

    const WHEEL_THRESHOLD = -3;
    const TOUCH_THRESHOLD = 5;

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

  // Bridge the gap when streaming ends: the ResizeObserver above disconnects
  // exactly when the footer collapses (StreamingMessage → null), leaving
  // Virtuoso with stale measurements and content above the viewport.
  // Detect the true→false transition and force scroll-to-bottom.
  useEffect(() => {
    const wasStreaming = prevIsStreamingForScrollRef.current;
    prevIsStreamingForScrollRef.current = selectedStreaming.isStreaming;

    if (!wasStreaming || selectedStreaming.isStreaming) return;
    if (!isActive) return;
    if (userScrolledUpRef.current) return;

    // Two frames: frame 1 catches the footer collapse layout shift,
    // frame 2 catches Virtuoso's deferred measurement recalibration.
    let cancelled = false;
    const scroll = () => {
      if (cancelled || userScrolledUpRef.current) return;
      messageListRef.current?.scrollToBottom('auto');
      setShowScrollButton(false);
    };

    let raf2: number | undefined;
    const raf1 = requestAnimationFrame(() => {
      scroll();
      raf2 = requestAnimationFrame(scroll);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2 !== undefined) cancelAnimationFrame(raf2);
    };
  }, [selectedStreaming.isStreaming, isActive]);

  // Supplementary scroll listener: ensures the scroll-to-bottom pill shows
  // even when Virtuoso's atBottomStateChange doesn't fire on initial scroll
  // away from bottom (it requires a true→false transition cycle).
  // This listener is unidirectional — it only SHOWS the pill. Virtuoso's
  // atBottomStateChange remains the sole authority for hiding it.
  useEffect(() => {
    if (!isActive || !hasMessages) return;

    let scrollCleanup: (() => void) | null = null;
    let cancelled = false;
    let rafId = 0;

    // Wait for Virtuoso to mount and expose its scroller element using rAF
    // instead of polling with setInterval. Typically resolves in 1-2 frames.
    function tryAttach() {
      if (cancelled) return;
      const scrollerEl = messageListRef.current?.getScrollerElement();
      if (!scrollerEl) {
        rafId = requestAnimationFrame(tryAttach);
        return;
      }

      const handleScroll = () => {
        const threshold = isStreamingRef.current ? 200 : 50;
        const atBottom = scrollerEl.scrollHeight - scrollerEl.scrollTop - scrollerEl.clientHeight <= threshold;
        // Only override to show the pill; let Virtuoso handle the "returned to bottom" case.
        // setShowScrollButton wrapper deduplicates redundant updates automatically.
        if (!atBottom) {
          isAtBottomRef.current = false;
          setShowScrollButton(true);
        }
      };

      scrollerEl.addEventListener('scroll', handleScroll, { passive: true });
      // Check immediately in case we're already not at bottom
      handleScroll();

      scrollCleanup = () => {
        scrollerEl.removeEventListener('scroll', handleScroll);
      };
    }
    rafId = requestAnimationFrame(tryAttach);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      scrollCleanup?.();
    };
  }, [isActive, hasMessages, setShowScrollButton]);

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

  // Compute resolved empty state for VirtualizedMessageList
  const resolvedEmptyState = useMemo(() => {
    if (conversationMessages.length === 0 && !isLoadingInitial) {
      return emptyState;
    }
    return undefined;
  }, [conversationMessages.length, isLoadingInitial, emptyState]);

  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col',
        isActive ? 'z-10' : 'invisible pointer-events-none z-0'
      )}
    >
      {/* Chat Search Bar */}
      <ChatSearchBar
        isOpen={searchOpen}
        onClose={closeSearch}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        currentMatchIndex={clampedMatchIndex}
        totalMatches={searchMatches.total}
        onNextMatch={goToNextMatch}
        onPrevMatch={goToPrevMatch}
        partialResults={pagination?.hasMore}
        isSearchPending={searchQuery !== debouncedSearchQuery}
      />
      <VirtualizedMessageList
        ref={messageListRef}
        messages={conversationMessages}
        worktreePath={worktreePath}
        searchQuery={debouncedSearchQuery}
        currentMatchIndex={clampedMatchIndex}
        searchMatches={searchMatches}
        messageHasMatches={messageHasMatches}
        initialTopMostItemIndex={{ index: 'LAST' as const, align: 'end' as const }}
        onAtBottomStateChange={handleAtBottomStateChange}
        onStartReached={isActive && pagination?.hasMore ? handleStartReached : undefined}
        firstItemIndex={firstItemIndex}
        isLoadingOlder={pagination?.isLoadingMore}
        emptyState={resolvedEmptyState}
        footer={messageListFooter}
        isStreaming={selectedStreaming.isStreaming}
        pendingPlanApproval={isActive ? selectedStreaming.hasPendingPlanApproval : true}
        forceFollowRef={forceFollowRef}
      />
      {/* Conversation markers minimap */}
      {isActive && conversationMessages.length > 3 && (
        <DeferredConversationMarkers
          messages={conversationMessages}
          onScrollToIndex={handleMarkerScrollToIndex}
        />
      )}
      {/* Fade overlay at bottom of messages */}
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-chat-background to-transparent pointer-events-none z-10" />
      {/* Scroll to bottom button */}
      <div className={cn(
        "absolute bottom-2 right-4 z-20 transition-opacity duration-200",
        showScrollButton && isActive ? "opacity-100" : "opacity-0 pointer-events-none"
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
    </div>
  );
}
