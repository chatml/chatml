import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:9876';

// Mock session data for testing
const mockSessions = [
  {
    id: 'session-1',
    workspaceId: 'workspace-1',
    name: 'Test Session',
    branch: 'feature/test',
    worktreePath: '/test/worktree',
    status: 'idle' as const,
    pinned: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'session-2',
    workspaceId: 'workspace-1',
    name: 'Archived Session',
    branch: 'feature/archived',
    worktreePath: '/test/worktree2',
    status: 'idle' as const,
    pinned: false,
    archived: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const handlers = [
  // Health check
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // List sessions with archive filtering
  http.get(`${API_BASE}/api/repos/:workspaceId/sessions`, ({ request, params }) => {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get('includeArchived') === 'true';

    let sessions = mockSessions.filter(s => s.workspaceId === params.workspaceId);
    if (!includeArchived) {
      sessions = sessions.filter(s => !s.archived);
    }

    return HttpResponse.json(sessions);
  }),

  // Update session (PATCH)
  http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId`, async ({ request, params }) => {
    const body = await request.json() as { archived?: boolean; pinned?: boolean; name?: string; targetBranch?: string };
    const session = mockSessions.find(s => s.id === params.sessionId);

    if (!session) {
      return HttpResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Apply updates
    if (body.archived !== undefined) {
      session.archived = body.archived;
    }
    if (body.pinned !== undefined) {
      session.pinned = body.pinned;
    }
    if (body.name !== undefined) {
      session.name = body.name;
    }
    if (body.targetBranch !== undefined) {
      (session as Record<string, unknown>).targetBranch = body.targetBranch || undefined;
    }
    session.updatedAt = new Date().toISOString();

    return HttpResponse.json(session);
  }),

  // Create conversation
  http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`, async ({ request }) => {
    const body = (await request.json()) as { type?: string; message?: string };
    return HttpResponse.json({
      id: 'new-conv-id',
      sessionId: 'session-1',
      type: body.type || 'task',
      name: 'New Conversation',
      status: 'active',
      messages: [],
      toolSummary: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }),

  // Get file content
  http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.searchParams.get('path') || '';
    return HttpResponse.json({
      path,
      name: path.split('/').pop() || '',
      content: '// Test file content',
      size: 100,
    });
  }),

  // Git status
  http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/git-status`, () => {
    return HttpResponse.json({
      workingDirectory: {
        stagedCount: 0,
        unstagedCount: 2,
        untrackedCount: 1,
        totalUncommitted: 3,
        hasChanges: true,
      },
      sync: {
        aheadBy: 1,
        behindBy: 0,
        baseBranch: 'main',
        hasRemote: true,
        diverged: false,
        unpushedCommits: 1,
      },
      inProgress: { type: 'none' },
      conflicts: { hasConflicts: false, count: 0, files: [] },
      stash: { count: 0 },
    });
  }),
];
