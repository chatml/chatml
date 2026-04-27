import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getSessionChanges,
  getSessionBranchCommits,
  getGitStatus,
  getSessionSnapshot,
  getFileCommitHistory,
  getFileAtCommit,
  type FileChangeDTO,
  type BranchCommitDTO,
  type GitStatusDTO,
  type SessionSnapshotDTO,
  type FileHistoryResponse,
} from '../git';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockChange: FileChangeDTO = {
  path: 'src/app.tsx',
  additions: 5,
  deletions: 2,
  status: 'modified',
};

const mockCommit: BranchCommitDTO = {
  sha: 'abc1234567890def',
  shortSha: 'abc1234',
  message: 'feat: add login flow',
  author: 'Alice',
  email: 'alice@example.com',
  timestamp: '2026-01-15T10:00:00Z',
  files: [mockChange],
};

const mockGitStatus: GitStatusDTO = {
  currentBranch: 'feature/test',
  currentSessionName: 'Test Session',
  workingDirectory: {
    stagedCount: 1,
    unstagedCount: 2,
    untrackedCount: 0,
    totalUncommitted: 3,
    hasChanges: true,
  },
  sync: {
    aheadBy: 2,
    behindBy: 1,
    baseBranch: 'main',
    remoteBranch: 'origin/feature/test',
    hasRemote: true,
    diverged: true,
    unpushedCommits: 2,
  },
  inProgress: { type: 'none' },
  conflicts: { hasConflicts: false, count: 0, files: [] },
  stash: { count: 0 },
};

