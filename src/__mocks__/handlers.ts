import { http, HttpResponse } from 'msw';

const API_BASE = 'http://localhost:9876';

export const handlers = [
  // Health check
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),

  // List sessions
  http.get(`${API_BASE}/api/repos/:workspaceId/sessions`, () => {
    return HttpResponse.json([
      {
        id: 'session-1',
        workspaceId: 'workspace-1',
        name: 'Test Session',
        branch: 'feature/test',
        worktreePath: '/test/worktree',
        status: 'idle',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
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
