import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { answerConversationQuestion } from '../api';

const API_BASE = 'http://localhost:9876';

// Track what the mock receives
let lastRequestBody: { requestId: string; answers: Record<string, string> } | null = null;
let lastConvId: string | null = null;

beforeEach(() => {
  lastRequestBody = null;
  lastConvId = null;

  // Register the answer-question handler for each test
  server.use(
    http.post(`${API_BASE}/api/conversations/:convId/answer-question`, async ({ request, params }) => {
      lastConvId = params.convId as string;
      lastRequestBody = await request.json() as { requestId: string; answers: Record<string, string> };
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

describe('answerConversationQuestion', () => {
  it('sends POST with correct conversationId, requestId, and answers', async () => {
    await answerConversationQuestion('conv-123', 'req-456', { Framework: 'React' });

    expect(lastConvId).toBe('conv-123');
    expect(lastRequestBody).toEqual({
      requestId: 'req-456',
      answers: { Framework: 'React' },
    });
  });

  it('sends multiple answers for multi-question wizard', async () => {
    const answers = {
      Framework: 'React',
      Database: 'PostgreSQL',
      Hosting: 'Vercel',
    };
    await answerConversationQuestion('conv-1', 'req-1', answers);

    expect(lastRequestBody).toEqual({
      requestId: 'req-1',
      answers,
    });
  });

  it('sends comma-separated values for multi-select answers', async () => {
    await answerConversationQuestion('conv-1', 'req-1', {
      Languages: 'TypeScript,Go,Rust',
    });

    expect(lastRequestBody?.answers['Languages']).toBe('TypeScript,Go,Rust');
  });

  it('sends __cancelled marker for dismiss flow', async () => {
    await answerConversationQuestion('conv-1', 'req-1', { __cancelled: 'true' });

    expect(lastRequestBody).toEqual({
      requestId: 'req-1',
      answers: { __cancelled: 'true' },
    });
  });

  it('throws on 404 (no active process)', async () => {
    server.use(
      http.post(`${API_BASE}/api/conversations/:convId/answer-question`, () => {
        return HttpResponse.json({ error: 'No active process' }, { status: 404 });
      }),
    );

    await expect(
      answerConversationQuestion('conv-1', 'req-1', { Framework: 'React' }),
    ).rejects.toThrow();
  });

  it('throws on 500 server error', async () => {
    server.use(
      http.post(`${API_BASE}/api/conversations/:convId/answer-question`, () => {
        return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
      }),
    );

    await expect(
      answerConversationQuestion('conv-1', 'req-1', { Framework: 'React' }),
    ).rejects.toThrow();
  });
});
