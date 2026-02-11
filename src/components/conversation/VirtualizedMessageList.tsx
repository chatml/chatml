'use client';

import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MessageBlock } from '@/components/conversation/MessageBlock';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { CardErrorFallback } from '@/components/shared/ErrorFallbacks';
import type { Message } from '@/lib/types';

// Large initial index to allow prepending items without going negative
const INITIAL_FIRST_ITEM_INDEX = 100_000;

export interface VirtualizedMessageListHandle {
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end'; behavior?: 'smooth' | 'auto' }) => void;
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
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
    },
    ref
  ) {
    const virtuosoRef = useRef<VirtuosoHandle>(null);

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
    }));

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
            />
          </ErrorBoundary>
        </div>
      ),
      [worktreePath, searchQuery, currentMatchIndex, searchMatches.messageOffsets, messageHasMatches]
    );

    // Determine follow output behavior: auto-scroll when at bottom
    const followOutput = useCallback(
      (isAtBottom: boolean) => {
        if (isAtBottom) return 'smooth' as const;
        return false as const;
      },
      []
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

    return (
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        firstItemIndex={firstItemIndex ?? INITIAL_FIRST_ITEM_INDEX}
        itemContent={itemContent}
        followOutput={followOutput}
        alignToBottom
        startReached={onStartReached}
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
