import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  toStoreConversation,
  toStoreMessage,
  listConversations,
  listWorkspaceConversations,
  getConversation,
  getConversationMessages,
  getMessage,
  sendConversationMessage,
  addSystemMessage,
  stopConversation,
  stopBackgroundTask,
  getConversationDropStats,
  getActiveStreamingConversations,
  getStreamingSnapshot,
  getInterruptedConversations,
  resumeAgent,
  clearConversationSnapshot,
  deleteConversation,
  setConversationFastMode,
  setConversationMaxThinkingTokens,
  approveTool,
  approveBatchTools,
  answerQAHandoff,
  type ConversationDTO,
  type MessageDTO,
} from '../conversations';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockMessage: MessageDTO = {
  id: 'msg-1',
  role: 'user',
  content: 'Hello',
  timestamp: '2026-04-26T00:00:00Z',
  attachments: [
    // 'text/x-typescript' (or 'application/typescript') is closer to the
    // unregistered-but-conventional MIME for .ts files. The field isn't
    // parsed by the API client — the value is just round-tripped — but
    // keeping the fixture conventional avoids it becoming a copy-paste
    // template for less informed tests.
    { id: 'att-1', type: 'file', name: 'a.ts', mimeType: 'text/x-typescript', size: 100 },
  ],
  toolUsage: [{ id: 't-1', tool: 'Read', success: true }],
  thinkingContent: 'Considering...',
  durationMs: 1500,
  timeline: [{ type: 'text', content: 'Hello' }],
  planContent: 'Plan A',
  checkpointUuid: 'ck-1',
  embeddedInTimeline: true,
};

const mockConversation: ConversationDTO = {
  id: 'conv-1',
  sessionId: 'session-1',
  type: 'task',
  name: 'Test',
  status: 'active',
  model: 'claude-sonnet-4-6',
  messages: [mockMessage],
  messageCount: 1,
  toolSummary: [{ id: 't-1', tool: 'Read', target: 'a.ts', success: true }],
  createdAt: '2026-04-26T00:00:00Z',
  updatedAt: '2026-04-26T01:00:00Z',
};

