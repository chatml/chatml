'use client';

import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle, type ListRange } from 'react-virtuoso';
import { MessageBlock } from '@/components/conversation/MessageBlock';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { CardErrorFallback } from '@/components/shared/ErrorFallbacks';
import type { Message } from '@/lib/types';

// Large initial index to allow prepending items without going negative
const INITIAL_FIRST_ITEM_INDEX = 100_000;

export interface VirtualizedMessageListHandle {
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end'; behavior?: 'smooth' | 'auto' }) => void;
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
  getScrollerElement: () => HTMLElement | null;
}

interface VirtualizedMessageListProps {
  messages: readonly Message[];
  worktreePath?: string;
  searchQuery: string;
  currentMatchIndex: number;
  searchMatches: { total: number; messageOffsets: number[] };
  messageHasMatches: boolean[];
  footer?: React.ReactNode;
  emptyState?: React.ReactNode;
  onAtBottomStateChange?: (atBottom: boolean) => void;
  onStartReached?: () => void;
  firstItemIndex?: number;
  isLoadingOlder?: boolean;
  /** When true, use instant scroll for followOutput to prevent bounce during streaming */
  isStreaming?: boolean;
  /** Initial scroll position — index-based, avoids flash. Defaults to bottom. */
  initialTopMostItemIndex?: number | { index: number | 'LAST'; align?: 'start' | 'center' | 'end' };
  /** Called when the visible range changes — use to track scroll position for persistence */
  onRangeChanged?: (range: ListRange) => void;
  /** When true, suppress followOutput to prevent auto-scroll-to-bottom from fighting plan scroll */
  pendingPlanApproval?: boolean;
  /** Callbacks for message editing, regeneration, and forking */
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
}

export const VirtualizedMessageList = forwardRef<VirtualizedMessageListHandle, VirtualizedMessageListProps>(
  function VirtualizedMessageList(
    {
      messages,
      worktreePath,
      searchQuery,
      currentMatchIndex,
      searchMatches,
      messageHasMatches,
      footer,
      emptyState,
      onAtBottomStateChange,
      onStartReached,
      firstItemIndex,
      isLoadingOlder,
      isStreaming,
      initialTopMostItemIndex,
      onRangeChanged,
      pendingPlanApproval,
      onEditMessage,
      onRegenerateMessage,
      onForkMessage,
    },
    ref
  ) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerElRef = useRef<HTMLElement | null>(null);

    const scrollerRefCallback = useCallback((el: HTMLElement | Window | null) => {
      scrollerElRef.current = el instanceof HTMLElement ? el : null;
    }, []);

    useImperativeHandle(ref, () => ({
      scrollToIndex(index, options) {
        virtuosoRef.current?.scrollToIndex({
          index,
          align: options?.align ?? 'center',
          behavior: options?.behavior ?? 'smooth',
        });
      },
      scrollToBottom(behavior = 'smooth') {
        virtuosoRef.current?.scrollToIndex({
          index: 'LAST',
          align: 'end',
          behavior,
        });
      },
      getScrollerElement() {
        return scrollerElRef.current;
      },
    }));

    // Precompute last user/assistant message indices for edit/regenerate/fork buttons
    const { lastUserIdx, lastAssistantIdx } = useMemo(() => {
      let lastU = -1;
      let lastA = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (lastU === -1 && messages[i].role === 'user') lastU = i;
        if (lastA === -1 && messages[i].role === 'assistant') lastA = i;
        if (lastU !== -1 && lastA !== -1) break;
      }
      return { lastUserIdx: lastU, lastAssistantIdx: lastA };
    }, [messages]);

    const itemContent = useCallback(
      (index: number, message: Message) => (
        <div className="pl-5 pr-12">
          <ErrorBoundary
            section="Message"
            fallback={<CardErrorFallback message="Error rendering message" />}
          >
            <MessageBlock
              message={message}
              isFirst={index === 0}
              worktreePath={worktreePath}
              searchQuery={searchQuery}
              currentMatchIndex={currentMatchIndex}
              matchOffset={searchMatches.messageOffsets[index] ?? 0}
              hasMatches={messageHasMatches[index] ?? false}
              onEdit={onEditMessage}
              onRegenerate={onRegenerateMessage}
              onFork={onForkMessage}
              isLastUserMessage={index === lastUserIdx}
              isLastAssistantMessage={index === lastAssistantIdx}
              isStreaming={isStreaming}
            />
          </ErrorBoundary>
        </div>
      ),
      [worktreePath, searchQuery, currentMatchIndex, searchMatches.messageOffsets, messageHasMatches, onEditMessage, onRegenerateMessage, onForkMessage, lastUserIdx, lastAssistantIdx, isStreaming]
    );

    // Determine follow output behavior: auto-scroll when at bottom.
    // During streaming, use instant scroll to prevent bounce caused by
    // smooth scrolling + rapid dynamic height changes (react-virtuoso #317).
    // When plan approval is pending, suppress auto-scroll so it doesn't fight
    // the plan-top scroll position.
    const followOutput = useCallback(
      (isAtBottom: boolean) => {
        if (pendingPlanApproval) return false as const;
        if (isAtBottom) return isStreaming ? true as const : 'smooth' as const;
        return false as const;
      },
      [isStreaming, pendingPlanApproval]
    );

    // Footer component: streaming message + padding
    const FooterComponent = useMemo(() => {
      if (!footer) return undefined;
      return function VirtuosoFooter() {
        return <>{footer}</>;
      };
    }, [footer]);

    // Header component: loading indicator or padding
    const HeaderComponent = useMemo(() => {
      if (isLoadingOlder) {
        return function VirtuosoHeader() {
          return (
            <div className="flex items-center justify-center py-4 text-xs text-zinc-500">
              <div className="h-3 w-3 animate-spin rounded-full border border-zinc-600 border-t-transparent mr-2" />
              Loading older messages…
            </div>
          );
        };
      }
      return function VirtuosoHeader() {
        return <div className="pt-3" />;
      };
    }, [isLoadingOlder]);

    // Empty state when no messages
    if (messages.length === 0 && emptyState) {
      return (
        <div className="h-full overflow-auto">
          <div className="pt-3 pl-5 pr-12 pb-10">
            {emptyState}
          </div>
        </div>
      );
    }

    // Default to bottom if no initial position provided
    const resolvedInitialIndex = initialTopMostItemIndex ?? { index: 'LAST' as const, align: 'end' as const };

    return (
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={scrollerRefCallback}
        data={messages}
        firstItemIndex={firstItemIndex ?? INITIAL_FIRST_ITEM_INDEX}
        initialTopMostItemIndex={resolvedInitialIndex}
        computeItemKey={(index, message) => message.id}
        itemContent={itemContent}
        followOutput={followOutput}
        alignToBottom
        startReached={onStartReached}
        rangeChanged={onRangeChanged}
        increaseViewportBy={{ top: 2000, bottom: 2000 }}
        atBottomStateChange={onAtBottomStateChange}
        atBottomThreshold={50}
        className="h-full"
        style={{ overflowX: 'hidden' }}
        components={{
          Header: HeaderComponent,
          ...(FooterComponent ? { Footer: FooterComponent } : {}),
        }}
      />
    );
  }
);
