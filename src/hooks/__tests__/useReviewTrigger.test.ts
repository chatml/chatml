import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { useReviewTrigger } from '../useReviewTrigger';
import { useAppStore } from '@/stores/appStore';

const API_BASE = 'http://localhost:9876';

// ── Helpers ─────────────────────────────────────────────────────────────

function dispatchStartReview(type?: string) {
  window.dispatchEvent(
    new CustomEvent('start-review', {
      detail: type ? { type } : {},
    })
  );
}

function mockCreateConversation(response?: Record<string, unknown>) {
  server.use(
    http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async () => {
      return HttpResponse.json({
        id: 'new-review-conv',
        sessionId: 'session-1',
        type: 'review',
        name: 'Code Review',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...response,
      });
    })
  );
}

function resetStore() {
  useAppStore.setState({
    selectedWorkspaceId: null,
    selectedSessionId: null,
    selectedConversationId: null,
    conversations: [],
    messages: [],
    reviewComments: {},
    streamingState: {},
  });
}

function setupSelectedContext(workspaceId = 'ws-1', sessionId = 'session-1') {
  useAppStore.setState({
    selectedWorkspaceId: workspaceId,
    selectedSessionId: sessionId,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('useReviewTrigger', () => {
  beforeEach(() => {
    resetStore();
    mockCreateConversation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('event listener lifecycle', () => {
    it('registers start-review event listener on mount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      expect(addSpy).toHaveBeenCalledWith('start-review', expect.any(Function));
    });

    it('removes event listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      setupSelectedContext();
      const { unmount } = renderHook(() => useReviewTrigger());

      unmount();

      expect(removeSpy).toHaveBeenCalledWith('start-review', expect.any(Function));
    });

    it('does not register listener when no workspace selected', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');

      // No workspace/session selected
      renderHook(() => useReviewTrigger());

      const startReviewCalls = addSpy.mock.calls.filter(
        (call) => call[0] === 'start-review'
      );
      expect(startReviewCalls).toHaveLength(0);
    });

    it('does not register listener when no session selected', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');

      useAppStore.setState({ selectedWorkspaceId: 'ws-1', selectedSessionId: null });
      renderHook(() => useReviewTrigger());

      const startReviewCalls = addSpy.mock.calls.filter(
        (call) => call[0] === 'start-review'
      );
      expect(startReviewCalls).toHaveLength(0);
    });
  });

  describe('conversation creation', () => {
    it('creates a review conversation when start-review event fires', async () => {
      let requestBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'new-review-conv',
            sessionId: 'session-1',
            type: 'review',
            name: 'Code Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      expect(requestBody).not.toBeNull();
      expect(requestBody!.type).toBe('review');
      expect(requestBody!.message).toContain('Review the changes');
    });

    it('sends deep review prompt for type=deep', async () => {
      let requestBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'conv-deep',
            sessionId: 'session-1',
            type: 'review',
            name: 'Deep Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('deep');
      });

      expect(requestBody).not.toBeNull();
      expect(requestBody!.message).toContain('thorough code review');
    });

    it('sends security review prompt for type=security', async () => {
      let requestBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'conv-sec',
            sessionId: 'session-1',
            type: 'review',
            name: 'Security Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('security');
      });

      expect(requestBody).not.toBeNull();
      expect(requestBody!.message).toContain('security audit');
    });

    it('defaults to quick review when no type specified', async () => {
      let requestBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'conv-default',
            sessionId: 'session-1',
            type: 'review',
            name: 'Code Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview(); // no type
      });

      expect(requestBody).not.toBeNull();
      expect(requestBody!.message).toContain('Review the changes');
    });
  });

  describe('store updates', () => {
    it('adds conversation to store after creation', async () => {
      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      const conversations = useAppStore.getState().conversations;
      const reviewConv = conversations.find((c) => c.id === 'new-review-conv');
      expect(reviewConv).toBeDefined();
      expect(reviewConv!.type).toBe('review');
    });

    it('adds user message to store', async () => {
      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      const messages = useAppStore.getState().messages;
      const reviewMessages = messages.filter((m) => m.conversationId === 'new-review-conv');
      expect(reviewMessages).toHaveLength(1);
      expect(reviewMessages[0].role).toBe('user');
      expect(reviewMessages[0].content).toContain('Review the changes');
    });

    it('selects the new conversation', async () => {
      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      expect(useAppStore.getState().selectedConversationId).toBe('new-review-conv');
    });

    it('sets streaming state for the new conversation', async () => {
      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      const streamingState = useAppStore.getState().streamingState['new-review-conv'];
      expect(streamingState?.isStreaming).toBe(true);
    });
  });

  describe('error handling', () => {
    it('logs error when API call fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        })
      );

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to start review:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    it('does not update store when API fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        })
      );

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      const conversations = useAppStore.getState().conversations;
      expect(conversations).toHaveLength(0);

      vi.restoreAllMocks();
    });
  });
});
