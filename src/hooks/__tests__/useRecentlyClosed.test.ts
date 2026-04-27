import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  captureClosedConversation,
  deleteClosedConversations,
  useRestoreConversation,
} from '../useRecentlyClosed';
import { useAppStore } from '@/stores/appStore';
import { useRecentlyClosedStore } from '@/stores/recentlyClosedStore';
import type { Conversation } from '@/lib/types';

const API_BASE = 'http://localhost:9876';

const mockConv: Conversation = {
  id: 'c1',
  sessionId: 's1',
  type: 'task',
  name: 'Test',
  status: 'idle',
  messages: [],
  toolSummary: [],
  createdAt: '',
  updatedAt: '',
  messageCount: 5,
  model: 'claude-sonnet-4-6',
} as Conversation;

describe('useRecentlyClosed', () => {
  beforeEach(() => {
    useRecentlyClosedStore.setState({ closedConversations: [] } as never);
    useAppStore.setState({
      conversations: [],
      conversationIds: new Set(),
      conversationsBySession: {},
    });
  });

  describe('captureClosedConversation', () => {
    it('adds conversation metadata to the recently-closed store', () => {
      captureClosedConversation(mockConv, 'ws-1');
      const closed = useRecentlyClosedStore.getState().closedConversations;
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({
        id: 'c1',
        sessionId: 's1',
        workspaceId: 'ws-1',
        name: 'Test',
        type: 'task',
        messageCount: 5,
        model: 'claude-sonnet-4-6',
      });
      expect(typeof closed[0].closedAt).toBe('number');
    });

    it('falls back to messages.length when messageCount is missing', () => {
      const conv = { ...mockConv, messageCount: undefined, messages: [{}, {}] as never };
      captureClosedConversation(conv, 'ws-1');
      expect(useRecentlyClosedStore.getState().closedConversations[0].messageCount).toBe(2);
    });

    it('falls back to 0 when neither messageCount nor messages are available', () => {
      const conv = { ...mockConv, messageCount: undefined, messages: undefined as never };
      captureClosedConversation(conv, 'ws-1');
      expect(useRecentlyClosedStore.getState().closedConversations[0].messageCount).toBe(0);
    });
  });

  describe('deleteClosedConversations', () => {
    it('issues a DELETE for each id and resolves even if some fail', async () => {
      const deletedIds: string[] = [];
      server.use(
        http.delete(`${API_BASE}/api/conversations/:convId`, ({ params }) => {
          const id = params.convId as string;
          if (id === 'c-fail') {
            return HttpResponse.text('', { status: 500 });
          }
          deletedIds.push(id);
          return new HttpResponse(null, { status: 204 });
        })
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await deleteClosedConversations(['c1', 'c-fail', 'c2']);

      expect(deletedIds).toEqual(['c1', 'c2']);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('handles an empty list without making requests', async () => {
      let getCount = 0;
      server.use(
        http.delete(`${API_BASE}/api/conversations/:convId`, () => {
          getCount++;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteClosedConversations([]);
      expect(getCount).toBe(0);
    });
  });

  describe('useRestoreConversation', () => {
    function setupHandlers(opts: { fail?: boolean } = {}) {
      const conversationsByConvId: Record<string, unknown> = {
        'c-restored': {
          id: 'c-restored',
          sessionId: 's1',
          type: 'task',
          name: 'Restored',
          status: 'idle',
          messages: [],
          toolSummary: [{ id: 't1', tool: 'Read', target: 'a.ts', success: true }],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      };

      server.use(
        http.get(`${API_BASE}/api/conversations/:convId`, ({ params }) => {
          if (opts.fail) return HttpResponse.text('', { status: 500 });
          const conv = conversationsByConvId[params.convId as string];
          return conv ? HttpResponse.json(conv) : HttpResponse.text('', { status: 404 });
        }),
        http.get(`${API_BASE}/api/conversations/:convId/messages`, () =>
          HttpResponse.json({ messages: [], hasMore: false, totalCount: 0 })
        )
      );
    }

    it('fetches conversation + messages and adds to the app store', async () => {
      setupHandlers();
      useRecentlyClosedStore.setState({
        closedConversations: [{
          id: 'c-restored',
          sessionId: 's1',
          workspaceId: 'ws-1',
          name: 'Restored',
          type: 'task',
          closedAt: Date.now(),
          messageCount: 0,
        }],
      } as never);

      const showError = vi.fn();
      const { result } = renderHook(() => useRestoreConversation(showError));

      await act(async () => {
        await result.current('c-restored');
      });

      const state = useAppStore.getState();
      expect(state.conversations.find((c) => c.id === 'c-restored')).toBeDefined();
      expect(state.selectedConversationId).toBe('c-restored');
      // Removed from recently-closed after successful restore
      expect(useRecentlyClosedStore.getState().closedConversations).toEqual([]);
    });

    it('calls showError and removes from recently-closed when restore fails', async () => {
      setupHandlers({ fail: true });
      useRecentlyClosedStore.setState({
        closedConversations: [{
          id: 'c-broken',
          sessionId: 's1',
          workspaceId: 'ws-1',
          name: 'Broken',
          type: 'task',
          closedAt: Date.now(),
          messageCount: 0,
        }],
      } as never);

      const showError = vi.fn();
      const { result } = renderHook(() => useRestoreConversation(showError));

      await act(async () => {
        await result.current('c-broken');
      });

      expect(showError).toHaveBeenCalledWith(
        'Could not restore conversation. It may have been deleted.'
      );
      // Stale entry is also removed
      expect(useRecentlyClosedStore.getState().closedConversations).toEqual([]);
    });
  });
});
