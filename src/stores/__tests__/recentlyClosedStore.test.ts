import { describe, it, expect, beforeEach } from 'vitest';
import { useRecentlyClosedStore, type ClosedConversation } from '../recentlyClosedStore';

function makeConv(overrides: Partial<ClosedConversation> = {}): ClosedConversation {
  return {
    id: 'conv-1',
    sessionId: 'session-1',
    workspaceId: 'ws-1',
    name: 'Test conversation',
    type: 'task',
    closedAt: Date.now(),
    messageCount: 5,
    ...overrides,
  };
}

beforeEach(() => {
  useRecentlyClosedStore.setState({ closedConversations: [] });
});

// ============================================================================
// addClosedConversation
// ============================================================================

describe('addClosedConversation', () => {
  it('adds a conversation to the front of the list', () => {
    const conv = makeConv();
    useRecentlyClosedStore.getState().addClosedConversation(conv);
    const state = useRecentlyClosedStore.getState();
    expect(state.closedConversations).toHaveLength(1);
    expect(state.closedConversations[0]).toEqual(conv);
  });

  it('prepends new conversations', () => {
    const conv1 = makeConv({ id: 'c1' });
    const conv2 = makeConv({ id: 'c2' });
    useRecentlyClosedStore.getState().addClosedConversation(conv1);
    useRecentlyClosedStore.getState().addClosedConversation(conv2);
    const ids = useRecentlyClosedStore.getState().closedConversations.map((c) => c.id);
    expect(ids).toEqual(['c2', 'c1']);
  });

  it('deduplicates by id (removes existing before prepending)', () => {
    const conv = makeConv({ id: 'c1', name: 'original' });
    useRecentlyClosedStore.getState().addClosedConversation(conv);

    const updated = makeConv({ id: 'c1', name: 'updated' });
    useRecentlyClosedStore.getState().addClosedConversation(updated);

    const state = useRecentlyClosedStore.getState();
    expect(state.closedConversations).toHaveLength(1);
    expect(state.closedConversations[0].name).toBe('updated');
  });

  it('evicts oldest per-session entry when exceeding cap (10)', () => {
    // Add 10 conversations for the same session
    for (let i = 0; i < 10; i++) {
      useRecentlyClosedStore.getState().addClosedConversation(
        makeConv({ id: `c${i}`, sessionId: 'session-1' }),
      );
    }
    expect(useRecentlyClosedStore.getState().closedConversations).toHaveLength(10);

    // Add 11th — should evict the oldest for session-1
    useRecentlyClosedStore.getState().addClosedConversation(
      makeConv({ id: 'c10', sessionId: 'session-1' }),
    );
    const state = useRecentlyClosedStore.getState();
    expect(state.closedConversations).toHaveLength(10);
    // c0 was the first added, now the oldest for session-1
    expect(state.closedConversations.find((c) => c.id === 'c0')).toBeUndefined();
    expect(state.closedConversations[0].id).toBe('c10');
  });

  it('does not evict from other sessions', () => {
    for (let i = 0; i < 10; i++) {
      useRecentlyClosedStore.getState().addClosedConversation(
        makeConv({ id: `s1-c${i}`, sessionId: 'session-1' }),
      );
    }
    useRecentlyClosedStore.getState().addClosedConversation(
      makeConv({ id: 's2-c0', sessionId: 'session-2' }),
    );
    // Adding 11th for session-1
    useRecentlyClosedStore.getState().addClosedConversation(
      makeConv({ id: 's1-c10', sessionId: 'session-1' }),
    );
    // session-2's conversation should still exist
    expect(
      useRecentlyClosedStore.getState().closedConversations.find((c) => c.id === 's2-c0'),
    ).toBeDefined();
  });
});

// ============================================================================
// removeClosedConversation
// ============================================================================

describe('removeClosedConversation', () => {
  it('removes a conversation by id', () => {
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c1' }));
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c2' }));
    useRecentlyClosedStore.getState().removeClosedConversation('c1');
    const ids = useRecentlyClosedStore.getState().closedConversations.map((c) => c.id);
    expect(ids).toEqual(['c2']);
  });

  it('no-op if id does not exist', () => {
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c1' }));
    useRecentlyClosedStore.getState().removeClosedConversation('nonexistent');
    expect(useRecentlyClosedStore.getState().closedConversations).toHaveLength(1);
  });
});

// ============================================================================
// clearForSession
// ============================================================================

describe('clearForSession', () => {
  it('removes all conversations for a specific session', () => {
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c1', sessionId: 's1' }));
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c2', sessionId: 's1' }));
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c3', sessionId: 's2' }));
    useRecentlyClosedStore.getState().clearForSession('s1');
    const ids = useRecentlyClosedStore.getState().closedConversations.map((c) => c.id);
    expect(ids).toEqual(['c3']);
  });
});

// ============================================================================
// getClosedForSession
// ============================================================================

describe('getClosedForSession', () => {
  it('returns conversations filtered by session', () => {
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c1', sessionId: 's1' }));
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c2', sessionId: 's2' }));
    useRecentlyClosedStore.getState().addClosedConversation(makeConv({ id: 'c3', sessionId: 's1' }));
    const result = useRecentlyClosedStore.getState().getClosedForSession('s1');
    expect(result.map((c) => c.id)).toEqual(['c3', 'c1']);
  });

  it('returns empty array for session with no closed conversations', () => {
    const result = useRecentlyClosedStore.getState().getClosedForSession('nonexistent');
    expect(result).toEqual([]);
  });
});
