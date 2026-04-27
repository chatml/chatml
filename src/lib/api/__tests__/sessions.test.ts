import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  mapSessionDTO,
  listSessions,
  listAllSessions,
  createSession,
  updateSession,
  deleteSession,
  preflightCheck,
  getCurrentBranch,
  createBranch,
  switchBranch,
  deleteBranch,
  listStashes,
  createStash,
  applyStash,
  popStash,
  dropStash,
  sendSessionMessage,
  listReviewScorecards,
  type SessionDTO,
  type StashEntry,
  type ReviewScorecardDTO,
} from '../sessions';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockSessionDTO: SessionDTO = {
  id: 'session-1',
  workspaceId: 'ws-1',
  name: 'Test',
  branch: 'feature/test',
  worktreePath: '/tmp/wt',
  task: 'Add login',
  status: 'idle',
  priority: 1,
  taskStatus: 'in_progress',
  agentId: 'agent-1',
  stats: { additions: 10, deletions: 5 },
  prStatus: 'open',
  prNumber: 42,
  sessionType: 'worktree',
  pinned: false,
  archived: false,
  createdAt: '2026-04-26T00:00:00Z',
  updatedAt: '2026-04-26T01:00:00Z',
};

describe('lib/api/sessions', () => {
  describe('mapSessionDTO', () => {
    it('maps full DTO into WorktreeSession with priority/taskStatus narrowed', () => {
      const result = mapSessionDTO(mockSessionDTO);
      expect(result.id).toBe('session-1');
      expect(result.priority).toBe(1);
      expect(result.taskStatus).toBe('in_progress');
      expect(result.stats?.additions).toBe(10);
      expect(result.archiveSummaryStatus).toBe('');
    });

    it('falls back to defaults when priority is missing', () => {
      const dto = { ...mockSessionDTO, priority: undefined as unknown as number };
      const result = mapSessionDTO(dto);
      expect(result.priority).toBe(0);
    });

    it("falls back to 'backlog' when taskStatus is missing", () => {
      const dto = { ...mockSessionDTO, taskStatus: undefined as unknown as string };
      const result = mapSessionDTO(dto);
      expect(result.taskStatus).toBe('backlog');
    });

    it('preserves archiveSummaryStatus when provided', () => {
      const result = mapSessionDTO({ ...mockSessionDTO, archiveSummaryStatus: 'completed' });
      expect(result.archiveSummaryStatus).toBe('completed');
    });
  });

  describe('listAllSessions', () => {
    it('returns all sessions across workspaces', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/sessions`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([mockSessionDTO]);
        })
      );

      const sessions = await listAllSessions();
      expect(sessions).toHaveLength(1);
      expect(capturedUrl).toBe(`${API_BASE}/api/sessions`);
    });

    it('appends ?includeArchived=true', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/sessions`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await listAllSessions(true);
      expect(capturedUrl).toContain('?includeArchived=true');
    });
  });

  describe('createSession', () => {
    it('POSTs default empty body', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(mockSessionDTO);
        })
      );

      await createSession('ws-1');
      expect(capturedBody).toEqual({});
    });

    it('POSTs all session fields when provided', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(mockSessionDTO);
        })
      );

      await createSession('ws-1', {
        name: 'Test',
        branch: 'feature/test',
        branchPrefix: 'feature',
        task: 'Add login',
        sessionType: 'worktree',
      });

      expect(capturedBody).toEqual({
        name: 'Test',
        branch: 'feature/test',
        branchPrefix: 'feature',
        task: 'Add login',
        sessionType: 'worktree',
      });
    });
  });

  describe('listSessions', () => {
    it('omits archived param by default', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await listSessions('ws-1');
      expect(capturedUrl).not.toContain('includeArchived');
    });

    it('appends ?includeArchived=true', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await listSessions('ws-1', true);
      expect(capturedUrl).toContain('?includeArchived=true');
    });
  });

  describe('updateSession', () => {
    it('returns null on 204 (session deleted)', async () => {
      server.use(
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId`, () =>
          new HttpResponse(null, { status: 204 })
        )
      );

      const result = await updateSession('ws-1', 'session-1', { archived: true });
      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('DELETEs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteSession('ws-1', 'session-1');
      expect(capturedMethod).toBe('DELETE');
    });

    it('throws ApiError with delete message on failure', async () => {
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(deleteSession('ws-1', 'session-1')).rejects.toMatchObject({
        message: 'Failed to delete session',
      });
    });
  });

  describe('preflightCheck', () => {
    it('returns ok=true for clean workspace', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/preflight`, () =>
          HttpResponse.json({ ok: true })
        )
      );

      const result = await preflightCheck('ws-1', 'session-1');
      expect(result.ok).toBe(true);
    });

    it('reports active rebase + corruption flags', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/preflight`, () =>
          HttpResponse.json({
            ok: false,
            activeRebase: true,
            corruptedIndex: true,
            errorMessage: 'rebase in progress',
          })
        )
      );

      const result = await preflightCheck('ws-1', 'session-1');
      expect(result.ok).toBe(false);
      expect(result.activeRebase).toBe(true);
      expect(result.errorMessage).toBe('rebase in progress');
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch name', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/current-branch`,
          () => HttpResponse.json({ branch: 'feature/test' })
        )
      );

      const result = await getCurrentBranch('ws-1', 'session-1');
      expect(result.branch).toBe('feature/test');
    });
  });

  describe('createBranch', () => {
    it('POSTs name + startPoint', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branches/create`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({ branch: 'feature/new' });
          }
        )
      );

      await createBranch('ws-1', 'session-1', 'feature/new', 'main');
      expect(capturedBody).toEqual({ name: 'feature/new', startPoint: 'main' });
    });

    it('omits startPoint when not provided', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branches/create`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({ branch: 'feature/new' });
          }
        )
      );

      await createBranch('ws-1', 'session-1', 'feature/new');
      expect(capturedBody).toEqual({ name: 'feature/new' });
    });
  });

  describe('switchBranch', () => {
    it('POSTs branch name and returns confirmed branch', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branches/switch`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({ branch: 'main' });
          }
        )
      );

      const result = await switchBranch('ws-1', 'session-1', 'main');
      expect(capturedBody).toEqual({ branch: 'main' });
      expect(result.branch).toBe('main');
    });
  });

  describe('deleteBranch', () => {
    it('encodes branch names with slashes', async () => {
      let capturedUrl = '';
      server.use(
        http.delete(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branches/:branchName`,
          ({ request }) => {
            capturedUrl = request.url;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await deleteBranch('ws-1', 'session-1', 'feature/test');
      expect(capturedUrl).toContain('/branches/feature%2Ftest');
    });

    it('throws ApiError with delete-branch message on failure', async () => {
      server.use(
        http.delete(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branches/:branchName`,
          () => HttpResponse.text('', { status: 500 })
        )
      );

      await expect(deleteBranch('ws-1', 'session-1', 'feature/test')).rejects.toMatchObject({
        message: 'Failed to delete branch',
      });
    });
  });

  describe('stashes', () => {
    const mockStash: StashEntry = { index: 0, branch: 'main', message: 'WIP' };

    it('listStashes returns stash entries', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/stashes`,
          () => HttpResponse.json([mockStash])
        )
      );

      const stashes = await listStashes('ws-1', 'session-1');
      expect(stashes).toHaveLength(1);
      expect(stashes[0].message).toBe('WIP');
    });

    it('createStash POSTs message + includeUntracked', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/stashes`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await createStash('ws-1', 'session-1', 'WIP', true);
      expect(capturedBody).toEqual({ message: 'WIP', includeUntracked: true });
    });

    it('createStash throws ApiError on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/stashes`,
          () => HttpResponse.text('cannot stash', { status: 500 })
        )
      );

      await expect(createStash('ws-1', 'session-1')).rejects.toBeInstanceOf(ApiError);
    });

    it('applyStash POSTs to /apply at given index', async () => {
      let capturedUrl = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/stashes/:index/apply`,
          ({ request }) => {
            capturedUrl = request.url;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await applyStash('ws-1', 'session-1', 2);
      expect(capturedUrl).toContain('/stashes/2/apply');
    });

    it('popStash POSTs to /pop at given index', async () => {
      let capturedUrl = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/stashes/:index/pop`,
          ({ request }) => {
            capturedUrl = request.url;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await popStash('ws-1', 'session-1', 0);
      expect(capturedUrl).toContain('/stashes/0/pop');
    });

    it('dropStash DELETEs at given index', async () => {
      let capturedMethod = '';
      let capturedUrl = '';
      server.use(
        http.delete(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/stashes/:index`,
          ({ request }) => {
            capturedMethod = request.method;
            capturedUrl = request.url;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await dropStash('ws-1', 'session-1', 1);
      expect(capturedMethod).toBe('DELETE');
      expect(capturedUrl).toContain('/stashes/1');
    });
  });

  describe('sendSessionMessage', () => {
    it('POSTs content', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/message`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await sendSessionMessage('ws-1', 'session-1', 'hello');
      expect(capturedBody).toEqual({ content: 'hello' });
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/message`,
          () => HttpResponse.text('busy', { status: 503 })
        )
      );

      await expect(sendSessionMessage('ws-1', 'session-1', 'hi')).rejects.toBeInstanceOf(
        ApiError
      );
    });
  });

  describe('listReviewScorecards', () => {
    it('returns scorecards', async () => {
      const scorecard: ReviewScorecardDTO = {
        id: 'sc-1',
        sessionId: 'session-1',
        reviewType: 'code-review',
        scores: '[]',
        summary: 'LGTM',
        createdAt: '2026-04-26T00:00:00Z',
      };

      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/review-scorecards`,
          () => HttpResponse.json([scorecard])
        )
      );

      const scorecards = await listReviewScorecards('ws-1', 'session-1');
      expect(scorecards).toHaveLength(1);
      expect(scorecards[0].summary).toBe('LGTM');
    });
  });
});
