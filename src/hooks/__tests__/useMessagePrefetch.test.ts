import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAppStore } from '@/stores/appStore';
import type { Conversation, Message, WorktreeSession } from '@/lib/types';

// ---- Mocks ----

const mockGetConversationMessages = vi.fn();
const mockToStoreMessage = vi.fn();

vi.mock('@/lib/api', () => ({
  getConversationMessages: (...args: unknown[]) => mockGetConversationMessages(...args),
  toStoreMessage: (...args: unknown[]) => mockToStoreMessage(...args),
}));

// ---- Helpers ----

let nextMsgId = 1;

function makeSession(overrides: Partial<WorktreeSession> = {}): WorktreeSession {
  return {
    id: `session-${overrides.id ?? '1'}`,
    workspaceId: 'ws-1',
    name: 'test-session',
    branch: 'test-branch',
    worktreePath: '/tmp/test',
    status: 'active',
    priority: 0,
    taskStatus: 'in_progress',
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: `conv-${overrides.id ?? '1'}`,
    sessionId: 'session-1',
    type: 'task',
    name: 'Test Conversation',
    status: 'active',
    messages: [],
    toolSummary: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(conversationId: string, overrides: Partial<Message> = {}): Message {
  const id = `msg-${nextMsgId++}`;
  return {
    id,
    conversationId,
    role: 'user',
    content: 'hello',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makePageResponse(convId: string, count = 2) {
  const dtos = Array.from({ length: count }, (_, i) => ({
    id: `dto-${convId}-${i}`,
    role: 'user' as const,
    content: `Message ${i}`,
    timestamp: new Date().toISOString(),
  }));
  return {
    messages: dtos,
    hasMore: false,
    totalCount: count,
    oldestPosition: 0,
  };
}

function setupStore(overrides: Record<string, unknown> = {}) {
  useAppStore.setState({
    selectedConversationId: 'conv-initial',
    selectedWorkspaceId: 'ws-1',
    sessions: [makeSession()],
    conversations: [],
    messagesByConversation: {},
    messagePagination: {},
    ...overrides,
  });
}

/**
 * Timer constants matching the hook's internal timing.
 * Keep in sync with useMessagePrefetch.ts.
 */
const DRAIN_TICK_MS = 10;
const DEFAULT_DRAIN_ROUNDS = 30; // 30 × 10ms = 300ms — enough for idle callback + single batch
const MULTI_BATCH_DRAIN_ROUNDS = 50; // 50 × 10ms = 500ms — enough for multiple batches with yields

/**
 * Flush microtasks and pending timers in a loop until all are drained.
 * The hook chains promises with setTimeout/requestIdleCallback, so we need
 * to interleave timer advancement (to fire the setTimeout callbacks) with
 * microtask flushing (to resolve the promises they wrap).
 */
async function drainTimers(rounds = DEFAULT_DRAIN_ROUNDS) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRAIN_TICK_MS);
    });
  }
}

/**
 * Install a requestIdleCallback polyfill that delegates to setTimeout
 * so fake timers can control it.
 */
function installIdleCallbackPolyfill() {
  globalThis.requestIdleCallback = ((cb: IdleRequestCallback) => {
    return setTimeout(
      () => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
      0
    ) as unknown as number;
  }) as typeof globalThis.requestIdleCallback;

  globalThis.cancelIdleCallback = ((id: number) => {
    clearTimeout(id);
  }) as typeof globalThis.cancelIdleCallback;
}

// ---- Tests ----

