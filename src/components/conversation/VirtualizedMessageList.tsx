'use client';

import { forwardRef, useCallback, useMemo, useRef, useImperativeHandle } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MessageBlock } from '@/components/conversation/MessageBlock';
import type { Message } from '@/lib/types';

export interface VirtualizedMessageListHandle {
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end'; behavior?: 'smooth' | 'auto' }) => void;
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
}

interface VirtualizedMessageListProps {
  messages: readonly Message[];
  searchQuery: string;
  currentMatchIndex: number;
  searchMatches: { total: number; messageOffsets: number[] };
  messageHasMatches: boolean[];
  footer?: React.ReactNode;
  emptyState?: React.ReactNode;
  onAtBottomStateChange?: (atBottom: boolean) => void;
}

export const VirtualizedMessageList = forwardRef<VirtualizedMessageListHandle, VirtualizedMessageListProps>(
  function VirtualizedMessageList(
    {
      messages,
      searchQuery,
      currentMatchIndex,
      searchMatches,
      messageHasMatches,
      footer,
      emptyState,
      onAtBottomStateChange,
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
          <MessageBlock
            message={message}
            isFirst={index === 0}
            searchQuery={searchQuery}
            currentMatchIndex={currentMatchIndex}
            matchOffset={searchMatches.messageOffsets[index] ?? 0}
            hasMatches={messageHasMatches[index] ?? false}
          />
        </div>
      ),
      [searchQuery, currentMatchIndex, searchMatches.messageOffsets, messageHasMatches]
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
        itemContent={itemContent}
        followOutput={followOutput}
        alignToBottom
        increaseViewportBy={{ top: 2000, bottom: 2000 }}
        atBottomStateChange={onAtBottomStateChange}
        atBottomThreshold={50}
        className="h-full"
        style={{ overflowX: 'hidden' }}
        components={{
          Header: () => <div className="pt-3" />,
          ...(FooterComponent ? { Footer: FooterComponent } : {}),
        }}
      />
    );
  }
);
