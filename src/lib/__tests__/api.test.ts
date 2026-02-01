import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import {
  listSessions,
  updateSession,
  getWorkspacesBasePath,
  setWorkspacesBasePath,
  createConversation,
  setConversationPlanMode,
  approvePlan,
  resolvePR,
} from '../api';

const API_BASE = 'http://localhost:9876';

describe('Session API', () => {
  describe('listSessions', () => {
    it('should exclude archived sessions by default', async () => {
      const sessions = await listSessions('workspace-1');
      expect(sessions).toHaveLength(1);
      expect(sessions.every(s => !s.archived)).toBe(true);
      expect(sessions[0].id).toBe('session-1');
    });

    it('should include archived sessions when requested', async () => {
      const sessions = await listSessions('workspace-1', true);
      expect(sessions).toHaveLength(2);
      expect(sessions.some(s => s.archived)).toBe(true);
    });
  });

  describe('updateSession', () => {
    it('should archive a session', async () => {
      const result = await updateSession('workspace-1', 'session-1', { archived: true });
      expect(result.archived).toBe(true);
    });

    it('should unarchive a session', async () => {
      // First archive it
      await updateSession('workspace-1', 'session-1', { archived: true });
      // Then unarchive
      const result = await updateSession('workspace-1', 'session-1', { archived: false });
      expect(result.archived).toBe(false);
    });

    it('should pin a session', async () => {
      const result = await updateSession('workspace-1', 'session-1', { pinned: true });
      expect(result.pinned).toBe(true);
    });

    it('should unpin a session', async () => {
      // First pin it
      await updateSession('workspace-1', 'session-1', { pinned: true });
      // Then unpin
      const result = await updateSession('workspace-1', 'session-1', { pinned: false });
      expect(result.pinned).toBe(false);
    });

    it('should update both archived and pinned in one request', async () => {
      const result = await updateSession('workspace-1', 'session-1', {
        archived: true,
        pinned: true,
      });
      expect(result.archived).toBe(true);
      expect(result.pinned).toBe(true);
    });
  });
});

describe('Settings API', () => {
  describe('getWorkspacesBasePath', () => {
    it('returns path from API', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ path: '/custom/workspaces' });
        })
      );

      const result = await getWorkspacesBasePath();
      expect(result).toBe('/custom/workspaces');
    });

    it('rejects on server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
        })
      );

      await expect(getWorkspacesBasePath()).rejects.toThrow();
    });
  });

  describe('setWorkspacesBasePath', () => {
    it('sends path and returns result', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/workspaces-base-dir`, async ({ request }) => {
          const body = await request.json() as { path: string };
          return HttpResponse.json({ path: body.path });
        })
      );

      const result = await setWorkspacesBasePath('/new/path');
      expect(result).toBe('/new/path');
    });

    it('resets with empty path', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ path: '/default/workspaces' });
        })
      );

      const result = await setWorkspacesBasePath('');
      expect(result).toBe('/default/workspaces');
    });

    it('rejects on validation error', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ error: 'path does not exist' }, { status: 400 });
        })
      );

      await expect(setWorkspacesBasePath('/nonexistent')).rejects.toThrow();
    });
  });
});

// ============================================================================
// Conversation API Tests
// ============================================================================

describe('Conversation API', () => {
  describe('createConversation', () => {
    it('creates a conversation without planMode', async () => {
      const result = await createConversation('workspace-1', 'session-1', {
        type: 'task',
        message: 'Hello',
      });

      expect(result.id).toBe('new-conv-id');
      expect(result.type).toBe('task');
      expect(result.status).toBe('active');
    });

    it('creates a conversation with planMode true', async () => {
      let receivedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          receivedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'plan-conv-id',
            sessionId: 'session-1',
            type: receivedBody.type || 'task',
            name: 'Plan Conversation',
            status: 'active',
            messages: [],
            toolSummary: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      const result = await createConversation('workspace-1', 'session-1', {
        type: 'task',
        message: 'Build a feature',
        planMode: true,
      });

      expect(result.id).toBe('plan-conv-id');
      expect(receivedBody.planMode).toBe(true);
      expect(receivedBody.message).toBe('Build a feature');
    });

    it('creates a conversation with planMode false', async () => {
      let receivedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          receivedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'no-plan-conv-id',
            sessionId: 'session-1',
            type: 'task',
            name: 'No Plan Conversation',
            status: 'active',
            messages: [],
            toolSummary: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      const result = await createConversation('workspace-1', 'session-1', {
        type: 'task',
        message: 'Quick fix',
        planMode: false,
      });

      expect(result.id).toBe('no-plan-conv-id');
      expect(receivedBody.planMode).toBe(false);
    });

    it('creates a conversation with planMode and thinking tokens', async () => {
      let receivedBody: Record<string, unknown> = {};
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
          receivedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({
            id: 'combo-conv-id',
            sessionId: 'session-1',
            type: 'task',
            name: 'Combo Conversation',
            status: 'active',
            messages: [],
            toolSummary: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        })
      );

      const result = await createConversation('workspace-1', 'session-1', {
        type: 'task',
        message: 'Complex task',
        planMode: true,
        maxThinkingTokens: 5000,
      });

      expect(result.id).toBe('combo-conv-id');
      expect(receivedBody.planMode).toBe(true);
      expect(receivedBody.maxThinkingTokens).toBe(5000);
    });

    it('handles server error on createConversation', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, () => {
          return HttpResponse.json({ error: 'session not found' }, { status: 404 });
        })
      );

      await expect(
        createConversation('workspace-1', 'nonexistent', {
          type: 'task',
          message: 'Hello',
        })
      ).rejects.toThrow();
    });
  });
});

// ============================================================================
// Plan Mode API Tests
// ============================================================================

describe('Plan Mode API', () => {
  describe('setConversationPlanMode', () => {
    it('enables plan mode', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/plan-mode`, async ({ request }) => {
          const body = await request.json() as { enabled: boolean };
          return HttpResponse.json({ enabled: body.enabled });
        })
      );

      await expect(setConversationPlanMode('conv-1', true)).resolves.toBeUndefined();
    });

    it('disables plan mode', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/plan-mode`, async ({ request }) => {
          const body = await request.json() as { enabled: boolean };
          return HttpResponse.json({ enabled: body.enabled });
        })
      );

      await expect(setConversationPlanMode('conv-1', false)).resolves.toBeUndefined();
    });

    it('rejects on server error', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/plan-mode`, () => {
          return HttpResponse.json({ error: 'conversation not found' }, { status: 404 });
        })
      );

      await expect(setConversationPlanMode('nonexistent', true)).rejects.toThrow();
    });

    it('rejects when process not running', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/plan-mode`, () => {
          return HttpResponse.json(
            { error: 'failed to set plan mode' },
            { status: 500 }
          );
        })
      );

      await expect(setConversationPlanMode('conv-1', true)).rejects.toThrow();
    });
  });

  describe('approvePlan', () => {
    it('approves a plan successfully', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/approve-plan`, () => {
          return HttpResponse.json({ approved: true });
        })
      );

      await expect(approvePlan('conv-1')).resolves.toBeUndefined();
    });

    it('rejects when conversation not found', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/approve-plan`, () => {
          return HttpResponse.json({ error: 'conversation not found' }, { status: 404 });
        })
      );

      await expect(approvePlan('nonexistent')).rejects.toThrow();
    });

    it('rejects when process not running', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/approve-plan`, () => {
          return HttpResponse.json(
            { error: 'failed to approve plan' },
            { status: 500 }
          );
        })
      );

      await expect(approvePlan('conv-1')).rejects.toThrow();
    });
  });
});

