import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listRepos,
  addRepo,
  deleteRepo,
  getRepoDetails,
  updateRepoSettings,
  getRepoRemotes,
  listRepoFiles,
  getRepoFileContent,
  type RepoDTO,
} from '../repositories';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockRepo: RepoDTO = {
  id: 'r-1',
  name: 'claude-code',
  path: '/Users/foo/code',
  branch: 'main',
  remote: 'origin',
  branchPrefix: 'github',
  customPrefix: '',
  createdAt: '2026-04-26T00:00:00Z',
};

describe('lib/api/repositories', () => {
  describe('listRepos', () => {
    it('returns repos', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos`, () => HttpResponse.json([mockRepo]))
      );

      const repos = await listRepos();
      expect(repos).toHaveLength(1);
      expect(repos[0].id).toBe('r-1');
    });
  });

  describe('addRepo', () => {
    it('POSTs path and returns the created repo', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/repos`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(mockRepo);
        })
      );

      const repo = await addRepo('/Users/foo/code');
      expect(capturedBody).toEqual({ path: '/Users/foo/code' });
      expect(repo.id).toBe('r-1');
    });

    it('throws ApiError on backend failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos`, () =>
          HttpResponse.json({ error: 'not a git repo' }, { status: 400 })
        )
      );

      await expect(addRepo('/tmp/not-a-repo')).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('deleteRepo', () => {
    it('DELETEs by id and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/repos/:id`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteRepo('r-1');
      expect(capturedMethod).toBe('DELETE');
    });

    it('throws ApiError with custom message on failure', async () => {
      server.use(
        http.delete(`${API_BASE}/api/repos/:id`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(deleteRepo('r-1')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to delete workspace',
      });
    });
  });

  describe('getRepoDetails', () => {
    it('returns details with optional GitHub fields', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:id/details`, () =>
          HttpResponse.json({
            ...mockRepo,
            remoteUrl: 'https://github.com/anthropics/claude-code.git',
            githubOwner: 'anthropics',
            githubRepo: 'claude-code',
            workspacesPath: '/Users/foo/code/.worktrees',
          })
        )
      );

      const details = await getRepoDetails('r-1');
      expect(details.githubOwner).toBe('anthropics');
      expect(details.workspacesPath).toBe('/Users/foo/code/.worktrees');
    });

    it('returns details without GitHub fields when not a GitHub repo', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:id/details`, () => HttpResponse.json(mockRepo))
      );

      const details = await getRepoDetails('r-1');
      expect(details.githubOwner).toBeUndefined();
      expect(details.remoteUrl).toBeUndefined();
    });
  });

  describe('updateRepoSettings', () => {
    it('PATCHes the settings and returns the updated repo', async () => {
      let capturedBody: unknown;
      server.use(
        http.patch(`${API_BASE}/api/repos/:id`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ ...mockRepo, branchPrefix: 'custom' });
        })
      );

      const updated = await updateRepoSettings('r-1', {
        branchPrefix: 'custom',
        customPrefix: 'jira',
      });

      expect(capturedBody).toEqual({ branchPrefix: 'custom', customPrefix: 'jira' });
      expect(updated.branchPrefix).toBe('custom');
    });
  });

  describe('getRepoRemotes', () => {
    it('returns remotes and per-remote branches', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:id/remotes`, () =>
          HttpResponse.json({
            remotes: ['origin', 'upstream'],
            branches: {
              origin: ['main', 'develop'],
              upstream: ['main'],
            },
          })
        )
      );

      const remotes = await getRepoRemotes('r-1');
      expect(remotes.remotes).toEqual(['origin', 'upstream']);
      expect(remotes.branches.origin).toEqual(['main', 'develop']);
    });
  });

  describe('listRepoFiles', () => {
    it('lists files at default depth=1', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/files`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([
            { name: 'src', path: 'src', isDir: true, children: [] },
          ]);
        })
      );

      const nodes = await listRepoFiles('r-1');
      expect(nodes).toHaveLength(1);
      expect(new URLSearchParams(capturedSearch).get('depth')).toBe('1');
    });

    it("forwards depth='all'", async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/files`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([]);
        })
      );

      await listRepoFiles('r-1', 'all');
      expect(new URLSearchParams(capturedSearch).get('depth')).toBe('all');
    });
  });

  describe('getRepoFileContent', () => {
    it('returns file content', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/file`, () =>
          HttpResponse.json({
            path: 'src/app.tsx',
            name: 'app.tsx',
            content: 'export const x = 1;',
            size: 19,
          })
        )
      );

      const file = await getRepoFileContent('r-1', 'src/app.tsx');
      expect(file.content).toBe('export const x = 1;');
    });

    it('encodes file paths with special characters', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/file`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ path: 'a', name: 'a', content: '', size: 0 });
        })
      );

      await getRepoFileContent('r-1', 'src/foo bar/baz.ts');
      expect(capturedUrl).toContain('path=src%2Ffoo%20bar%2Fbaz.ts');
    });
  });
});