describe('lib/api/git', () => {
  describe('getSessionChanges', () => {
    it('returns file changes for a session', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/changes`, () => {
          return HttpResponse.json([mockChange]);
        })
      );

      const changes = await getSessionChanges('ws-1', 'session-1');

      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe('src/app.tsx');
      expect(changes[0].status).toBe('modified');
    });

    it('returns empty array when no changes', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/changes`, () => {
          return HttpResponse.json([]);
        })
      );

      const changes = await getSessionChanges('ws-1', 'session-1');
      expect(changes).toEqual([]);
    });

    it('puts workspaceId and sessionId in the URL path', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/changes`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await getSessionChanges('my-workspace', 'sess-42');

      expect(capturedUrl).toBe(`${API_BASE}/api/repos/my-workspace/sessions/sess-42/changes`);
    });

    it('throws ApiError on 404', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/changes`, () => {
          return HttpResponse.json({ error: 'Session not found' }, { status: 404 });
        })
      );

      await expect(getSessionChanges('ws-1', 'missing')).rejects.toBeInstanceOf(ApiError);
      await expect(getSessionChanges('ws-1', 'missing')).rejects.toMatchObject({ status: 404 });
    });

    it('parses backend error code from 4xx JSON body', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/changes`, () => {
          return HttpResponse.json(
            { error: 'Worktree gone', code: 'WORKTREE_NOT_FOUND' },
            { status: 410 }
          );
        })
      );

      await expect(getSessionChanges('ws-1', 'session-1')).rejects.toMatchObject({
        status: 410,
        code: 'WORKTREE_NOT_FOUND',
        message: 'Worktree gone',
      });
    });
  });

  describe('getSessionBranchCommits', () => {
    it('returns commits, branch stats, and allChanges', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-commits`,
          () => {
            return HttpResponse.json({
              commits: [mockCommit],
              branchStats: { totalFiles: 1, totalAdditions: 5, totalDeletions: 2 },
              allChanges: [mockChange],
            });
          }
        )
      );

      const result = await getSessionBranchCommits('ws-1', 'session-1');

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].shortSha).toBe('abc1234');
      expect(result.branchStats?.totalFiles).toBe(1);
      expect(result.allChanges).toHaveLength(1);
    });

    it('handles response with only commits (no branchStats)', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-commits`,
          () => {
            return HttpResponse.json({ commits: [] });
          }
        )
      );

      const result = await getSessionBranchCommits('ws-1', 'session-1');
      expect(result.commits).toEqual([]);
      expect(result.branchStats).toBeUndefined();
      expect(result.allChanges).toBeUndefined();
    });

    it('throws ApiError on 500', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/branch-commits`,
          () => HttpResponse.text('boom', { status: 500 })
        )
      );

      await expect(getSessionBranchCommits('ws-1', 's-1')).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  describe('getGitStatus', () => {
    it('returns full git status', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/git-status`, () => {
          return HttpResponse.json(mockGitStatus);
        })
      );

      const status = await getGitStatus('ws-1', 'session-1');

      expect(status.currentBranch).toBe('feature/test');
      expect(status.workingDirectory.totalUncommitted).toBe(3);
      expect(status.sync.diverged).toBe(true);
      expect(status.conflicts.hasConflicts).toBe(false);
    });

    it('handles in-progress rebase state', async () => {
      const rebasing: GitStatusDTO = {
        ...mockGitStatus,
        inProgress: { type: 'rebase', current: 2, total: 5 },
        conflicts: { hasConflicts: true, count: 1, files: ['src/conflict.ts'] },
      };
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/git-status`, () => {
          return HttpResponse.json(rebasing);
        })
      );

      const status = await getGitStatus('ws-1', 'session-1');
      expect(status.inProgress.type).toBe('rebase');
      expect(status.inProgress.current).toBe(2);
      expect(status.conflicts.files).toEqual(['src/conflict.ts']);
    });
  });

  describe('getSessionSnapshot', () => {
    const mockSnapshot: SessionSnapshotDTO = {
      gitStatus: mockGitStatus,
      changes: [mockChange],
      allChanges: [mockChange],
      commits: [mockCommit],
      branchStats: { totalFiles: 1, totalAdditions: 5, totalDeletions: 2 },
    };

    it('returns consolidated snapshot', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/snapshot`, () => {
          return HttpResponse.json(mockSnapshot);
        })
      );

      const snapshot = await getSessionSnapshot('ws-1', 'session-1');

      expect(snapshot.gitStatus.currentBranch).toBe('feature/test');
      expect(snapshot.changes).toHaveLength(1);
      expect(snapshot.commits).toHaveLength(1);
    });

    it('forwards AbortSignal so callers can cancel', async () => {
      const controller = new AbortController();
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/snapshot`, async () => {
          // Hold the request open until aborted
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json(mockSnapshot);
        })
      );

      const promise = getSessionSnapshot('ws-1', 'session-1', controller.signal);
      controller.abort();

      await expect(promise).rejects.toThrow();
    });

    it('omits signal cleanly when not provided', async () => {
      let receivedRequest: Request | undefined;
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/snapshot`, ({ request }) => {
          receivedRequest = request;
          return HttpResponse.json(mockSnapshot);
        })
      );

      await getSessionSnapshot('ws-1', 'session-1');
      expect(receivedRequest).toBeDefined();
    });
  });

  describe('getFileCommitHistory', () => {
    const mockHistory: FileHistoryResponse = {
      commits: [
        {
          sha: 'def4567890abc123',
          shortSha: 'def4567',
          message: 'fix: edge case',
          author: 'Bob',
          email: 'bob@example.com',
          timestamp: '2026-01-10T09:00:00Z',
          additions: 3,
          deletions: 1,
        },
      ],
      total: 1,
      truncated: false,
    };

    it('returns file commit history', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file-history`,
          () => HttpResponse.json(mockHistory)
        )
      );

      const result = await getFileCommitHistory('ws-1', 'session-1', 'src/app.tsx');

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].shortSha).toBe('def4567');
      expect(result.total).toBe(1);
      expect(result.truncated).toBe(false);
    });

    it('encodes file paths with special characters in the query', async () => {
      let capturedSearch = '';
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file-history`,
          ({ request }) => {
            capturedSearch = new URL(request.url).search;
            return HttpResponse.json(mockHistory);
          }
        )
      );

      await getFileCommitHistory('ws-1', 'session-1', 'src/components/Foo Bar/Baz.tsx');

      // URLSearchParams encodes spaces as '+' and slashes as %2F
      expect(capturedSearch).toContain('path=');
      const params = new URLSearchParams(capturedSearch);
      expect(params.get('path')).toBe('src/components/Foo Bar/Baz.tsx');
    });

    it('reports truncated:true when backend signals truncation', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file-history`,
          () =>
            HttpResponse.json({
              ...mockHistory,
              total: 250,
              truncated: true,
            })
        )
      );

      const result = await getFileCommitHistory('ws-1', 'session-1', 'src/app.tsx');
      expect(result.truncated).toBe(true);
      expect(result.total).toBe(250);
    });
  });

  describe('getFileAtCommit', () => {
    it('returns file content at a given commit', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file-at-ref`,
          () =>
            HttpResponse.json({
              path: 'src/app.tsx',
              name: 'app.tsx',
              content: 'export const x = 1;',
              size: 19,
            })
        )
      );

      const file = await getFileAtCommit('ws-1', 'session-1', 'src/app.tsx', 'abc123');

      expect(file.path).toBe('src/app.tsx');
      expect(file.content).toBe('export const x = 1;');
      expect(file.size).toBe(19);
    });

    it('passes both path and ref query params', async () => {
      let capturedSearch = '';
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file-at-ref`,
          ({ request }) => {
            capturedSearch = new URL(request.url).search;
            return HttpResponse.json({
              path: 'a',
              name: 'a',
              content: '',
              size: 0,
            });
          }
        )
      );

      await getFileAtCommit('ws-1', 'session-1', 'src/lib/x.ts', 'sha-99');

      const params = new URLSearchParams(capturedSearch);
      expect(params.get('path')).toBe('src/lib/x.ts');
      expect(params.get('ref')).toBe('sha-99');
    });

    it('throws ApiError on 404 (commit or file missing)', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file-at-ref`,
          () => HttpResponse.text('not found', { status: 404 })
        )
      );

      await expect(
        getFileAtCommit('ws-1', 'session-1', 'src/missing.ts', 'sha')
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