describe('lib/api/conversations', () => {
  describe('toStoreConversation', () => {
    it('maps DTO to store shape with messages and toolSummary', () => {
      const result = toStoreConversation(mockConversation);
      expect(result.id).toBe('conv-1');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].conversationId).toBe('conv-1');
      expect(result.toolSummary).toHaveLength(1);
      expect(result.toolSummary[0].target).toBe('a.ts');
    });

    it('handles missing messages and toolSummary defensively', () => {
      const dto = { ...mockConversation, messages: undefined, toolSummary: undefined } as unknown as ConversationDTO;
      const result = toStoreConversation(dto);
      expect(result.messages).toEqual([]);
      expect(result.toolSummary).toEqual([]);
    });
  });

  describe('toStoreMessage', () => {
    it('maps message DTO with conversationId injected', () => {
      const result = toStoreMessage(mockMessage, 'conv-99');
      expect(result.id).toBe('msg-1');
      expect(result.conversationId).toBe('conv-99');
      expect(result.thinkingContent).toBe('Considering...');
      expect(result.embeddedInTimeline).toBe(true);
    });

    it('respects compacted opt when provided', () => {
      const result = toStoreMessage(mockMessage, 'conv-1', { compacted: true });
      expect(result.compacted).toBe(true);
    });

    it('compacted defaults to undefined when opts omitted', () => {
      const result = toStoreMessage(mockMessage, 'conv-1');
      expect(result.compacted).toBeUndefined();
    });
  });

  describe('listConversations', () => {
    it('returns conversations for a session', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/conversations`,
          () => HttpResponse.json([mockConversation])
        )
      );

      const convs = await listConversations('ws-1', 'session-1');
      expect(convs).toHaveLength(1);
    });
  });

  describe('listWorkspaceConversations', () => {
    it('returns conversations for a workspace', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/conversations`, () =>
          HttpResponse.json([mockConversation])
        )
      );

      const convs = await listWorkspaceConversations('ws-1');
      expect(convs).toHaveLength(1);
    });
  });

  describe('getConversation', () => {
    it('returns single conversation by id', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId`, () =>
          HttpResponse.json(mockConversation)
        )
      );

      const conv = await getConversation('conv-1');
      expect(conv.id).toBe('conv-1');
    });
  });

  describe('getConversationMessages', () => {
    it('returns messages with no params', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/messages`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({ messages: [mockMessage], hasMore: false, totalCount: 1 });
        })
      );

      const page = await getConversationMessages('conv-1');
      expect(page.messages).toHaveLength(1);
      expect(capturedSearch).toBe('');
    });

    it('serializes before, limit, and compact mode', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/messages`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({ messages: [], hasMore: true, totalCount: 100 });
        })
      );

      await getConversationMessages('conv-1', { before: 50, limit: 25, compact: true });
      const params = new URLSearchParams(capturedSearch);
      expect(params.get('before')).toBe('50');
      expect(params.get('limit')).toBe('25');
      expect(params.get('mode')).toBe('compact');
    });

    it('does not include mode=compact when compact:false', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/messages`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json({ messages: [], hasMore: false, totalCount: 0 });
        })
      );

      await getConversationMessages('conv-1', { compact: false });
      expect(new URLSearchParams(capturedSearch).has('mode')).toBe(false);
    });

    it('forwards AbortSignal', async () => {
      // Abort BEFORE invoking the API so the implementation sees an
      // already-aborted signal — no real-time race against MSW.
      const controller = new AbortController();
      controller.abort();
      await expect(
        getConversationMessages('conv-1', { signal: controller.signal })
      ).rejects.toThrow();
    });
  });

  describe('getMessage', () => {
    it('returns single message', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/messages/:msgId`, () =>
          HttpResponse.json(mockMessage)
        )
      );

      const msg = await getMessage('conv-1', 'msg-1');
      expect(msg.id).toBe('msg-1');
    });
  });

  describe('sendConversationMessage', () => {
    it('POSTs content alone when no options', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/messages`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await sendConversationMessage('conv-1', 'hello');
      expect(capturedBody).toEqual({ content: 'hello' });
    });

    it('spreads options into body', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/messages`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await sendConversationMessage('conv-1', 'hi', {
        model: 'claude-haiku-4-5',
        planMode: true,
        mentionedFiles: ['a.ts'],
        messageUuid: 'msg-uuid',
      });
      expect(capturedBody).toEqual({
        content: 'hi',
        model: 'claude-haiku-4-5',
        planMode: true,
        mentionedFiles: ['a.ts'],
        messageUuid: 'msg-uuid',
      });
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/messages`, () =>
          HttpResponse.text('busy', { status: 503 })
        )
      );

      await expect(sendConversationMessage('conv-1', 'hi')).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('addSystemMessage', () => {
    it('POSTs content and returns id', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/system-message`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ id: 'sys-msg-1' });
        })
      );

      const result = await addSystemMessage('conv-1', 'system note');
      expect(capturedBody).toEqual({ content: 'system note' });
      expect(result.id).toBe('sys-msg-1');
    });
  });

  describe('stopConversation', () => {
    it('POSTs to /stop and resolves', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/stop`, () =>
          new HttpResponse(null, { status: 204 })
        )
      );

      await expect(stopConversation('conv-1')).resolves.toBeUndefined();
    });

    it('throws ApiError with stop message on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/stop`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(stopConversation('conv-1')).rejects.toMatchObject({
        message: 'Failed to stop conversation',
      });
    });
  });

  describe('stopBackgroundTask', () => {
    it('POSTs to /tasks/:id/stop', async () => {
      let capturedUrl = '';
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/tasks/:taskId/stop`, ({ request }) => {
          capturedUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await stopBackgroundTask('conv-1', 'task-99');
      expect(capturedUrl).toContain('/tasks/task-99/stop');
    });
  });

  describe('getConversationDropStats', () => {
    it('returns droppedMessages count', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/drop-stats`, () =>
          HttpResponse.json({ droppedMessages: 5 })
        )
      );

      const result = await getConversationDropStats('conv-1');
      expect(result.droppedMessages).toBe(5);
    });
  });

  describe('getActiveStreamingConversations', () => {
    it('returns conversation ids', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/active-streaming`, () =>
          HttpResponse.json({ conversationIds: ['conv-1', 'conv-2'] })
        )
      );

      const result = await getActiveStreamingConversations();
      expect(result.conversationIds).toEqual(['conv-1', 'conv-2']);
    });
  });

  describe('getStreamingSnapshot', () => {
    it('returns snapshot when present', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/:convId/streaming-snapshot`, () =>
          HttpResponse.json({
            text: 'streaming...',
            activeTools: [],
            isThinking: false,
            planModeActive: false,
          })
        )
      );

      const snapshot = await getStreamingSnapshot('conv-1');
      expect(snapshot?.text).toBe('streaming...');
    });
  });

  describe('getInterruptedConversations', () => {
    it('returns interrupted conversations list', async () => {
      server.use(
        http.get(`${API_BASE}/api/conversations/interrupted`, () =>
          HttpResponse.json([
            {
              id: 'conv-1',
              sessionId: 'session-1',
              agentSessionId: 'agent-session-1',
              snapshot: null,
            },
          ])
        )
      );

      const result = await getInterruptedConversations();
      expect(result).toHaveLength(1);
      expect(result[0].agentSessionId).toBe('agent-session-1');
    });
  });

  describe('resumeAgent', () => {
    it('POSTs and returns status', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/resume-agent`, () =>
          HttpResponse.json({ status: 'resumed' })
        )
      );

      const result = await resumeAgent('conv-1');
      expect(result.status).toBe('resumed');
    });
  });

  describe('clearConversationSnapshot', () => {
    it('POSTs and resolves', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/clear-snapshot`, () =>
          new HttpResponse(null, { status: 204 })
        )
      );

      await expect(clearConversationSnapshot('conv-1')).resolves.toBeUndefined();
    });

    it('throws ApiError with custom message on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/clear-snapshot`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(clearConversationSnapshot('conv-1')).rejects.toMatchObject({
        message: 'Failed to clear snapshot',
      });
    });
  });

  describe('deleteConversation', () => {
    it('DELETEs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/conversations/:convId`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteConversation('conv-1');
      expect(capturedMethod).toBe('DELETE');
    });
  });

  describe('setConversationFastMode', () => {
    it('POSTs enabled flag', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/fast-mode`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setConversationFastMode('conv-1', true);
      expect(capturedBody).toEqual({ enabled: true });
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/fast-mode`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(setConversationFastMode('conv-1', true)).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('setConversationMaxThinkingTokens', () => {
    it('POSTs maxThinkingTokens value', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/conversations/:convId/max-thinking-tokens`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await setConversationMaxThinkingTokens('conv-1', 8000);
      expect(capturedBody).toEqual({ maxThinkingTokens: 8000 });
    });
  });

  describe('approveTool', () => {
    it('POSTs requestId + action', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/approve-tool`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await approveTool('conv-1', 'req-1', 'allow_once');
      expect(capturedBody).toEqual({ requestId: 'req-1', action: 'allow_once' });
    });

    it('includes specifier and updatedInput when provided', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/approve-tool`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await approveTool('conv-1', 'req-1', 'allow_session', 'pattern:*', { foo: 'bar' });
      expect(capturedBody).toEqual({
        requestId: 'req-1',
        action: 'allow_session',
        specifier: 'pattern:*',
        updatedInput: { foo: 'bar' },
      });
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/approve-tool`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(approveTool('conv-1', 'req-1', 'deny_once')).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('approveBatchTools', () => {
    it('POSTs without perTool when not provided', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/conversations/:convId/approve-batch-tools`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await approveBatchTools('conv-1', 'req-1', 'allow_once');
      expect(capturedBody).toEqual({ requestId: 'req-1', action: 'allow_once' });
    });

    it('includes perTool overrides when provided', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/conversations/:convId/approve-batch-tools`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await approveBatchTools('conv-1', 'req-1', 'allow_once', {
        Read: { action: 'allow_session', specifier: 'src/*' },
      });
      expect(capturedBody).toEqual({
        requestId: 'req-1',
        action: 'allow_once',
        perTool: { Read: { action: 'allow_session', specifier: 'src/*' } },
      });
    });
  });

  describe('answerQAHandoff', () => {
    it('POSTs requestId + completed + notes', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/conversations/:convId/answer-qa-handoff`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await answerQAHandoff('conv-1', 'req-1', true, 'all good');
      expect(capturedBody).toEqual({
        requestId: 'req-1',
        completed: true,
        notes: 'all good',
      });
    });

    it('omits the notes key from the wire body when not provided', async () => {
      // JSON.stringify drops `undefined` values, so passing `notes: undefined`
      // results in the key being absent from the encoded body. Pin the exact
      // shape so a future refactor that swaps in a default (empty string,
      // null, etc.) doesn't silently change the wire contract.
      let capturedBody: Record<string, unknown> | undefined;
      server.use(
        http.post(
          `${API_BASE}/api/conversations/:convId/answer-qa-handoff`,
          async ({ request }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await answerQAHandoff('conv-1', 'req-1', false);
      expect(capturedBody).toEqual({ requestId: 'req-1', completed: false });
      expect(
        Object.prototype.hasOwnProperty.call(capturedBody!, 'notes'),
      ).toBe(false);
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/conversations/:convId/answer-qa-handoff`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(answerQAHandoff('conv-1', 'req-1', true)).rejects.toBeInstanceOf(ApiError);
    });
  });
});