describe('useMessagePrefetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    nextMsgId = 1;

    // Always install the polyfill. Tests that need to test the fallback path
    // will override it locally and restore afterward.
    installIdleCallbackPolyfill();

    // Default mock: return a simple page
    mockGetConversationMessages.mockImplementation((convId: string) =>
      Promise.resolve(makePageResponse(convId))
    );
    mockToStoreMessage.mockImplementation(
      (dto: { id: string; role: string; content: string; timestamp: string }, convId: string) => ({
        id: dto.id,
        conversationId: convId,
        role: dto.role,
        content: dto.content,
        timestamp: dto.timestamp,
      })
    );

    // Reset store
    useAppStore.setState({
      selectedConversationId: null,
      selectedWorkspaceId: null,
      sessions: [],
      conversations: [],
      messagesByConversation: {},
      messagePagination: {},
    });
  });

  afterEach(() => {
    // Ensure React component tree is torn down while polyfill is still installed
    cleanup();

    // Now safe to restore timers
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Dynamic import defers loading until mocks are established.
  // vi.resetModules() is intentionally NOT used here — it would break the
  // vi.mock() wiring. Module-level state is safe because each test renders
  // a fresh hook instance with its own refs/closures.
  async function importHook() {
    const mod = await import('../useMessagePrefetch');
    return mod.useMessagePrefetch;
  }

  // ── Enabled / disabled ────────────────────────────────────────────────

  it('does nothing when disabled', async () => {
    const useMessagePrefetch = await importHook();

    setupStore({
      conversations: [makeConversation({ id: 'conv-1' })],
    });

    renderHook(() => useMessagePrefetch(false));

    await drainTimers();

    expect(mockGetConversationMessages).not.toHaveBeenCalled();
  });

  it('re-enables prefetch when enabled changes from false to true', async () => {
    const useMessagePrefetch = await importHook();

    const conv1 = makeConversation({ id: 'conv-toggle', sessionId: 'session-1' });

    setupStore({
      selectedConversationId: null,
      conversations: [conv1],
      messagePagination: {},
    });

    const { rerender } = renderHook(
      ({ enabled }) => useMessagePrefetch(enabled),
      { initialProps: { enabled: false } }
    );

    await drainTimers();
    expect(mockGetConversationMessages).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await drainTimers();

    expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-toggle', { limit: 50, compact: true });
  });

  // ── Initial load polling ──────────────────────────────────────────────

  describe('initial load polling', () => {
    it('waits for initial conversation messages to load before prefetching', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-1', sessionId: 'session-1' });
      const convTarget = makeConversation({ id: 'conv-target', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: 'conv-1',
        conversations: [conv1, convTarget],
        messagePagination: {}, // conv-1 not yet loaded
      });

      renderHook(() => useMessagePrefetch(true));

      // Fire the requestIdleCallback (setTimeout 0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // The hook should be polling at 200ms waiting for initial conv pagination
      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      // Advance past one 200ms poll - still not loaded
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      // Now set the pagination for the initial conv (simulates ConversationArea loading it)
      useAppStore.setState({
        messagePagination: {
          'conv-1': { hasMore: false, oldestPosition: 0, isLoadingMore: false },
        },
      });

      // Next poll at 200ms resolves the wait, then fetches begin
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await drainTimers();

      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-target', { limit: 50, compact: true });
    });

    it('polls at 200ms intervals until initial conversation is loaded', async () => {
      const useMessagePrefetch = await importHook();

      const initialConv = makeConversation({ id: 'conv-init', sessionId: 'session-1' });
      const otherConv = makeConversation({ id: 'conv-other', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: 'conv-init',
        conversations: [initialConv, otherConv],
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      // Fire requestIdleCallback
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // After first 200ms poll - still not loaded
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      // After second 200ms poll - still not loaded
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      // Now load it
      useAppStore.setState({
        messagePagination: {
          'conv-init': { hasMore: false, oldestPosition: 0, isLoadingMore: false },
        },
      });

      // Next poll resolves the wait
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      await drainTimers();

      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-other', { limit: 50, compact: true });
    });

    it('skips polling when no initial conversation is selected', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-no-init', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers();

      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-no-init', { limit: 50, compact: true });
    });

    it('skips polling when initial conversation already has pagination', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-ready', sessionId: 'session-1' });
      const conv2 = makeConversation({ id: 'conv-needs-fetch', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: 'conv-ready',
        conversations: [conv1, conv2],
        messagePagination: {
          'conv-ready': { hasMore: false, oldestPosition: 0, isLoadingMore: false },
        },
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers();

      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-needs-fetch', { limit: 50, compact: true });
    });

    it('aborts polling on unmount', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-poll-abort', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: 'conv-poll-abort',
        conversations: [conv1],
        messagePagination: {}, // not loaded yet so polling starts
      });

      const { unmount } = renderHook(() => useMessagePrefetch(true));

      // Fire idle callback to start prefetch (enters the polling loop)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Unmount while polling
      unmount();

      // Advance well past what polling would need
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // Should never fetch because abortRef was set
      expect(mockGetConversationMessages).not.toHaveBeenCalled();
    });
  });

  // ── Filtering ─────────────────────────────────────────────────────────

  describe('filtering', () => {
    it('skips conversations that already have pagination data', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-1', sessionId: 'session-1' });
      const conv2 = makeConversation({ id: 'conv-2', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: 'conv-1',
        conversations: [conv1, conv2],
        messagePagination: {
          'conv-1': { hasMore: false, oldestPosition: 0, isLoadingMore: false },
          'conv-2': { hasMore: false, oldestPosition: 0, isLoadingMore: false },
        },
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers();

      expect(mockGetConversationMessages).not.toHaveBeenCalled();
    });

    it('skips conversations whose session is archived', async () => {
      const useMessagePrefetch = await importHook();

      const archivedSession = makeSession({ id: 'archived-session', archived: true });
      const conv1 = makeConversation({ id: 'conv-archived', sessionId: 'archived-session' });

      setupStore({
        selectedConversationId: null,
        sessions: [makeSession(), archivedSession],
        conversations: [conv1],
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers();

      expect(mockGetConversationMessages).not.toHaveBeenCalled();
    });

    it('skips conversations that already have messages in the store', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-with-msgs', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagesByConversation: { 'conv-with-msgs': [makeMessage('conv-with-msgs')] },
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers();

      expect(mockGetConversationMessages).not.toHaveBeenCalled();
    });
  });

  // ── Batch processing ──────────────────────────────────────────────────

  describe('batch processing', () => {
    it('processes conversations in batches of 3', async () => {
      const useMessagePrefetch = await importHook();

      // Create 5 conversations that need fetching
      const convs = Array.from({ length: 5 }, (_, i) =>
        makeConversation({ id: `conv-${i}`, sessionId: 'session-1' })
      );

      setupStore({
        selectedConversationId: null,
        conversations: convs,
        messagePagination: {},
      });

      const callOrder: string[] = [];
      mockGetConversationMessages.mockImplementation((convId: string) => {
        callOrder.push(convId);
        return Promise.resolve(makePageResponse(convId));
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      expect(mockGetConversationMessages).toHaveBeenCalledTimes(5);

      // First batch: conv-0, conv-1, conv-2
      expect(callOrder.slice(0, 3)).toEqual(['conv-0', 'conv-1', 'conv-2']);
      // Second batch: conv-3, conv-4
      expect(callOrder.slice(3)).toEqual(['conv-3', 'conv-4']);
    });

    it('yields to main thread between batches via requestIdleCallback', async () => {
      const useMessagePrefetch = await importHook();

      let ricCallCount = 0;
      globalThis.requestIdleCallback = ((cb: IdleRequestCallback) => {
        ricCallCount++;
        return setTimeout(
          () => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
          0
        ) as unknown as number;
      }) as typeof globalThis.requestIdleCallback;

      // 4 conversations = 2 batches, 1 yield between them + 1 initial defer = 2 rIC calls
      const convs = Array.from({ length: 4 }, (_, i) =>
        makeConversation({ id: `conv-${i}`, sessionId: 'session-1' })
      );

      setupStore({
        selectedConversationId: null,
        conversations: convs,
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      // 1 for initial defer + 1 for yield between batch 1 and batch 2
      expect(ricCallCount).toBe(2);
    });
  });

  // ── Workspace prioritization ──────────────────────────────────────────

  describe('workspace prioritization', () => {
    it('fetches same-workspace conversations before other workspaces', async () => {
      const useMessagePrefetch = await importHook();

      const sessionWs1 = makeSession({ id: 'session-ws1', workspaceId: 'ws-1' });
      const sessionWs2 = makeSession({ id: 'session-ws2', workspaceId: 'ws-2' });

      // Mix: deliberately interleave other-workspace and same-workspace conversations
      const convOther1 = makeConversation({ id: 'conv-other-1', sessionId: 'session-ws2' });
      const convSame1 = makeConversation({ id: 'conv-same-1', sessionId: 'session-ws1' });
      const convOther2 = makeConversation({ id: 'conv-other-2', sessionId: 'session-ws2' });
      const convSame2 = makeConversation({ id: 'conv-same-2', sessionId: 'session-ws1' });

      setupStore({
        selectedConversationId: null,
        selectedWorkspaceId: 'ws-1',
        sessions: [sessionWs1, sessionWs2],
        conversations: [convOther1, convSame1, convOther2, convSame2],
        messagePagination: {},
      });

      const callOrder: string[] = [];
      mockGetConversationMessages.mockImplementation((convId: string) => {
        callOrder.push(convId);
        return Promise.resolve(makePageResponse(convId));
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      expect(callOrder).toHaveLength(4);

      // Same-workspace conversations should come first
      expect(callOrder[0]).toBe('conv-same-1');
      expect(callOrder[1]).toBe('conv-same-2');
      // Other-workspace conversations after
      expect(callOrder[2]).toBe('conv-other-1');
      expect(callOrder[3]).toBe('conv-other-2');
    });
  });

  // ── Duplication prevention ────────────────────────────────────────────

  describe('duplication prevention', () => {
    it('re-checks messagePagination before each fetch in a batch', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-recheck', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagePagination: {},
      });

      // Override requestIdleCallback: set pagination before firing the callback,
      // so the re-check inside the batch map skips the fetch.
      globalThis.requestIdleCallback = ((cb: IdleRequestCallback) => {
        return setTimeout(() => {
          // Simulate another component loading this conversation's messages
          useAppStore.setState({
            messagePagination: {
              'conv-recheck': { hasMore: false, oldestPosition: 0, isLoadingMore: false },
            },
          });
          cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
        }, 0) as unknown as number;
      }) as typeof globalThis.requestIdleCallback;

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      // Restore polyfill for cleanup
      installIdleCallbackPolyfill();
    });

    it('does not re-fetch a conversation that was loaded by another component mid-batch', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-dup', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagePagination: {},
      });

      mockGetConversationMessages.mockImplementation((convId: string) => {
        // Simulate race: another component sets pagination before this resolves
        useAppStore.setState((state) => ({
          messagePagination: {
            ...state.messagePagination,
            [convId]: { hasMore: false, oldestPosition: 0, isLoadingMore: false },
          },
        }));
        return Promise.resolve(makePageResponse(convId));
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      expect(mockGetConversationMessages).toHaveBeenCalledTimes(1);
    });
  });

  // ── Store updates ─────────────────────────────────────────────────────

  describe('store updates', () => {
    it('stores fetched messages via setMessagePage', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-store', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagePagination: {},
      });

      const pageResponse = {
        messages: [
          { id: 'dto-1', role: 'user' as const, content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        ],
        hasMore: true,
        totalCount: 10,
        oldestPosition: 5,
      };
      mockGetConversationMessages.mockResolvedValue(pageResponse);
      mockToStoreMessage.mockImplementation((dto: { id: string }, convId: string) => ({
        id: dto.id,
        conversationId: convId,
        role: 'user',
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
      }));

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      // Verify messages ended up in the store
      const state = useAppStore.getState();
      const storedMessages = state.messagesByConversation['conv-store'] ?? [];
      expect(storedMessages).toHaveLength(1);
      expect(storedMessages[0].id).toBe('dto-1');

      // Verify pagination was set
      const pagination = state.messagePagination['conv-store'];
      expect(pagination).toBeDefined();
      expect(pagination.hasMore).toBe(true);
    });

    it('uses 0 as fallback when oldestPosition is undefined', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-no-pos', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagePagination: {},
      });

      mockGetConversationMessages.mockResolvedValue({
        messages: [],
        hasMore: false,
        totalCount: 0,
        oldestPosition: undefined,
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      const pagination = useAppStore.getState().messagePagination['conv-no-pos'];
      expect(pagination).toBeDefined();
      expect(pagination.oldestPosition).toBe(0);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('silently ignores fetch errors and continues with remaining conversations', async () => {
      const useMessagePrefetch = await importHook();

      const conv1 = makeConversation({ id: 'conv-err', sessionId: 'session-1' });
      const conv2 = makeConversation({ id: 'conv-ok', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1, conv2],
        messagePagination: {},
      });

      mockGetConversationMessages.mockImplementation((convId: string) => {
        if (convId === 'conv-err') {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve(makePageResponse(convId));
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      // conv-ok should still have been fetched despite conv-err failing
      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-ok', { limit: 50, compact: true });

      // conv-ok should be in the store, conv-err should not
      const pagination = useAppStore.getState().messagePagination;
      expect(pagination['conv-ok']).toBeDefined();
      expect(pagination['conv-err']).toBeUndefined();
    });
  });

  // ── Cleanup on unmount ────────────────────────────────────────────────

  describe('cleanup on unmount', () => {
    it('aborts on unmount and does not apply pending results', async () => {
      const useMessagePrefetch = await importHook();

      const convs = Array.from({ length: 7 }, (_, i) =>
        makeConversation({ id: `conv-${i}`, sessionId: 'session-1' })
      );

      setupStore({
        selectedConversationId: null,
        conversations: convs,
        messagePagination: {},
      });

      // Make fetches slow so we can unmount mid-flight
      mockGetConversationMessages.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(makePageResponse('x')), 500))
      );

      const { unmount } = renderHook(() => useMessagePrefetch(true));

      // Fire requestIdleCallback
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Unmount before fetches complete
      unmount();

      // Advance past the slow fetch timeouts
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      // Results should not have been applied to the store
      const pagination = useAppStore.getState().messagePagination;
      expect(Object.keys(pagination)).toHaveLength(0);
    });

    it('cancels requestIdleCallback handle on unmount', async () => {
      const useMessagePrefetch = await importHook();

      const cancelSpy = vi.fn();

      globalThis.requestIdleCallback = ((_cb: IdleRequestCallback) => {
        // Do NOT fire the callback so it stays pending
        return 42;
      }) as typeof globalThis.requestIdleCallback;
      globalThis.cancelIdleCallback = cancelSpy;

      setupStore({
        conversations: [makeConversation({ id: 'conv-cleanup', sessionId: 'session-1' })],
      });

      const { unmount } = renderHook(() => useMessagePrefetch(true));

      unmount();

      expect(cancelSpy).toHaveBeenCalledWith(42);

      // Restore polyfill for cleanup
      installIdleCallbackPolyfill();
    });

    it('clears setTimeout handle on unmount when requestIdleCallback is unavailable', async () => {
      const useMessagePrefetch = await importHook();

      // Remove requestIdleCallback to trigger the setTimeout fallback path.
      // Use a typeof-safe approach: set to non-function so typeof check fails.
      const savedRIC = globalThis.requestIdleCallback;
      const savedCIC = globalThis.cancelIdleCallback;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).requestIdleCallback = undefined;

      setupStore({
        conversations: [makeConversation({ id: 'conv-cleanup-fb', sessionId: 'session-1' })],
      });

      const { unmount } = renderHook(() => useMessagePrefetch(true));

      // Restore before unmount so cleanup doesn't error
      globalThis.requestIdleCallback = savedRIC;
      globalThis.cancelIdleCallback = savedCIC;

      // Unmount before the 2000ms timeout fires
      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      // The fetch should never have been called since we unmounted first
      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      installIdleCallbackPolyfill();
    });
  });

  // ── requestIdleCallback fallback ──────────────────────────────────────

  describe('requestIdleCallback fallback', () => {
    it('uses setTimeout(500) when requestIdleCallback is unavailable for initial defer', async () => {
      const useMessagePrefetch = await importHook();

      // Remove requestIdleCallback to trigger fallback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).requestIdleCallback = undefined;

      const conv1 = makeConversation({ id: 'conv-fallback', sessionId: 'session-1' });

      setupStore({
        selectedConversationId: null,
        conversations: [conv1],
        messagePagination: {},
      });

      const { unmount } = renderHook(() => useMessagePrefetch(true));

      // At 499ms, nothing should have fired yet
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(mockGetConversationMessages).not.toHaveBeenCalled();

      // At 500ms the fallback setTimeout fires
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      await drainTimers();

      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-fallback', { limit: 50, compact: true });

      // Restore polyfill before unmount
      installIdleCallbackPolyfill();
      unmount();
    });

    it('uses setTimeout(100) between batches when requestIdleCallback is unavailable', async () => {
      const useMessagePrefetch = await importHook();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).requestIdleCallback = undefined;

      // 4 conversations = 2 batches (3 + 1), needs a yield between them
      const convs = Array.from({ length: 4 }, (_, i) =>
        makeConversation({ id: `conv-fb-${i}`, sessionId: 'session-1' })
      );

      setupStore({
        selectedConversationId: null,
        conversations: convs,
        messagePagination: {},
      });

      const callOrder: string[] = [];
      mockGetConversationMessages.mockImplementation((convId: string) => {
        callOrder.push(convId);
        return Promise.resolve(makePageResponse(convId));
      });

      const { unmount } = renderHook(() => useMessagePrefetch(true));

      // Wait for the initial 2000ms fallback setTimeout
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      // Drain timers for the 100ms yield between batches + microtasks
      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      // All 4 should have been fetched across 2 batches
      expect(callOrder).toHaveLength(4);
      expect(callOrder.slice(0, 3)).toEqual(['conv-fb-0', 'conv-fb-1', 'conv-fb-2']);
      expect(callOrder[3]).toBe('conv-fb-3');

      // Restore polyfill before unmount
      installIdleCallbackPolyfill();
      unmount();
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty conversation list gracefully', async () => {
      const useMessagePrefetch = await importHook();

      setupStore({
        selectedConversationId: null,
        conversations: [],
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers();

      expect(mockGetConversationMessages).not.toHaveBeenCalled();
    });

    it('handles conversations with missing session gracefully', async () => {
      const useMessagePrefetch = await importHook();

      // Conversation references a session that does not exist in the store
      const orphanConv = makeConversation({ id: 'conv-orphan', sessionId: 'nonexistent-session' });

      setupStore({
        selectedConversationId: null,
        sessions: [makeSession()],
        conversations: [orphanConv],
        messagePagination: {},
      });

      renderHook(() => useMessagePrefetch(true));

      await drainTimers(MULTI_BATCH_DRAIN_ROUNDS);

      // Orphan conversation: its session is not in archivedSessionIds (only matching IDs
      // that have archived=true go there), so it passes the filter. The session lookup
      // returns undefined so it goes to otherWorkspaces.
      expect(mockGetConversationMessages).toHaveBeenCalledWith('conv-orphan', { limit: 50, compact: true });
    });
  });
});
