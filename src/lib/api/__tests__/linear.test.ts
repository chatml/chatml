import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { listMyLinearIssues, searchLinearIssues, type LinearIssueDTO } from '../linear';

const API_BASE = 'http://localhost:9876';

const mockIssue: LinearIssueDTO = {
  id: 'issue-1',
  identifier: 'ENG-42',
  title: 'Add login flow',
  description: 'OAuth login.',
  stateName: 'In Progress',
  labels: ['feature'],
  assignee: 'alice',
  project: 'Authentication',
};

describe('lib/api/linear', () => {
  describe('listMyLinearIssues', () => {
    it('returns assigned issues', async () => {
      server.use(
        http.get(`${API_BASE}/api/auth/linear/issues`, () =>
          HttpResponse.json([mockIssue])
        )
      );

      const issues = await listMyLinearIssues();
      expect(issues).toHaveLength(1);
      expect(issues[0].identifier).toBe('ENG-42');
    });
  });

  describe('searchLinearIssues', () => {
    it('returns matching issues and encodes query', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/auth/linear/issues/search`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([mockIssue]);
        })
      );

      const issues = await searchLinearIssues('login flow');
      expect(issues).toHaveLength(1);
      expect(new URLSearchParams(capturedSearch).get('q')).toBe('login flow');
    });

    it('returns empty array when no matches', async () => {
      server.use(
        http.get(`${API_BASE}/api/auth/linear/issues/search`, () =>
          HttpResponse.json([])
        )
      );

      expect(await searchLinearIssues('nope')).toEqual([]);
    });
  });
});
