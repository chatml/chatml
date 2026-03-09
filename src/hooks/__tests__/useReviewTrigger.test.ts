import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { useReviewTrigger } from '../useReviewTrigger';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';

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
    messagesByConversation: {},
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
      expect(requestBody!.message).toBe('Review: Quick Scan');
      // Full prompt should be in the instruction attachment
      const attachments = requestBody!.attachments as Array<Record<string, unknown>>;
      expect(attachments).toHaveLength(1);
      expect(attachments[0].isInstruction).toBe(true);
      expect(attachments[0].name).toBe('Quick Scan Instructions');
      const decoded = atob(attachments[0].base64Data as string);
      expect(decoded).toContain('quick scan');
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
      expect(requestBody!.message).toBe('Review: Deep Review');
      const attachments = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded = atob(attachments[0].base64Data as string);
      expect(decoded).toContain('thorough code review');
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
      expect(requestBody!.message).toBe('Review: Security Audit');
      const attachments = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded = atob(attachments[0].base64Data as string);
      expect(decoded).toContain('security-focused review');
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
      expect(requestBody!.message).toBe('Review: Quick Scan');
      const attachments = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded = atob(attachments[0].base64Data as string);
      expect(decoded).toContain('quick scan');
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

      const reviewMessages = useAppStore.getState().messagesByConversation['new-review-conv'] ?? [];
      expect(reviewMessages).toHaveLength(1);
      expect(reviewMessages[0].role).toBe('user');
      expect(reviewMessages[0].content).toBe('Review: Quick Scan');
      expect(reviewMessages[0].attachments).toHaveLength(1);
      expect(reviewMessages[0].attachments[0].isInstruction).toBe(true);
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

  describe('actionable-only feedback preference', () => {
    it('excludes actionable-only instruction by default (store defaults to false)', async () => {
      // Verify the store default is false so this test breaks loudly if the default changes
      expect(useSettingsStore.getState().reviewActionableOnly).toBe(false);

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

      // Do NOT set reviewActionableOnly — rely on store default (false)
      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      expect(requestBody).not.toBeNull();
      const attachments0 = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded0 = atob(attachments0[0].base64Data as string);
      expect(decoded0).not.toContain('Only report actionable findings');
    });

    it('includes actionable-only instruction when reviewActionableOnly is explicitly true', async () => {
      let requestBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'conv-actionable',
            sessionId: 'session-1',
            type: 'review',
            name: 'Code Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      useSettingsStore.setState({ reviewActionableOnly: true });

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      expect(requestBody).not.toBeNull();
      const attachments1 = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded1 = atob(attachments1[0].base64Data as string);
      expect(decoded1).toContain('Only report actionable findings');
    });

    it('excludes actionable-only instruction when reviewActionableOnly is false', async () => {
      let requestBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'conv-all-feedback',
            sessionId: 'session-1',
            type: 'review',
            name: 'Code Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      useSettingsStore.setState({ reviewActionableOnly: false });

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('deep');
      });

      expect(requestBody).not.toBeNull();
      const attachments2 = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded2 = atob(attachments2[0].base64Data as string);
      expect(decoded2).not.toContain('Only report actionable findings');
    });

    it('places actionable-only instruction before custom overrides so user overrides take precedence', async () => {
      let requestBody: Record<string, unknown> | null = null;

      // Mock both the conversation creation and the review prompt overrides
      server.use(
        http.get(`${API_BASE}/api/settings/review-prompts`, () => {
          return HttpResponse.json({ prompts: { quick: 'Custom global override' } });
        }),
        http.get(`${API_BASE}/api/repos/:workspaceId/settings/review-prompts`, () => {
          return HttpResponse.json({ prompts: {} });
        }),
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          requestBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'conv-override',
            sessionId: 'session-1',
            type: 'review',
            name: 'Code Review',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      useSettingsStore.setState({ reviewActionableOnly: true });

      setupSelectedContext();
      renderHook(() => useReviewTrigger());

      await act(async () => {
        dispatchStartReview('quick');
      });

      // The handler chain is: dispatch → fetchMergedOverrides → createConversation.
      // act() may not resolve the full chain, so wait for the request to complete.
      await waitFor(() => {
        expect(requestBody).not.toBeNull();
      });

      const attachments3 = requestBody!.attachments as Array<Record<string, unknown>>;
      const decoded3 = atob(attachments3[0].base64Data as string);
      // Actionable instruction should appear before custom override
      const actionableIndex = decoded3.indexOf('Only report actionable findings');
      const overrideIndex = decoded3.indexOf('Custom global override');
      expect(actionableIndex).toBeGreaterThan(-1);
      expect(overrideIndex).toBeGreaterThan(-1);
      expect(actionableIndex).toBeLessThan(overrideIndex);
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
