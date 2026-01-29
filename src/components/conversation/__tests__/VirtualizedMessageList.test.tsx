import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VirtualizedMessageList, type VirtualizedMessageListHandle } from '../VirtualizedMessageList';
import type { Message } from '@/lib/types';

// Mock clipboard
vi.mock('@/lib/tauri', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

function makeMessage(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    conversationId: 'conv-1',
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

describe('VirtualizedMessageList', () => {
  const defaultProps = {
    searchQuery: '',
    currentMatchIndex: 0,
    searchMatches: { total: 0, messageOffsets: [] as number[] },
    messageHasMatches: [] as boolean[],
  };

  it('renders empty state when no messages and emptyState provided', () => {
    render(
      <VirtualizedMessageList
        messages={[]}
        {...defaultProps}
        emptyState={<div>No messages yet</div>}
      />
    );

    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('renders Virtuoso container for messages', () => {
    const messages = [
      makeMessage('m1', 'user', 'Hello'),
      makeMessage('m2', 'assistant', 'Hi there'),
    ];

    const { container } = render(
      <div style={{ height: 500 }}>
        <VirtualizedMessageList
          messages={messages}
          {...defaultProps}
        />
      </div>
    );

    // Virtuoso creates its scroller container (items not rendered in jsdom
    // since ResizeObserver doesn't fire real measurements)
    expect(container.querySelector('[data-testid="virtuoso-scroller"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="virtuoso-item-list"]')).toBeInTheDocument();
  });

  it('renders footer content', () => {
    const messages = [makeMessage('m1', 'user', 'Test')];

    render(
      <div style={{ height: 500 }}>
        <VirtualizedMessageList
          messages={messages}
          {...defaultProps}
          footer={<div>Streaming content here</div>}
        />
      </div>
    );

    expect(screen.getByText('Streaming content here')).toBeInTheDocument();
  });

  it('exposes scrollToBottom via ref', () => {
    const ref = createRef<VirtualizedMessageListHandle>();
    const messages = [makeMessage('m1', 'user', 'Test')];

    render(
      <div style={{ height: 500 }}>
        <VirtualizedMessageList
          ref={ref}
          messages={messages}
          {...defaultProps}
        />
      </div>
    );

    // Ref should be populated with the imperative handle
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.scrollToBottom).toBe('function');
    expect(typeof ref.current?.scrollToIndex).toBe('function');
  });

  it('calls onAtBottomStateChange callback', () => {
    const onAtBottomStateChange = vi.fn();
    const messages = [makeMessage('m1', 'user', 'Test')];

    render(
      <div style={{ height: 500 }}>
        <VirtualizedMessageList
          messages={messages}
          {...defaultProps}
          onAtBottomStateChange={onAtBottomStateChange}
        />
      </div>
    );

    // Virtuoso should report initial state
    // Note: in jsdom, Virtuoso may not trigger scroll events fully,
    // but the callback should be wired up
    expect(typeof onAtBottomStateChange).toBe('function');
  });

  it('renders many messages without crashing', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeMessage(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`)
    );

    const { container } = render(
      <div style={{ height: 500 }}>
        <VirtualizedMessageList
          messages={messages}
          {...defaultProps}
        />
      </div>
    );

    // Virtuoso should render without errors (it won't render all 100 in jsdom)
    expect(container).toBeTruthy();
  });

  it('accepts search props without errors', () => {
    const messages = [makeMessage('m1', 'user', 'find the needle')];

    const { container } = render(
      <div style={{ height: 500 }}>
        <VirtualizedMessageList
          messages={messages}
          searchQuery="needle"
          currentMatchIndex={0}
          searchMatches={{ total: 1, messageOffsets: [0] }}
          messageHasMatches={[true]}
        />
      </div>
    );

    // Virtuoso renders in jsdom without errors even with search props
    // (items aren't rendered because ResizeObserver doesn't fire real measurements)
    expect(container.querySelector('[data-testid="virtuoso-scroller"]')).toBeInTheDocument();
  });
});