// ============================================================================
// ResolvePR API Tests
// ============================================================================

describe('ResolvePR API', () => {
  const mockPRResponse = {
    owner: 'testorg',
    repo: 'testrepo',
    prNumber: 42,
    title: 'Add authentication',
    body: 'Adds OAuth2 flow',
    branch: 'feature/auth',
    baseBranch: 'main',
    state: 'open',
    isDraft: false,
    labels: ['enhancement'],
    reviewers: ['reviewer1'],
    additions: 200,
    deletions: 50,
    changedFiles: 8,
    matchedWorkspaceId: 'workspace-123',
    htmlUrl: 'https://github.com/testorg/testrepo/pull/42',
  };

  it('resolves a PR URL successfully', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, async ({ request }) => {
        const body = await request.json() as { url: string };
        expect(body.url).toBe('https://github.com/testorg/testrepo/pull/42');
        return HttpResponse.json(mockPRResponse);
      })
    );

    const result = await resolvePR('https://github.com/testorg/testrepo/pull/42');

    expect(result.owner).toBe('testorg');
    expect(result.repo).toBe('testrepo');
    expect(result.prNumber).toBe(42);
    expect(result.title).toBe('Add authentication');
    expect(result.body).toBe('Adds OAuth2 flow');
    expect(result.branch).toBe('feature/auth');
    expect(result.baseBranch).toBe('main');
    expect(result.state).toBe('open');
    expect(result.isDraft).toBe(false);
    expect(result.labels).toEqual(['enhancement']);
    expect(result.reviewers).toEqual(['reviewer1']);
    expect(result.additions).toBe(200);
    expect(result.deletions).toBe(50);
    expect(result.changedFiles).toBe(8);
    expect(result.matchedWorkspaceId).toBe('workspace-123');
    expect(result.htmlUrl).toBe('https://github.com/testorg/testrepo/pull/42');
  });

  it('resolves a PR with no matched workspace', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json({
          ...mockPRResponse,
          matchedWorkspaceId: null,
        });
      })
    );

    const result = await resolvePR('https://github.com/other/repo/pull/1');
    expect(result.matchedWorkspaceId).toBeNull();
  });

  it('rejects on invalid PR URL', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json(
          { error: 'invalid GitHub PR URL' },
          { status: 400 }
        );
      })
    );

    await expect(resolvePR('not-a-valid-url')).rejects.toThrow();
  });

  it('rejects on server error', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json(
          { error: 'failed to fetch PR details' },
          { status: 500 }
        );
      })
    );

    await expect(
      resolvePR('https://github.com/org/repo/pull/999')
    ).rejects.toThrow();
  });

  it('rejects when not authenticated', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json(
          { error: 'GitHub client not configured' },
          { status: 400 }
        );
      })
    );

    await expect(
      resolvePR('https://github.com/org/repo/pull/1')
    ).rejects.toThrow();
  });
});
