import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  generateSummary,
  getConversationSummary,
  listSessionSummaries,
  type SummaryDTO,
} from '../summaries';

const API_BASE = 'http://localhost:9876';

const mockSummary: SummaryDTO = {
  id: 'sum-1',
  conversationId: 'conv-1',
  sessionId: 'session-1',
  conversationName: 'Login flow',
  content: 'Implemented OAuth login with Google.',
  status: 'completed',
  messageCount: 24,
  createdAt: '2026-04-26T00:00:00Z',
};

describe('lib/api/summaries', () => {
  describe('generateSummary', () => {
    it('POSTs to conversation summary endpoint and returns generated summary', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/summary`, ({ request }) => {
          capturedMethod = request.method;
          return HttpResponse.json({ ...mockSummary, status: 'generating' });
        })
      );

      const summary = await generateSummary('conv-1');
      expect(capturedMethod).toBe('POST');
      expect(summary.status).toBe('generating');
    });
  });

  describe('getConversationSummary', () => {
    it('returns existing summary', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/summary`, () =>
          HttpResponse.json(mockSummary)
        )
      );

      const summary = await getConversationSummary('conv-1');
      expect(summary?.content).toContain('OAuth');
    });

    it('returns null on 404 (no summary yet)', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/summary`, () =>
          HttpResponse.text('', { status: 404 })
        )
      );

      const summary = await getConversationSummary('conv-1');
      expect(summary).toBeNull();
    });

    it('throws ApiError on 500 (not silently returns null)', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/summary`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(getConversationSummary('conv-1')).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('listSessionSummaries', () => {
    it('returns summaries for a session', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/summaries`,
          () => HttpResponse.json([mockSummary])
        )
      );

      const summaries = await listSessionSummaries('ws-1', 'session-1');
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe('sum-1');
    });

    it('returns empty array when no summaries exist', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/summaries`,
          () => HttpResponse.json([])
        )
      );

      expect(await listSessionSummaries('ws-1', 'session-1')).toEqual([]);
    });
  });
});
