import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listGitHubIssues,
  searchGitHubIssues,
  getGitHubIssueDetails,
  listGitHubRepos,
  listGitHubOrgs,
  resolveGitHubRepo,
  cloneRepo,
  type GitHubIssueListItem,
  type GitHubRepoDTO,
} from '../github';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockIssue: GitHubIssueListItem = {
  number: 42,
  title: 'Add login flow',
  state: 'open',
  htmlUrl: 'https://github.com/x/y/issues/42',
  labels: [{ name: 'enhancement', color: '00ff00' }],
  user: { login: 'alice', avatarUrl: 'https://avatars/alice' },
  assignees: [{ login: 'bob', avatarUrl: 'https://avatars/bob' }],
  comments: 3,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-04-26T00:00:00Z',
};

const mockRepo: GitHubRepoDTO = {
  fullName: 'anthropics/claude-code',
  name: 'claude-code',
  owner: 'anthropics',
  description: 'AI coding assistant',
  language: 'TypeScript',
  private: false,
  fork: false,
  stargazersCount: 1000,
  cloneUrl: 'https://github.com/anthropics/claude-code.git',
  sshUrl: 'git@github.com:anthropics/claude-code.git',
  updatedAt: '2026-04-26T00:00:00Z',
  defaultBranch: 'main',
};

describe('lib/api/github', () => {
  describe('listGitHubIssues', () => {
    it('returns issues for a workspace', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/issues`, () =>
          HttpResponse.json([mockIssue])
        )
      );

      const issues = await listGitHubIssues('ws-1');
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(42);
      expect(issues[0].labels[0].name).toBe('enhancement');
    });
  });

  describe('searchGitHubIssues', () => {
    it('returns search results with totalCount', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/issues/search`, () =>
          HttpResponse.json({ totalCount: 1, issues: [mockIssue] })
        )
      );

      const result = await searchGitHubIssues('ws-1', 'login');
      expect(result.totalCount).toBe(1);
      expect(result.issues).toHaveLength(1);
    });

    it('encodes query param with special characters', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/issues/search`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({ totalCount: 0, issues: [] });
        })
      );

      await searchGitHubIssues('ws-1', 'is:open label:bug');
      expect(capturedSearch).toContain('q=is%3Aopen%20label%3Abug');
    });
  });

  describe('getGitHubIssueDetails', () => {
    it('returns issue details with body', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/issues/:issueNumber`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({
            ...mockIssue,
            body: 'Detailed description of the issue.',
            milestone: { title: 'v1.0', number: 5 },
          });
        })
      );

      const details = await getGitHubIssueDetails('ws-1', 42);

      expect(capturedUrl).toContain('/issues/42');
      expect(details.body).toContain('Detailed');
      expect(details.milestone?.title).toBe('v1.0');
    });
  });

  describe('listGitHubRepos', () => {
    it('returns repos with no params (no query string)', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/github/repos`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ repos: [mockRepo], totalCount: 1, hasMore: false });
        })
      );

      const result = await listGitHubRepos();
      expect(result.repos).toHaveLength(1);
      expect(capturedUrl).toBe(`${API_BASE}/api/github/repos`);
    });

    it('serializes all supported params, including snake_case per_page', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/github/repos`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({ repos: [], totalCount: 0, hasMore: false });
        })
      );

      await listGitHubRepos({
        page: 2,
        perPage: 50,
        sort: 'updated',
        search: 'claude',
        org: 'anthropics',
        type: 'all',
      });

      const params = new URLSearchParams(capturedSearch);
      expect(params.get('page')).toBe('2');
      expect(params.get('per_page')).toBe('50');
      expect(params.get('sort')).toBe('updated');
      expect(params.get('search')).toBe('claude');
      expect(params.get('org')).toBe('anthropics');
      expect(params.get('type')).toBe('all');
    });

    it('forwards AbortSignal', async () => {
      const controller = new AbortController();
      server.use(
        http.get(`${API_BASE}/api/github/repos`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json({ repos: [], totalCount: 0, hasMore: false });
        })
      );

      const promise = listGitHubRepos({ signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow();
    });
  });

  describe('listGitHubOrgs', () => {
    it('returns orgs', async () => {
      server.use(
        http.get(`${API_BASE}/api/github/orgs`, () =>
          HttpResponse.json([{ login: 'anthropics', avatarUrl: 'https://avatars/anthropics' }])
        )
      );

      const orgs = await listGitHubOrgs();
      expect(orgs).toHaveLength(1);
      expect(orgs[0].login).toBe('anthropics');
    });
  });

  describe('resolveGitHubRepo', () => {
    it('POSTs URL and returns repo info', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/github/resolve-repo`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(mockRepo);
        })
      );

      const repo = await resolveGitHubRepo('https://github.com/anthropics/claude-code');
      expect(capturedBody).toEqual({ url: 'https://github.com/anthropics/claude-code' });
      expect(repo.fullName).toBe('anthropics/claude-code');
    });

    it('throws ApiError when repo URL is invalid', async () => {
      server.use(
        http.post(`${API_BASE}/api/github/resolve-repo`, () =>
          HttpResponse.json({ error: 'invalid url' }, { status: 400 })
        )
      );

      await expect(resolveGitHubRepo('garbage')).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('cloneRepo', () => {
    it('POSTs url + path + dirName and returns clone result', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/clone`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({
            path: '/Users/foo/projects/claude-code',
            repo: {
              id: 'r-1',
              name: 'claude-code',
              path: '/Users/foo/projects/claude-code',
              branch: 'main',
              remote: 'origin',
              branchPrefix: 'github',
              customPrefix: '',
              createdAt: '2026-04-26T00:00:00Z',
            },
          });
        })
      );

      const result = await cloneRepo(
        'https://github.com/anthropics/claude-code.git',
        '/Users/foo/projects',
        'claude-code'
      );

      expect(capturedBody).toEqual({
        url: 'https://github.com/anthropics/claude-code.git',
        path: '/Users/foo/projects',
        dirName: 'claude-code',
      });
      expect(result.path).toBe('/Users/foo/projects/claude-code');
      expect(result.repo.id).toBe('r-1');
    });
  });
});
