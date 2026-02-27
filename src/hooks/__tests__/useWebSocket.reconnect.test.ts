import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { useAppStore } from '@/stores/appStore';
import { getActiveStreamingConversations, getConversationMessages, toStoreMessage } from '@/lib/api';

const API_BASE = 'http://localhost:9876';
const CONV_1 = 'conv-streaming-1';
const CONV_2 = 'conv-streaming-2';

/**
 * Tests for the WebSocket reconnect reconciliation logic (CM-77).
 *
 * The reconcileStreamingState function in useWebSocket:
 * 1. Finds conversations where the frontend has isStreaming: true
 * 2. Queries GET /api/conversations/active-streaming for server-side truth
 * 3. Clears orphaned streaming state for conversations no longer active on server
 *
 * We test the store mutations directly (same pattern as useWebSocket.contextUsage.test.ts)
 * and the API function via MSW.
 */

describe('useWebSocket — reconnect streaming reconciliation', () => {
  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      activeTools: {},
      conversations: [],
    });
  });

  // ==========================================================================
  // API: getActiveStreamingConversations
  // ==========================================================================

  describe('getActiveStreamingConversations API', () => {
    it('returns conversation IDs from backend', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1, CONV_2] });
        }),
      );

      const result = await getActiveStreamingConversations();
      expect(result.conversationIds).toEqual([CONV_1, CONV_2]);
    });

    it('returns empty array when no conversations are streaming', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [] });
        }),
      );

      const result = await getActiveStreamingConversations();
      expect(result.conversationIds).toEqual([]);
    });
  });

  // ==========================================================================
  // Reconciliation logic — store mutations
  // ==========================================================================

  describe('reconciliation — clearing orphaned streaming state', () => {
    it('clears streaming state for conversations not active on server', () => {
      // Simulate: frontend thinks CONV_1 is streaming, but server says it is not
      const store = useAppStore.getState();
      store.setStreaming(CONV_1, true);
      store.appendStreamingText(CONV_1, 'partial response...');

      // Verify streaming is set
      expect(useAppStore.getState().streamingState[CONV_1]?.isStreaming).toBe(true);
      expect(useAppStore.getState().streamingState[CONV_1]?.text).toContain('partial');

      // Simulate what reconcileStreamingState does when server returns empty
      store.clearStreamingText(CONV_1);
      store.clearActiveTools(CONV_1);
      store.clearThinking(CONV_1);

      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.isStreaming).toBe(false);
      expect(state?.text).toBe('');
      expect(state?.segments).toEqual([]);
      expect(state?.thinking).toBeNull();
    });

    it('preserves streaming state for conversations still active on server', () => {
      const store = useAppStore.getState();

      // Two conversations streaming
      store.setStreaming(CONV_1, true);
      store.appendStreamingText(CONV_1, 'still going...');
      store.setStreaming(CONV_2, true);
      store.appendStreamingText(CONV_2, 'also active...');

      // Server says CONV_1 is still active, CONV_2 is not
      const serverActiveSet = new Set([CONV_1]);

      // Only clear CONV_2 (simulating reconciliation logic)
      const locallyStreaming = Object.entries(useAppStore.getState().streamingState)
        .filter(([, s]) => s.isStreaming)
        .map(([id]) => id);

      for (const convId of locallyStreaming) {
        if (!serverActiveSet.has(convId)) {
          store.clearStreamingText(convId);
          store.clearActiveTools(convId);
          store.clearThinking(convId);
        }
      }

      // CONV_1 should still be streaming
      expect(useAppStore.getState().streamingState[CONV_1]?.isStreaming).toBe(true);
      expect(useAppStore.getState().streamingState[CONV_1]?.text).toContain('still going');

      // CONV_2 should be cleared
      expect(useAppStore.getState().streamingState[CONV_2]?.isStreaming).toBe(false);
      expect(useAppStore.getState().streamingState[CONV_2]?.text).toBe('');
    });

    it('handles no locally streaming conversations (no-op)', () => {
      // No streaming state at all — reconciliation should find nothing to clear
      const locallyStreaming = Object.entries(useAppStore.getState().streamingState)
        .filter(([, s]) => s.isStreaming)
        .map(([id]) => id);

      expect(locallyStreaming).toHaveLength(0);
    });

    it('clears active tools alongside streaming state', () => {
      const store = useAppStore.getState();

      store.setStreaming(CONV_1, true);
      store.addActiveTool(CONV_1, {
        id: 'tool-1',
        name: 'Read',
        args: { path: '/test' },
      });

      expect(useAppStore.getState().activeTools[CONV_1]).toHaveLength(1);

      // Simulate reconciliation clearing
      store.clearStreamingText(CONV_1);
      store.clearActiveTools(CONV_1);

      expect(useAppStore.getState().activeTools[CONV_1] ?? []).toHaveLength(0);
    });

    it('clears thinking state alongside streaming state', () => {
      const store = useAppStore.getState();

      store.setStreaming(CONV_1, true);
      store.appendThinkingText(CONV_1, 'thinking about this...');

      expect(useAppStore.getState().streamingState[CONV_1]?.thinking).toContain('thinking');
      expect(useAppStore.getState().streamingState[CONV_1]?.isThinking).toBe(true);

      // Simulate reconciliation clearing
      store.clearStreamingText(CONV_1);
      store.clearThinking(CONV_1);

      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.thinking).toBeNull();
      expect(state?.isThinking).toBe(false);
    });
  });

  // ==========================================================================
  // Idempotency — clearStreamingText on already-cleared state
  // ==========================================================================

  describe('idempotency', () => {
    it('clearStreamingText is safe to call on already-cleared conversation', () => {
      const store = useAppStore.getState();

      // Set and clear streaming
      store.setStreaming(CONV_1, true);
      store.clearStreamingText(CONV_1);

      // Calling again should not throw
      store.clearStreamingText(CONV_1);

      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.isStreaming).toBe(false);
    });

    it('clearActiveTools is safe on conversation with no tools', () => {
      const store = useAppStore.getState();

      // Clear tools for conversation that never had tools
      store.clearActiveTools(CONV_1);

      expect(useAppStore.getState().activeTools[CONV_1] ?? []).toHaveLength(0);
    });
  });

  // ==========================================================================
  // End-to-end reconciliation flow
  // ==========================================================================

  describe('end-to-end reconciliation flow', () => {
    /**
     * Replicates the full reconcileStreamingState logic from useWebSocket.ts
     * with real store + MSW-mocked API. This verifies the complete flow:
     * detect orphaned conversations → query backend → clear state → reload messages.
     */
    async function reconcileStreamingState() {
      const store = useAppStore.getState();

      const locallyStreaming = Object.entries(store.streamingState)
        .filter(([, state]) => state.isStreaming)
        .map(([convId]) => convId);

      if (locallyStreaming.length === 0) return;

      try {
        const { conversationIds: serverActive } = await getActiveStreamingConversations();
        const serverActiveSet = new Set(serverActive);

        for (const convId of locallyStreaming) {
          if (!serverActiveSet.has(convId)) {
            store.clearStreamingText(convId);
            store.clearActiveTools(convId);
            store.clearThinking(convId);
            store.updateConversation(convId, { status: 'completed' });

            try {
              const page = await getConversationMessages(convId);
              const messages = page.messages.map(m => toStoreMessage(m, convId));
              store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
            } catch {
              // Swallow — same as production code
            }
          }
        }
      } catch {
        // Swallow — matches production try/catch in useWebSocket
      }
    }

    it('clears orphaned state and reloads messages for finished conversations', async () => {
      // Seed conversations in the store (conversations is an array)
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: 's1', type: 'task' as const, name: '', status: 'active' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
          { id: CONV_2, sessionId: 's2', type: 'task' as const, name: '', status: 'active' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      const store = useAppStore.getState();

      // Frontend thinks both are streaming
      store.setStreaming(CONV_1, true);
      store.appendStreamingText(CONV_1, 'partial...');
      store.addActiveTool(CONV_1, { id: 'tool-1', name: 'Read', args: {} });
      store.appendThinkingText(CONV_1, 'thinking...');

      store.setStreaming(CONV_2, true);
      store.appendStreamingText(CONV_2, 'also partial...');

      // Server says only CONV_2 is still active
      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_2] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_1}/messages`, () => {
          return HttpResponse.json({
            messages: [
              { id: 'msg-1', role: 'assistant', content: 'Final answer', timestamp: new Date().toISOString(), position: 1 },
            ],
            hasMore: false,
            totalCount: 1,
            oldestPosition: 1,
          });
        }),
      );

      await reconcileStreamingState();

      // CONV_1: orphaned state should be fully cleared
      const s1 = useAppStore.getState().streamingState[CONV_1];
      expect(s1?.isStreaming).toBe(false);
      expect(s1?.text).toBe('');
      expect(s1?.thinking).toBeNull();
      expect(useAppStore.getState().activeTools[CONV_1] ?? []).toHaveLength(0);

      // CONV_1: conversation status set to 'completed'
      const conv1 = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv1?.status).toBe('completed');

      // CONV_1: messages should be reloaded
      const msgs = useAppStore.getState().messagesByConversation[CONV_1] ?? [];
      expect(msgs).toHaveLength(1);

      // CONV_2: still streaming — untouched
      expect(useAppStore.getState().streamingState[CONV_2]?.isStreaming).toBe(true);
      expect(useAppStore.getState().streamingState[CONV_2]?.text).toContain('also partial');
    });

    it('is a no-op when nothing is streaming locally', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          // Should never be called
          throw new Error('Should not query server when no local streaming');
        }),
      );

      // No streaming state — should return immediately without calling API
      await reconcileStreamingState();
    });

    it('handles API error gracefully without crashing', async () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_1, true);

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.error();
        }),
      );

      // Should not throw — errors are caught and swallowed
      await reconcileStreamingState();

      // Streaming state should be unchanged (error path doesn't clear)
      expect(useAppStore.getState().streamingState[CONV_1]?.isStreaming).toBe(true);
    });
  });
});
