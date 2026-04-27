import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listBranches,
  resolvePR,
  analyzeBranchCleanup,
  executeBranchCleanup,
  getBranchSyncStatus,
  syncBranch,
  abortBranchSync,
  type BranchDTO,
  type CleanupCandidate,
  type ResolvePRResponse,
} from '../branches';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockBranch: BranchDTO = {
  name: 'feature/test',
  isRemote: false,
  isHead: true,
  lastCommitSha: 'abc1234567890def',
  lastCommitDate: '2026-01-15T10:00:00Z',
  lastCommitSubject: 'feat: add login',
  lastAuthor: 'Alice',
  lastAuthorEmail: 'alice@example.com',
  aheadMain: 3,
  behindMain: 1,
  prefix: 'feature',
};

describe('lib/api/branches', () => {
  describe('listBranches', () => {
    it('returns sessionBranches and otherBranches', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/branches`, () => {
          return HttpResponse.json({
            sessionBranches: [mockBranch],
            otherBranches: [],
            currentBranch: 'feature/test',
            total: 1,
            hasMore: false,
          });
        })
      );

      const result = await listBranches('ws-1');

      expect(result.sessionBranches).toHaveLength(1);
      expect(result.sessionBranches[0].name).toBe('feature/test');
      expect(result.currentBranch).toBe('feature/test');
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it('omits the query string when no params are passed', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/branches`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            sessionBranches: [],
            otherBranches: [],
            currentBranch: 'main',
            total: 0,
            hasMore: false,
          });
        })
      );

      await listBranches('ws-1');
      expect(capturedUrl).toBe(`${API_BASE}/api/repos/ws-1/branches`);
    });

    it('serializes all params into the query string', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/branches`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({
            sessionBranches: [],
            otherBranches: [],
            currentBranch: 'main',
            total: 0,
            hasMore: false,
          });
        })
      );

      await listBranches('ws-1', {
        includeRemote: true,
        limit: 50,
        offset: 100,
        search: 'feat',
        sortBy: 'date',
      });

      const params = new URLSearchParams(capturedSearch);
      expect(params.get('includeRemote')).toBe('true');
      expect(params.get('limit')).toBe('50');
      expect(params.get('offset')).toBe('100');
      expect(params.get('search')).toBe('feat');
      expect(params.get('sortBy')).toBe('date');
    });

    it('serializes includeRemote=false explicitly (not omitted)', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/branches`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({
            sessionBranches: [],
            otherBranches: [],
            currentBranch: 'main',
            total: 0,
            hasMore: false,
          });
        })
      );

      await listBranches('ws-1', { includeRemote: false });

      const params = new URLSearchParams(capturedSearch);
      expect(params.get('includeRemote')).toBe('false');
    });

    it('skips empty search string', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/branches`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({
            sessionBranches: [],
            otherBranches: [],
            currentBranch: 'main',
            total: 0,
            hasMore: false,
          });
        })
      );

      await listBranches('ws-1', { search: '' });
      expect(capturedSearch).toBe('');
    });
  });

  describe('resolvePR', () => {
    const mockPRResponse: ResolvePRResponse = {
      owner: 'anthropics',
      repo: 'claude-code',
      prNumber: 42,
      title: 'Add login flow',
      body: 'Adds OAuth login.',
      branch: 'feature/login',
      baseBranch: 'main',
      state: 'open',
      isDraft: false,
      labels: ['enhancement'],
      reviewers: ['alice'],
      additions: 100,
      deletions: 20,
      changedFiles: 5,
      matchedWorkspaceId: 'ws-1',
      htmlUrl: 'https://github.com/anthropics/claude-code/pull/42',
    };

    it('POSTs the URL and returns parsed PR data', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/resolve-pr`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(mockPRResponse);
        })
      );

      const result = await resolvePR('https://github.com/anthropics/claude-code/pull/42');

      expect(capturedBody).toEqual({ url: 'https://github.com/anthropics/claude-code/pull/42' });
      expect(result.prNumber).toBe(42);
      expect(result.matchedWorkspaceId).toBe('ws-1');
      expect(result.labels).toEqual(['enhancement']);
    });

    it('throws ApiError when URL is invalid', async () => {
      server.use(
        http.post(`${API_BASE}/api/resolve-pr`, () =>
          HttpResponse.json({ error: 'Invalid PR URL' }, { status: 400 })
        )
      );

      await expect(resolvePR('not-a-url')).rejects.toBeInstanceOf(ApiError);
      await expect(resolvePR('not-a-url')).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('analyzeBranchCleanup', () => {
    const mockCandidate: CleanupCandidate = {
      name: 'feature/old',
      isRemote: false,
      category: 'merged',
      reason: 'Merged into main',
      lastCommitDate: '2025-12-01T00:00:00Z',
      lastAuthor: 'Bob',
      hasLocalAndRemote: false,
      isProtected: false,
      deletable: true,
    };

    it('POSTs analysis params and returns candidates', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/branches/analyze-cleanup`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({
              candidates: [mockCandidate],
              summary: { merged: 1, stale: 0, orphaned: 0, safe: 0 },
              protectedCount: 2,
              totalAnalyzed: 5,
            });
          }
        )
      );

      const result = await analyzeBranchCleanup('ws-1', {
        staleDaysThreshold: 30,
        includeRemote: true,
      });

      expect(capturedBody).toEqual({ staleDaysThreshold: 30, includeRemote: true });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].category).toBe('merged');
      expect(result.summary.merged).toBe(1);
      expect(result.protectedCount).toBe(2);
    });
  });

  describe('executeBranchCleanup', () => {
    it('POSTs branch targets and returns succeeded/failed splits', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/branches/cleanup`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({
              succeeded: [{ name: 'feature/old', deletedLocal: true, deletedRemote: false }],
              failed: [
                {
                  name: 'feature/locked',
                  deletedLocal: false,
                  deletedRemote: false,
                  error: 'protected branch',
                },
              ],
            });
          }
        )
      );

      const result = await executeBranchCleanup('ws-1', [
        { name: 'feature/old', deleteLocal: true, deleteRemote: false },
        { name: 'feature/locked', deleteLocal: true, deleteRemote: true },
      ]);

      expect(capturedBody).toEqual({
        branches: [
          { name: 'feature/old', deleteLocal: true, deleteRemote: false },
          { name: 'feature/locked', deleteLocal: true, deleteRemote: true },
        ],
      });
      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('protected branch');
    });
  });

  describe('getBranchSyncStatus', () => {
    it('returns sync status with commits behind', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-sync`,
          () =>
            HttpResponse.json({
              behindBy: 3,
              commits: [
                { sha: 'aaa1111', subject: 'fix: thing' },
                { sha: 'bbb2222', subject: 'docs: update' },
                { sha: 'ccc3333', subject: 'chore: bump' },
              ],
              baseBranch: 'main',
              lastChecked: '2026-04-26T17:00:00Z',
            })
        )
      );

      const status = await getBranchSyncStatus('ws-1', 'session-1');

      expect(status.behindBy).toBe(3);
      expect(status.commits).toHaveLength(3);
      expect(status.commits[0].subject).toBe('fix: thing');
      expect(status.baseBranch).toBe('main');
    });

    it('returns 0 commits when up-to-date', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-sync`,
          () =>
            HttpResponse.json({
              behindBy: 0,
              commits: [],
              baseBranch: 'main',
              lastChecked: '2026-04-26T17:00:00Z',
            })
        )
      );

      const status = await getBranchSyncStatus('ws-1', 'session-1');
      expect(status.behindBy).toBe(0);
      expect(status.commits).toEqual([]);
    });
  });

  describe('syncBranch', () => {
    it('POSTs operation=rebase and returns success result', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-sync`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({
              success: true,
              newBaseSha: 'newbasesha123',
            });
          }
        )
      );

      const result = await syncBranch('ws-1', 'session-1', 'rebase');

      expect(capturedBody).toEqual({ operation: 'rebase' });
      expect(result.success).toBe(true);
      expect(result.newBaseSha).toBe('newbasesha123');
    });

    it('returns conflict files on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-sync`,
          () =>
            HttpResponse.json({
              success: false,
              conflictFiles: ['src/conflict.ts', 'src/other.ts'],
              errorMessage: 'merge conflicts',
            })
        )
      );

      const result = await syncBranch('ws-1', 'session-1', 'merge');

      expect(result.success).toBe(false);
      expect(result.conflictFiles).toEqual(['src/conflict.ts', 'src/other.ts']);
      expect(result.errorMessage).toBe('merge conflicts');
    });
  });

  describe('abortBranchSync', () => {
    it('POSTs to /abort and resolves to undefined', async () => {
      let capturedMethod = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-sync/abort`,
          ({ request }) => {
            capturedMethod = request.method;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      const result = await abortBranchSync('ws-1', 'session-1');

      expect(capturedMethod).toBe('POST');
      expect(result).toBeUndefined();
    });

    it('throws ApiError with custom message when abort fails', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-sync/abort`,
          () => HttpResponse.text('', { status: 500 })
        )
      );

      await expect(abortBranchSync('ws-1', 'session-1')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to abort branch sync',
      });
    });
  });
});
