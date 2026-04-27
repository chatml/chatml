import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getPRStatus,
  refreshPRStatus,
  unlinkPR,
  getPRs,
  postCommitStatus,
  getCommitStatuses,
  type PRDetails,
  type PRDashboardItem,
} from '../pr';

const API_BASE = 'http://localhost:9876';

const mockPR: PRDetails = {
  number: 42,
  state: 'open',
  title: 'Add login flow',
  body: 'Adds OAuth.',
  htmlUrl: 'https://github.com/x/y/pull/42',
  merged: false,
  mergeable: true,
  mergeableState: 'clean',
  checkStatus: 'success',
  checkDetails: [
    { name: 'CI / test', status: 'completed', conclusion: 'success', durationSeconds: 90 },
  ],
  reviewDecision: 'approved',
  requestedReviewers: 0,
};

describe('lib/api/pr', () => {
  describe('getPRStatus', () => {
    it('returns PR details on success', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, () =>
          HttpResponse.json(mockPR)
        )
      );

      const pr = await getPRStatus('ws-1', 'session-1');
      expect(pr?.number).toBe(42);
      expect(pr?.checkStatus).toBe('success');
    });

    it('returns null on 404 (no PR linked)', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, () =>
          HttpResponse.text('', { status: 404 })
        )
      );

      const pr = await getPRStatus('ws-1', 'session-1');
      expect(pr).toBeNull();
    });

    it('throws ApiError on 500 (not silently null)', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-status`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(getPRStatus('ws-1', 'session-1')).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('refreshPRStatus', () => {
    it('POSTs and resolves regardless of status (fire-and-forget)', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr-refresh`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 202 });
        })
      );

      await refreshPRStatus('ws-1', 'session-1');
      expect(capturedMethod).toBe('POST');
    });
  });

  describe('unlinkPR', () => {
    it('POSTs and resolves on success', async () => {
      let capturedMethod = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/unlink`,
          ({ request }) => {
            capturedMethod = request.method;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await unlinkPR('ws-1', 'session-1');
      expect(capturedMethod).toBe('POST');
    });

    it('throws ApiError with custom message on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/unlink`,
          () => HttpResponse.text('', { status: 500 })
        )
      );

      await expect(unlinkPR('ws-1', 'session-1')).rejects.toMatchObject({
        message: 'Failed to unlink pull request',
      });
    });
  });

  describe('getPRs', () => {
    const mockDashboardItem: PRDashboardItem = {
      number: 42,
      title: 'Add login',
      state: 'open',
      htmlUrl: 'https://github.com/x/y/pull/42',
      isDraft: false,
      mergeable: true,
      mergeableState: 'clean',
      checkStatus: 'success',
      checkDetails: [],
      labels: [{ name: 'enhancement', color: '00ff00' }],
      branch: 'feature/login',
      baseBranch: 'main',
      sessionId: 'session-1',
      sessionName: 'Login flow',
      workspaceId: 'ws-1',
      workspaceName: 'My Project',
      repoOwner: 'anthropics',
      repoName: 'claude-code',
      checksTotal: 3,
      checksPassed: 3,
      checksFailed: 0,
    };

    it('returns dashboard items without workspace filter', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/prs`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([mockDashboardItem]);
        })
      );

      const prs = await getPRs();
      expect(prs).toHaveLength(1);
      expect(capturedUrl).toBe(`${API_BASE}/api/prs`);
    });

    it('appends ?workspaceId when provided', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/prs`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await getPRs('ws-1');
      expect(capturedUrl).toContain('?workspaceId=ws-1');
    });
  });

  describe('postCommitStatus', () => {
    it('POSTs status payload and returns response', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/status`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({
              id: 1,
              state: 'success',
              description: 'all good',
              context: 'ci/test',
              targetUrl: 'https://ci/run/1',
              createdAt: '2026-04-26T00:00:00Z',
              creator: { login: 'bot', avatarUrl: 'https://avatars/bot' },
            });
          }
        )
      );

      const result = await postCommitStatus('ws-1', 'session-1', {
        state: 'success',
        description: 'all good',
        context: 'ci/test',
        targetUrl: 'https://ci/run/1',
      });

      expect(capturedBody).toEqual({
        state: 'success',
        description: 'all good',
        context: 'ci/test',
        targetUrl: 'https://ci/run/1',
      });
      expect(result.id).toBe(1);
      expect(result.state).toBe('success');
      expect(result.creator?.login).toBe('bot');
    });
  });

  describe('getCommitStatuses', () => {
    it('returns combined status with all status entries', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/statuses`,
          () =>
            HttpResponse.json({
              state: 'success',
              totalCount: 2,
              statuses: [
                {
                  id: 1,
                  state: 'success',
                  description: 'tests pass',
                  context: 'ci/test',
                  createdAt: '2026-04-26T00:00:00Z',
                },
                {
                  id: 2,
                  state: 'success',
                  description: 'lint pass',
                  context: 'ci/lint',
                  createdAt: '2026-04-26T00:01:00Z',
                },
              ],
            })
        )
      );

      const result = await getCommitStatuses('ws-1', 'session-1');
      expect(result.state).toBe('success');
      expect(result.totalCount).toBe(2);
      expect(result.statuses).toHaveLength(2);
    });
  });
});
