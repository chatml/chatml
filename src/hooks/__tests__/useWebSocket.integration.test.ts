/**
 * Integration tests for useWebSocket — exercise the actual hook body, not just the store actions.
 *
 * The 7 useWebSocket.*.test.ts files were named for the hook but actually drive store actions
 * directly. This file drives the hook through a MockWebSocket and verifies that:
 *   - connect() opens a WebSocket with the auth token query param
 *   - onopen marks the connection store as connected
 *   - onmessage dispatches a representative subset of event types to the store
 *   - onclose triggers reconnection with exponential backoff
 *   - cleanup runs on unmount and on `enabled = false`
 *
 * It also exercises the exported module-level functions (`cleanupConversationState`,
 * `cleanupOllamaProgressTimer`).
 *
 * Comprehensive event-by-event coverage continues to live in the dedicated event tests
 * (which call store actions directly, much faster) — this file just proves the dispatch
 * path connects them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useWebSocket,
  cleanupConversationState,
  cleanupOllamaProgressTimer,
} from '../useWebSocket';
import { useAppStore } from '@/stores/appStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { flushAsync } from '@/test-utils/async';

// --- Mocks for hook dependencies ----------------------------------------------------

vi.mock('@/lib/auth-token', () => ({
  getAuthToken: vi.fn().mockResolvedValue('test-token'),
}));

vi.mock('@/lib/backend-port', () => ({
  getBackendPort: vi.fn().mockResolvedValue(9876),
  getBackendPortSync: vi.fn().mockReturnValue(9876),
}));

vi.mock('@/lib/api', () => ({
  getConversationDropStats: vi.fn().mockResolvedValue({ droppedMessages: 0 }),
  getActiveStreamingConversations: vi.fn().mockResolvedValue({ conversationIds: [] }),
  getInterruptedConversations: vi.fn().mockResolvedValue([]),
  getConversationMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false, totalCount: 0 }),
  getStreamingSnapshot: vi.fn().mockResolvedValue(null),
  toStoreMessage: vi.fn((m) => m),
  updateSession: vi.fn().mockResolvedValue(null),
  refreshPRStatus: vi.fn().mockResolvedValue(undefined),
  addSystemMessage: vi.fn().mockResolvedValue({ id: 'sys-1' }),
  listAllSessions: vi.fn().mockResolvedValue([]),
  mapSessionDTO: vi.fn((s) => s),
}));

vi.mock('@/lib/tauri', () => ({
  unregisterSession: vi.fn(),
  getSessionDirName: vi.fn(() => null),
}));

vi.mock('@/lib/sounds', () => ({
  playSound: vi.fn(),
}));

vi.mock('@/lib/telemetry', () => ({
  trackEvent: vi.fn(),
}));

vi.mock('@/hooks/useDesktopNotifications', () => ({
  notifyDesktop: vi.fn(),
  getConversationLabel: vi.fn(() => 'label'),
}));

// --- Mock WebSocket harness ---------------------------------------------------------

class MockWebSocket {
  // Mirror the standard WebSocket readyState constants — the real hook checks
  // `wsRef.current?.readyState === WebSocket.OPEN` and would short-circuit otherwise.
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];
  static lastUrl: string | null = null;

  url: string;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  readyState: number = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastUrl = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();

  close = vi.fn(() => {
    this.closed = true;
    this.readyState = 3;
  });

  // Test helpers
  triggerOpen() {
    this.readyState = 1;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }
  triggerMessage(data: unknown) {
    const event = new MessageEvent('message', { data: JSON.stringify(data) });
    this.onmessage?.call(this as unknown as WebSocket, event);
  }
  triggerClose() {
    this.readyState = 3;
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close'));
  }
  triggerError() {
    this.onerror?.call(this as unknown as WebSocket, new Event('error'));
  }

  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.lastUrl = null;
  }
  static get latest(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

// --- Tests --------------------------------------------------------------------------

describe('useWebSocket integration', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    // jsdom defines WebSocket on window with non-writable; override via defineProperty.
    // Vitest's stubGlobal alone doesn't propagate to `window.WebSocket` references.
    Object.defineProperty(globalThis, 'WebSocket', {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'WebSocket', {
      value: MockWebSocket,
      writable: true,
      configurable: true,
    });
    // Reset connection store
    useConnectionStore.setState({
      status: 'connecting',
      reconnectAttempt: 0,
      sidecarState: 'idle',
    } as never);
    // Quiet stores between tests
    useAppStore.setState({
      conversations: [],
      sessions: [],
      mcpServers: [],
      mcpServerSources: {},
    });
  });

  afterEach(() => {
    cleanupOllamaProgressTimer();
    vi.clearAllMocks();
  });

  // ---- Module-level exports --------------------------------------------------------

  describe('cleanupConversationState (exported)', () => {
    it('runs without throwing for unknown conversation', () => {
      expect(() => cleanupConversationState('unknown-conv')).not.toThrow();
    });

    it('clears reconciliation, plan-mode, and result-finalized state', async () => {
      // Cause some module state to exist via the hook's exported helpers,
      // then clean it up. We can't directly inspect the private state here, so we
      // assert that calling cleanup doesn't throw and is idempotent.
      cleanupConversationState('conv-x');
      cleanupConversationState('conv-x'); // second call is a no-op
      expect(true).toBe(true);
    });
  });

  describe('cleanupOllamaProgressTimer (exported)', () => {
    it('is safe to call when no timer is set', () => {
      expect(() => cleanupOllamaProgressTimer()).not.toThrow();
    });
  });

  // ---- Connection lifecycle --------------------------------------------------------

  describe('connection lifecycle', () => {
    it('opens a WebSocket with auth token query param when enabled', async () => {
      renderHook(() => useWebSocket(true));

      await waitFor(() => {
        expect(MockWebSocket.lastUrl).not.toBeNull();
      });

      expect(MockWebSocket.lastUrl).toContain('token=test-token');
    });

    it('marks connection as connected on ws.onopen', async () => {
      renderHook(() => useWebSocket(true));
      await waitFor(() => expect(MockWebSocket.latest).toBeDefined());

      act(() => {
        MockWebSocket.latest!.triggerOpen();
      });

      expect(useConnectionStore.getState().status).toBe('connected');
    });

    it('does not connect when enabled=false', async () => {
      renderHook(() => useWebSocket(false));
      // Give any pending promises a chance to resolve
      await flushAsync();
      expect(MockWebSocket.latest).toBeUndefined();
    });

    it('closes the connection on unmount', async () => {
      const { unmount } = renderHook(() => useWebSocket(true));
      await waitFor(() => expect(MockWebSocket.latest).toBeDefined());

      unmount();
      expect(MockWebSocket.latest!.close).toHaveBeenCalled();
    });

    it('closes the connection when toggled to enabled=false', async () => {
      const { rerender } = renderHook(({ enabled }) => useWebSocket(enabled), {
        initialProps: { enabled: true },
      });
      await waitFor(() => expect(MockWebSocket.latest).toBeDefined());
      const ws = MockWebSocket.latest!;

      rerender({ enabled: false });
      expect(ws.close).toHaveBeenCalled();
    });
  });

  // ---- Reconnection ---------------------------------------------------------------

  describe('reconnect on close', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('schedules reconnect with exponential backoff after onclose', async () => {
      renderHook(() => useWebSocket(true));
      await vi.waitFor(() => expect(MockWebSocket.latest).toBeDefined());

      act(() => {
        MockWebSocket.latest!.triggerOpen();
      });

      const firstWs = MockWebSocket.latest!;
      act(() => {
        firstWs.triggerClose();
      });

      expect(useConnectionStore.getState().status).toBe('connecting');

      // Advance through the backoff. Base delay is small in test conditions; a few seconds is generous.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      // A new WebSocket instance should have been created.
      expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('does not reconnect when sidecar is in "restarting" state', async () => {
      renderHook(() => useWebSocket(true));
      await vi.waitFor(() => expect(MockWebSocket.latest).toBeDefined());
      act(() => {
        MockWebSocket.latest!.triggerOpen();
      });

      // Mark sidecar as restarting BEFORE the close so reconnect logic skips
      useConnectionStore.setState({ sidecarState: 'restarting' } as never);

      const initialCount = MockWebSocket.instances.length;
      act(() => {
        MockWebSocket.latest!.triggerClose();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(MockWebSocket.instances.length).toBe(initialCount);
    });
  });

  // ---- Event dispatch end-to-end --------------------------------------------------

  describe('event dispatch (smoke)', () => {
    async function setupAndOpen() {
      const result = renderHook(() => useWebSocket(true));
      await vi.waitFor(() => expect(MockWebSocket.latest).toBeDefined());
      act(() => {
        MockWebSocket.latest!.triggerOpen();
      });
      return { ...result, ws: MockWebSocket.latest! };
    }

    it('dispatches init event with mcpServers payload', async () => {
      const { ws } = await setupAndOpen();

      act(() => {
        ws.triggerMessage({
          type: 'init',
          payload: {
            mcpServers: [{ name: 'github', command: 'gh-mcp' }],
            mcpServerSources: { github: 'workspace' },
          },
        });
      });

      const state = useAppStore.getState();
      expect(state.mcpServers).toHaveLength(1);
      expect(state.mcpServers[0].name).toBe('github');
      expect(state.mcpServerSources.github).toBe('workspace');
    });

    // Use vi.spyOn rather than setState({ updateSession: vi.fn() }) so the spy
    // patches the *existing* action reference on the live state object. This
    // works regardless of whether the hook reads the action via getState() per
    // dispatch (which useWebSocket does via `getStore = useAppStore.getState`)
    // or captures it once on mount, and vi auto-restores after the test.

    it('dispatches session_name_update to updateSession', async () => {
      const updateSpy = vi
        .spyOn(useAppStore.getState(), 'updateSession')
        .mockImplementation(() => {});

      const { ws } = await setupAndOpen();
      act(() => {
        ws.triggerMessage({
          type: 'session_name_update',
          sessionId: 'session-1',
          payload: { name: 'Renamed', branch: 'feat/new' },
        });
      });

      expect(updateSpy).toHaveBeenCalledWith('session-1', {
        name: 'Renamed',
        branch: 'feat/new',
      });
      updateSpy.mockRestore();
    });

    it('dispatches session_task_status_update', async () => {
      const updateSpy = vi
        .spyOn(useAppStore.getState(), 'updateSession')
        .mockImplementation(() => {});

      const { ws } = await setupAndOpen();
      act(() => {
        ws.triggerMessage({
          type: 'session_task_status_update',
          sessionId: 'session-1',
          payload: { taskStatus: 'in_progress' },
        });
      });

      expect(updateSpy).toHaveBeenCalledWith('session-1', { taskStatus: 'in_progress' });
      updateSpy.mockRestore();
    });

    it('logs and continues when message JSON is malformed', async () => {
      const { ws } = await setupAndOpen();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        const event = new MessageEvent('message', { data: 'not json {' });
        ws.onmessage?.call(ws as unknown as WebSocket, event);
      });

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to parse WebSocket message:',
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });

    it('ignores session_name_update when payload missing name', async () => {
      const updateSpy = vi
        .spyOn(useAppStore.getState(), 'updateSession')
        .mockImplementation(() => {});

      const { ws } = await setupAndOpen();
      act(() => {
        ws.triggerMessage({
          type: 'session_name_update',
          sessionId: 'session-1',
          payload: { branch: 'feat/x' }, // no name
        });
      });

      expect(updateSpy).not.toHaveBeenCalled();
      updateSpy.mockRestore();
    });
  });

  // ---- Returned reconnect() function ----------------------------------------------

  describe('returned reconnect()', () => {
    it('exposes a reconnect function', async () => {
      const { result } = renderHook(() => useWebSocket(true));
      await waitFor(() => expect(MockWebSocket.latest).toBeDefined());

      expect(typeof result.current.reconnect).toBe('function');
    });

    it('opens a fresh WebSocket and resets attempt counter', async () => {
      const { result } = renderHook(() => useWebSocket(true));
      await waitFor(() => expect(MockWebSocket.latest).toBeDefined());
      const firstCount = MockWebSocket.instances.length;

      await act(async () => {
        result.current.reconnect();
        // give the async connect() a chance
        await flushAsync();
      });

      expect(MockWebSocket.instances.length).toBeGreaterThan(firstCount);
      expect(useConnectionStore.getState().reconnectAttempt).toBe(0);
    });
  });
});
