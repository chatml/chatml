import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listReviewComments,
  createReviewComment,
  getReviewCommentStats,
  updateReviewComment,
  deleteReviewComment,
} from '../api';

const API_BASE = 'http://localhost:9876';

// ── Test Data ───────────────────────────────────────────────────────────

const mockComment = {
  id: 'comment-1',
  sessionId: 'session-1',
  filePath: 'src/app.tsx',
  lineNumber: 42,
  title: 'Missing null check',
  content: 'This could throw if data is undefined.',
  source: 'claude' as const,
  author: 'Claude',
  severity: 'error' as const,
  createdAt: '2025-01-01T00:00:00Z',
  resolved: false,
};

const mockStats = [
  { filePath: 'src/app.tsx', total: 3, unresolved: 2 },
  { filePath: 'src/lib/utils.ts', total: 1, unresolved: 0 },
];

// ── Tests ───────────────────────────────────────────────────────────────

describe('Review Comment API', () => {
  // ── listReviewComments ───────────────────────────────────────────────

  describe('listReviewComments', () => {
    it('returns comments for a session', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json([mockComment]);
        })
      );

      const comments = await listReviewComments('ws-1', 'session-1');

      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe('comment-1');
      expect(comments[0].title).toBe('Missing null check');
      expect(comments[0].severity).toBe('error');
    });

    it('returns empty array when no comments', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json([]);
        })
      );

      const comments = await listReviewComments('ws-1', 'session-1');
      expect(comments).toHaveLength(0);
    });

    it('passes filePath query parameter when provided', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await listReviewComments('ws-1', 'session-1', 'src/app.tsx');

      expect(capturedUrl).toContain('filePath=src%2Fapp.tsx');
    });

    it('does not include filePath param when not provided', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([]);
        })
      );

      await listReviewComments('ws-1', 'session-1');

      expect(capturedUrl).not.toContain('filePath');
    });

    it('throws on HTTP error', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json({ error: 'Not found' }, { status: 404 });
        })
      );

      await expect(listReviewComments('ws-1', 'session-1')).rejects.toThrow();
    });

    it('throws on server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
        })
      );

      await expect(listReviewComments('ws-1', 'session-1')).rejects.toThrow();
    });
  });

  // ── createReviewComment ──────────────────────────────────────────────

  describe('createReviewComment', () => {
    it('creates a comment with all fields', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json(mockComment);
        })
      );

      const result = await createReviewComment('ws-1', 'session-1', {
        filePath: 'src/app.tsx',
        lineNumber: 42,
        title: 'Missing null check',
        content: 'This could throw if data is undefined.',
        source: 'claude',
        author: 'Claude',
        severity: 'error',
      });

      expect(result.id).toBe('comment-1');
      expect(capturedBody).toMatchObject({
        filePath: 'src/app.tsx',
        lineNumber: 42,
        title: 'Missing null check',
        content: 'This could throw if data is undefined.',
        source: 'claude',
        author: 'Claude',
        severity: 'error',
      });
    });

    it('creates a comment without optional fields', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({ ...mockComment, title: undefined, severity: undefined });
        })
      );

      await createReviewComment('ws-1', 'session-1', {
        filePath: 'src/app.tsx',
        lineNumber: 42,
        content: 'Simple comment.',
        source: 'user',
        author: 'User',
      });

      expect(capturedBody?.filePath).toBe('src/app.tsx');
      expect(capturedBody?.title).toBeUndefined();
      expect(capturedBody?.severity).toBeUndefined();
    });

    it('creates a comment with info severity', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({ ...mockComment, severity: 'info' });
        })
      );

      const result = await createReviewComment('ws-1', 'session-1', {
        filePath: 'src/app.tsx',
        lineNumber: 1,
        content: 'Info note.',
        source: 'claude',
        author: 'Claude',
        severity: 'info',
      });

      expect(capturedBody?.severity).toBe('info');
      expect(result.severity).toBe('info');
    });

    it('throws on validation error', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments`, () => {
          return HttpResponse.json({ error: 'filePath is required' }, { status: 400 });
        })
      );

      await expect(
        createReviewComment('ws-1', 'session-1', {
          filePath: '',
          lineNumber: 0,
          content: 'test',
          source: 'user',
          author: 'User',
        })
      ).rejects.toThrow();
    });
  });

  // ── getReviewCommentStats ────────────────────────────────────────────

  describe('getReviewCommentStats', () => {
    it('returns stats per file', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/stats`, () => {
          return HttpResponse.json(mockStats);
        })
      );

      const stats = await getReviewCommentStats('ws-1', 'session-1');

      expect(stats).toHaveLength(2);
      expect(stats[0].filePath).toBe('src/app.tsx');
      expect(stats[0].total).toBe(3);
      expect(stats[0].unresolved).toBe(2);
      expect(stats[1].filePath).toBe('src/lib/utils.ts');
    });

    it('returns empty array when no comments', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/stats`, () => {
          return HttpResponse.json([]);
        })
      );

      const stats = await getReviewCommentStats('ws-1', 'session-1');
      expect(stats).toHaveLength(0);
    });

    it('throws on server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/stats`, () => {
          return HttpResponse.json({ error: 'Server error' }, { status: 500 });
        })
      );

      await expect(getReviewCommentStats('ws-1', 'session-1')).rejects.toThrow();
    });
  });

  // ── updateReviewComment ──────────────────────────────────────────────

  describe('updateReviewComment', () => {
    it('resolves a comment', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      server.use(
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, async ({ request }) => {
          capturedBody = await request.json() as Record<string, unknown>;
          return HttpResponse.json({ ...mockComment, resolved: true, resolvedBy: 'user' });
        })
      );

      const result = await updateReviewComment('ws-1', 'session-1', 'comment-1', {
        resolved: true,
        resolvedBy: 'user',
      });

      expect(result.resolved).toBe(true);
      expect(result.resolvedBy).toBe('user');
      expect(capturedBody).toMatchObject({ resolved: true, resolvedBy: 'user' });
    });

    it('unresolves a comment', async () => {
      server.use(
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          return HttpResponse.json({ ...mockComment, resolved: false, resolvedBy: '' });
        })
      );

      const result = await updateReviewComment('ws-1', 'session-1', 'comment-1', {
        resolved: false,
      });

      expect(result.resolved).toBe(false);
    });

    it('throws on not found', async () => {
      server.use(
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          return HttpResponse.json({ error: 'Not found' }, { status: 404 });
        })
      );

      await expect(
        updateReviewComment('ws-1', 'session-1', 'nonexistent', { resolved: true })
      ).rejects.toThrow();
    });

    it('uses correct URL with commentId', async () => {
      let capturedUrl = '';
      server.use(
        http.patch(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(mockComment);
        })
      );

      await updateReviewComment('ws-1', 'session-1', 'comment-abc', { resolved: true });

      expect(capturedUrl).toContain('/comments/comment-abc');
    });
  });

  // ── deleteReviewComment ──────────────────────────────────────────────

  describe('deleteReviewComment', () => {
    it('deletes a comment successfully', async () => {
      let deleteCalled = false;
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          deleteCalled = true;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteReviewComment('ws-1', 'session-1', 'comment-1');

      expect(deleteCalled).toBe(true);
    });

    it('throws on not found', async () => {
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          return HttpResponse.json({ error: 'Not found' }, { status: 404 });
        })
      );

      await expect(
        deleteReviewComment('ws-1', 'session-1', 'nonexistent')
      ).rejects.toThrow();
    });

    it('throws on server error', async () => {
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, () => {
          return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
        })
      );

      await expect(
        deleteReviewComment('ws-1', 'session-1', 'comment-1')
      ).rejects.toThrow();
    });

    it('uses correct URL with all path params', async () => {
      let capturedUrl = '';
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/comments/:commentId`, ({ request }) => {
          capturedUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteReviewComment('ws-abc', 'sess-xyz', 'comment-123');

      expect(capturedUrl).toContain('/repos/ws-abc/sessions/sess-xyz/comments/comment-123');
    });
  });
});
