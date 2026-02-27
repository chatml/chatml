import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { useAppStore } from '@/stores/appStore';
import {
  getActiveStreamingConversations,
  getStreamingSnapshot,
} from '@/lib/api';
import type { StreamingSnapshotDTO } from '@/lib/api';

const API_BASE = 'http://localhost:9876';
const CONV_1 = 'conv-initial-1';
const CONV_2 = 'conv-initial-2';
const SESSION_1 = 'session-1';
const SESSION_2 = 'session-2';

/**
 * Tests for the initial streaming state reconciliation logic.
 *
 * When the app first connects to the WebSocket (not a reconnect),
 * reconcileInitialStreamingState queries the backend for actively-streaming
 * conversations and restores their status and streaming state. This is needed
 * because page.tsx resets all conversation statuses to 'idle' on load.
 *
 * We test the store mutations directly (same pattern as useWebSocket.reconnect.test.ts).
 */

describe('useWebSocket — initial streaming state reconciliation', () => {
  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      activeTools: {},
      subAgents: {},
      conversations: [],
      messagesByConversation: {},
    });
  });

  // ==========================================================================
  // Full reconciliation flow
  // ==========================================================================

  /**
   * Replicates the reconcileInitialStreamingState logic from useWebSocket.ts.
   * Unlike reconnect reconciliation (starts from local streaming state), this
   * starts from the backend truth since there is no local streaming state on
   * a fresh load.
   */
  async function reconcileInitialStreamingState() {
    const store = useAppStore.getState();

    try {
      const { conversationIds: serverActive } = await getActiveStreamingConversations();
      if (serverActive.length === 0) return;

      for (const convId of serverActive) {
        const conv = store.conversations.find(c => c.id === convId);
        if (!conv) continue;

        store.updateConversation(convId, { status: 'active' });

        try {
          const snapshot = await getStreamingSnapshot(convId);
          if (snapshot && snapshot.text) {
            store.restoreStreamingFromSnapshot(convId, snapshot);
          } else {
            store.setStreaming(convId, true);
          }
        } catch {
          store.setStreaming(convId, true);
        }
      }
    } catch {
      // Swallow — matches production try/catch
    }
  }

  describe('restoring active conversations on first connection', () => {
    it('sets conversation status to active and restores streaming from snapshot', async () => {
      // Simulate: conversations loaded from backend with status reset to 'idle'
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_1}/streaming-snapshot`, () => {
          return HttpResponse.json({
            text: 'Agent is working on your request...',
            activeTools: [{ id: 'tool-1', tool: 'Read', startTime: 1706000001 }],
            thinking: 'analyzing files...',
            isThinking: true,
            planModeActive: false,
          } satisfies StreamingSnapshotDTO);
        }),
      );

      await reconcileInitialStreamingState();

      // Conversation status should be restored to 'active'
      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv?.status).toBe('active');

      // Streaming state should be restored from snapshot
      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.isStreaming).toBe(true);
      expect(state?.text).toBe('Agent is working on your request...');
      expect(state?.thinking).toBe('analyzing files...');
      expect(state?.isThinking).toBe(true);

      // Active tools should be restored
      const tools = useAppStore.getState().activeTools[CONV_1];
      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('Read');
    });

    it('falls back to setStreaming when snapshot is null', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_1}/streaming-snapshot`, () => {
          return HttpResponse.json(null);
        }),
      );

      await reconcileInitialStreamingState();

      // Conversation status should still be set to 'active'
      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv?.status).toBe('active');

      // Streaming should be marked true as fallback (spinner shows)
      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.isStreaming).toBe(true);
    });

    it('falls back to setStreaming when snapshot has empty text', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_1}/streaming-snapshot`, () => {
          return HttpResponse.json({
            text: '',
            activeTools: [],
            isThinking: false,
            planModeActive: false,
          } satisfies StreamingSnapshotDTO);
        }),
      );

      await reconcileInitialStreamingState();

      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv?.status).toBe('active');

      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.isStreaming).toBe(true);
    });

    it('falls back to setStreaming when snapshot fetch fails', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_1}/streaming-snapshot`, () => {
          return HttpResponse.error();
        }),
      );

      await reconcileInitialStreamingState();

      // Should still set conversation active and streaming despite snapshot error
      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv?.status).toBe('active');

      const state = useAppStore.getState().streamingState[CONV_1];
      expect(state?.isStreaming).toBe(true);
    });

    it('handles multiple active conversations', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
          { id: CONV_2, sessionId: SESSION_2, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1, CONV_2] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_1}/streaming-snapshot`, () => {
          return HttpResponse.json({
            text: 'Conv 1 text',
            activeTools: [],
            isThinking: false,
            planModeActive: false,
          } satisfies StreamingSnapshotDTO);
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_2}/streaming-snapshot`, () => {
          return HttpResponse.json({
            text: 'Conv 2 text',
            activeTools: [],
            isThinking: false,
            planModeActive: true,
          } satisfies StreamingSnapshotDTO);
        }),
      );

      await reconcileInitialStreamingState();

      // Both conversations should be restored
      const conv1 = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      const conv2 = useAppStore.getState().conversations.find(c => c.id === CONV_2);
      expect(conv1?.status).toBe('active');
      expect(conv2?.status).toBe('active');

      expect(useAppStore.getState().streamingState[CONV_1]?.isStreaming).toBe(true);
      expect(useAppStore.getState().streamingState[CONV_1]?.text).toBe('Conv 1 text');
      expect(useAppStore.getState().streamingState[CONV_2]?.isStreaming).toBe(true);
      expect(useAppStore.getState().streamingState[CONV_2]?.text).toBe('Conv 2 text');
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('is a no-op when backend reports no active conversations', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [] });
        }),
      );

      await reconcileInitialStreamingState();

      // Nothing should change
      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv?.status).toBe('idle');
      expect(useAppStore.getState().streamingState[CONV_1]).toBeUndefined();
    });

    it('skips conversations not yet loaded in the store', async () => {
      // Store has no conversations (data hasn't loaded yet)
      useAppStore.setState({ conversations: [] });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_1] });
        }),
      );

      await reconcileInitialStreamingState();

      // No streaming state should be set for unknown conversations
      expect(useAppStore.getState().streamingState[CONV_1]).toBeUndefined();
    });

    it('handles active-streaming API error gracefully', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_1, sessionId: SESSION_1, type: 'task' as const, name: '', status: 'idle' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.error();
        }),
      );

      // Should not throw
      await reconcileInitialStreamingState();

      // Nothing should change
      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_1);
      expect(conv?.status).toBe('idle');
    });
  });
});
