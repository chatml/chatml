import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { useAppStore } from '@/stores/appStore';
import {
  getActiveStreamingConversations,
  getConversationMessages,
  getStreamingSnapshot,
  toStoreMessage,
} from '@/lib/api';
import type { StreamingSnapshotDTO } from '@/lib/api';

const API_BASE = 'http://localhost:9876';
const CONV_ACTIVE = 'conv-active-1';
const CONV_FINISHED = 'conv-finished-1';

/**
 * Tests for the streaming snapshot recovery feature (H3).
 *
 * When the WebSocket disconnects and reconnects while an agent is still streaming,
 * the frontend fetches a snapshot from the backend to restore its streaming view.
 *
 * Tests cover:
 * 1. getStreamingSnapshot API function
 * 2. restoreStreamingFromSnapshot store method
 * 3. Full reconciliation flow with snapshot recovery
 */

describe('useWebSocket — streaming snapshot recovery', () => {
  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      activeTools: {},
      conversations: [],
      messagesByConversation: {},
    });
  });

  // ==========================================================================
  // API: getStreamingSnapshot
  // ==========================================================================

  describe('getStreamingSnapshot API', () => {
    it('returns snapshot data from backend', async () => {
      const snapshotData: StreamingSnapshotDTO = {
        text: 'Hello world so far',
        activeTools: [{ id: 'tool-1', tool: 'Bash', startTime: 1706000001 }],
        thinking: 'analyzing...',
        isThinking: true,
        planModeActive: false,
      };

      server.use(
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/streaming-snapshot`, () => {
          return HttpResponse.json(snapshotData);
        }),
      );

      const result = await getStreamingSnapshot(CONV_ACTIVE);
      expect(result).toEqual(snapshotData);
    });

    it('returns null when no snapshot exists', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/streaming-snapshot`, () => {
          return HttpResponse.json(null);
        }),
      );

      const result = await getStreamingSnapshot(CONV_ACTIVE);
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Store: restoreStreamingFromSnapshot
  // ==========================================================================

  describe('restoreStreamingFromSnapshot store method', () => {
    it('restores text as a single segment', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);

      store.restoreStreamingFromSnapshot(CONV_ACTIVE, {
        text: 'Recovered assistant text',
        activeTools: [],
        isThinking: false,
        planModeActive: false,
      });

      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.text).toBe('Recovered assistant text');
      expect(state?.isStreaming).toBe(true);
      expect(state?.segments).toHaveLength(1);
      expect(state?.segments[0].text).toBe('Recovered assistant text');
      expect(state?.segments[0].id).toMatch(/^recovered-/);
      expect(state?.currentSegmentId).toBe(state?.segments[0].id);
    });

    it('restores active tools with timestamp conversion', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);

      store.restoreStreamingFromSnapshot(CONV_ACTIVE, {
        text: 'some text',
        activeTools: [
          { id: 'tool-1', tool: 'Bash', startTime: 1706000001 },
          { id: 'tool-2', tool: 'Read', startTime: 1706000005 },
        ],
        isThinking: false,
        planModeActive: false,
      });

      const tools = useAppStore.getState().activeTools[CONV_ACTIVE];
      expect(tools).toHaveLength(2);
      expect(tools[0].id).toBe('tool-1');
      expect(tools[0].tool).toBe('Bash');
      // Backend sends seconds, frontend expects milliseconds
      expect(tools[0].startTime).toBe(1706000001000);
      expect(tools[1].id).toBe('tool-2');
      expect(tools[1].tool).toBe('Read');
      expect(tools[1].startTime).toBe(1706000005000);
    });

    it('restores thinking state', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);

      store.restoreStreamingFromSnapshot(CONV_ACTIVE, {
        text: 'some text',
        activeTools: [],
        thinking: 'deep analysis of the problem...',
        isThinking: true,
        planModeActive: false,
      });

      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.thinking).toBe('deep analysis of the problem...');
      expect(state?.isThinking).toBe(true);
    });

    it('restores plan mode state', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);

      store.restoreStreamingFromSnapshot(CONV_ACTIVE, {
        text: 'planning...',
        activeTools: [],
        isThinking: false,
        planModeActive: true,
      });

      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.planModeActive).toBe(true);
    });

    it('handles empty text and no tools gracefully', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);

      store.restoreStreamingFromSnapshot(CONV_ACTIVE, {
        text: '',
        activeTools: [],
        isThinking: false,
        planModeActive: false,
      });

      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.text).toBe('');
      expect(state?.segments).toHaveLength(1);
      expect(state?.isStreaming).toBe(true);
      expect(useAppStore.getState().activeTools[CONV_ACTIVE]).toHaveLength(0);
    });

    it('overwrites previous streaming state', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);
      store.appendStreamingText(CONV_ACTIVE, 'old stale text');

      // Restore from snapshot — should replace stale state
      store.restoreStreamingFromSnapshot(CONV_ACTIVE, {
        text: 'fresh recovered text',
        activeTools: [],
        isThinking: false,
        planModeActive: false,
      });

      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.text).toBe('fresh recovered text');
      // Should have a single recovered segment, not the old one
      expect(state?.segments).toHaveLength(1);
      expect(state?.segments[0].text).toBe('fresh recovered text');
    });
  });

  // ==========================================================================
  // End-to-end reconciliation with snapshot recovery
  // ==========================================================================

  describe('end-to-end reconciliation with snapshot recovery', () => {
    /**
     * Replicates the full reconcileStreamingState logic from useWebSocket.ts
     * including the new snapshot recovery path for still-active conversations.
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
            // Agent finished — clear state and reload messages
            store.clearStreamingText(convId);
            store.clearActiveTools(convId);
            store.clearThinking(convId);
            store.updateConversation(convId, { status: 'completed' });

            try {
              const page = await getConversationMessages(convId, { compact: true });
              const messages = page.messages.map(m => toStoreMessage(m, convId));
              store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
            } catch {
              // Swallow
            }
          } else {
            // Agent still active — restore from snapshot
            try {
              const snapshot = await getStreamingSnapshot(convId);
              if (snapshot && snapshot.text) {
                store.restoreStreamingFromSnapshot(convId, snapshot);
              } else {
                try {
                  const page = await getConversationMessages(convId, { compact: true });
                  const messages = page.messages.map(m => toStoreMessage(m, convId));
                  store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
                } catch {
                  // Swallow
                }
              }
            } catch {
              // Swallow
            }
          }
        }
      } catch {
        // Swallow
      }
    }

    it('restores streaming view from snapshot for still-active conversations', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_ACTIVE, sessionId: 's1', type: 'task' as const, name: '', status: 'active' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);
      store.appendStreamingText(CONV_ACTIVE, 'stale partial text');

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_ACTIVE] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/streaming-snapshot`, () => {
          return HttpResponse.json({
            text: 'Full recovered text from backend',
            activeTools: [{ id: 'tool-1', tool: 'Bash', startTime: 1706000001 }],
            thinking: 'thinking content',
            isThinking: true,
            planModeActive: false,
          } satisfies StreamingSnapshotDTO);
        }),
      );

      await reconcileStreamingState();

      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.text).toBe('Full recovered text from backend');
      expect(state?.isStreaming).toBe(true);
      expect(state?.thinking).toBe('thinking content');
      expect(state?.isThinking).toBe(true);

      const tools = useAppStore.getState().activeTools[CONV_ACTIVE];
      expect(tools).toHaveLength(1);
      expect(tools[0].tool).toBe('Bash');
    });

    it('clears finished conversations and restores active ones in same reconciliation', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_ACTIVE, sessionId: 's1', type: 'task' as const, name: '', status: 'active' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
          { id: CONV_FINISHED, sessionId: 's2', type: 'task' as const, name: '', status: 'active' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);
      store.appendStreamingText(CONV_ACTIVE, 'partial...');
      store.setStreaming(CONV_FINISHED, true);
      store.appendStreamingText(CONV_FINISHED, 'also partial...');

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          // CONV_ACTIVE still running, CONV_FINISHED done
          return HttpResponse.json({ conversationIds: [CONV_ACTIVE] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/streaming-snapshot`, () => {
          return HttpResponse.json({
            text: 'Recovered active text',
            activeTools: [],
            isThinking: false,
            planModeActive: false,
          } satisfies StreamingSnapshotDTO);
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_FINISHED}/messages`, () => {
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

      // CONV_ACTIVE: restored from snapshot
      const activeState = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(activeState?.text).toBe('Recovered active text');
      expect(activeState?.isStreaming).toBe(true);

      // CONV_FINISHED: cleared and messages reloaded
      const finishedState = useAppStore.getState().streamingState[CONV_FINISHED];
      expect(finishedState?.isStreaming).toBe(false);
      expect(finishedState?.text).toBe('');

      const finishedConv = useAppStore.getState().conversations.find(c => c.id === CONV_FINISHED);
      expect(finishedConv?.status).toBe('completed');

      const msgs = useAppStore.getState().messagesByConversation[CONV_FINISHED] ?? [];
      expect(msgs).toHaveLength(1);
    });

    it('falls back to message reload when snapshot is empty for still-active conversation', async () => {
      useAppStore.setState({
        conversations: [
          { id: CONV_ACTIVE, sessionId: 's1', type: 'task' as const, name: '', status: 'active' as const, messages: [], toolSummary: [], createdAt: '', updatedAt: '' },
        ],
      });

      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_ACTIVE] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/streaming-snapshot`, () => {
          // Empty snapshot — race condition where result was just persisted
          return HttpResponse.json(null);
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/messages`, () => {
          return HttpResponse.json({
            messages: [
              { id: 'msg-1', role: 'assistant', content: 'Just finished answer', timestamp: new Date().toISOString(), position: 1 },
            ],
            hasMore: false,
            totalCount: 1,
            oldestPosition: 1,
          });
        }),
      );

      await reconcileStreamingState();

      // Messages should be reloaded as fallback
      const msgs = useAppStore.getState().messagesByConversation[CONV_ACTIVE] ?? [];
      expect(msgs).toHaveLength(1);

      // Streaming should still be active (agent process hasn't exited)
      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.isStreaming).toBe(true);
    });

    it('handles snapshot API error gracefully', async () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ACTIVE, true);
      store.appendStreamingText(CONV_ACTIVE, 'some text');

      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () => {
          return HttpResponse.json({ conversationIds: [CONV_ACTIVE] });
        }),
        http.get(`${API_BASE}/api/conversations/${CONV_ACTIVE}/streaming-snapshot`, () => {
          return HttpResponse.error();
        }),
      );

      // Should not throw
      await reconcileStreamingState();

      // Streaming state should be unchanged (error path doesn't modify)
      const state = useAppStore.getState().streamingState[CONV_ACTIVE];
      expect(state?.isStreaming).toBe(true);
      expect(state?.text).toContain('some text');
    });
  });
});
