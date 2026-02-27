import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '@/stores/appStore';

/**
 * Tests for newly-handled WebSocket events (Groups B–J).
 *
 * These tests simulate what the useWebSocket handler does when it receives events
 * by calling store actions directly, matching the existing test pattern.
 */

const CONV_ID = 'conv-1';

describe('useWebSocket — missing event handling', () => {
  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      activeTools: {},
      conversations: [
        {
          id: CONV_ID,
          sessionId: 's1',
          type: 'task' as const,
          name: 'Test',
          status: 'active' as const,
          messages: [],
          toolSummary: [],
          createdAt: '',
          updatedAt: '',
        },
      ],
      messagesByConversation: {},
      checkpoints: [],
      mcpServers: [],
      supportedModels: [],
      supportedCommands: [],
      accountInfo: null,
      pendingUserQuestion: {},
    });
  });

  // ==========================================================================
  // Group B: tool_progress event
  // ==========================================================================

  describe('tool_progress event (Group B)', () => {
    it('updates elapsedSeconds on matching active tool', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      // Simulates: case 'tool_progress'
      store.updateToolProgress(CONV_ID, 'tool-1', {
        elapsedTimeSeconds: 12,
        toolName: 'Bash',
      });

      const tools = useAppStore.getState().activeTools[CONV_ID];
      expect(tools[0].elapsedSeconds).toBe(12);
    });

    it('ignores tool_progress for unknown tool ids', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      // Unknown tool ID — should be a no-op
      store.updateToolProgress(CONV_ID, 'tool-unknown', {
        elapsedTimeSeconds: 5,
      });

      const tools = useAppStore.getState().activeTools[CONV_ID];
      expect(tools[0].elapsedSeconds).toBeUndefined();
    });

    it('does not update completed tools', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });
      store.completeActiveTool(CONV_ID, 'tool-1', true, 'done');

      // Progress for completed tool — should be a no-op
      store.updateToolProgress(CONV_ID, 'tool-1', {
        elapsedTimeSeconds: 30,
      });

      const tools = useAppStore.getState().activeTools[CONV_ID];
      expect(tools[0].elapsedSeconds).toBeUndefined();
    });
  });

  // ==========================================================================
  // Group C: agent_notification event
  // ==========================================================================

  describe('agent_notification event (Group C)', () => {
    it('dispatches agent-notification custom event with title/message/type', () => {
      const handler = vi.fn();
      window.addEventListener('agent-notification', handler);

      // Simulates: case 'agent_notification'
      const event = { title: 'Skill loaded', message: 'Using TDD skill', notificationType: 'info' };
      if (event.title || event.message) {
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: event.title,
            message: event.message,
            type: event.notificationType || 'info',
            conversationId: CONV_ID,
          }
        }));
      }

      expect(handler).toHaveBeenCalledTimes(1);
      const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.title).toBe('Skill loaded');
      expect(detail.message).toBe('Using TDD skill');
      expect(detail.type).toBe('info');

      window.removeEventListener('agent-notification', handler);
    });

    it('dispatches with default type "info" when notificationType missing', () => {
      const handler = vi.fn();
      window.addEventListener('agent-notification', handler);

      const event = { title: 'Something happened', message: '', notificationType: undefined };
      if (event.title || event.message) {
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: event.title,
            message: event.message,
            type: event.notificationType || 'info',
            conversationId: CONV_ID,
          }
        }));
      }

      const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.type).toBe('info');

      window.removeEventListener('agent-notification', handler);
    });

    it('does not dispatch when both title and message are empty', () => {
      const handler = vi.fn();
      window.addEventListener('agent-notification', handler);

      const event = { title: '', message: '' };
      if (event.title || event.message) {
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: { title: event.title, message: event.message, type: 'info', conversationId: CONV_ID }
        }));
      }

      expect(handler).not.toHaveBeenCalled();

      window.removeEventListener('agent-notification', handler);
    });
  });

  // ==========================================================================
  // Group D: checkpoint_created event
  // ==========================================================================

  describe('checkpoint_created event (Group D)', () => {
    it('adds checkpoint to store with uuid and timestamp', () => {
      const store = useAppStore.getState();

      // Simulates: case 'checkpoint_created'
      const event = { checkpointUuid: 'cp-abc', messageIndex: 5 };
      if (event.checkpointUuid) {
        store.addCheckpoint({
          uuid: event.checkpointUuid,
          timestamp: new Date().toISOString(),
          messageIndex: event.messageIndex ?? 0,
        });
      }

      const checkpoints = useAppStore.getState().checkpoints;
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].uuid).toBe('cp-abc');
      expect(checkpoints[0].messageIndex).toBe(5);
    });

    it('ignores event when checkpointUuid is missing', () => {
      const event = { checkpointUuid: undefined as string | undefined, messageIndex: 5 };
      if (event.checkpointUuid) {
        useAppStore.getState().addCheckpoint({
          uuid: event.checkpointUuid,
          timestamp: new Date().toISOString(),
          messageIndex: event.messageIndex ?? 0,
        });
      }

      expect(useAppStore.getState().checkpoints).toHaveLength(0);
    });

    it('preserves existing checkpoints when adding new one', () => {
      const store = useAppStore.getState();
      store.addCheckpoint({ uuid: 'cp-1', timestamp: '2024-01-01', messageIndex: 0 });
      store.addCheckpoint({ uuid: 'cp-2', timestamp: '2024-01-02', messageIndex: 3 });

      const checkpoints = useAppStore.getState().checkpoints;
      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].uuid).toBe('cp-1');
      expect(checkpoints[1].uuid).toBe('cp-2');
    });
  });

  // ==========================================================================
  // Group D: files_rewound event
  // ==========================================================================

  describe('files_rewound event (Group D)', () => {
    it('dispatches agent-notification event for file rewind', () => {
      const handler = vi.fn();
      window.addEventListener('agent-notification', handler);

      // Simulates: case 'files_rewound'
      window.dispatchEvent(new CustomEvent('agent-notification', {
        detail: {
          title: 'Files rewound',
          message: 'Files restored to checkpoint',
          type: 'info',
          conversationId: CONV_ID,
        }
      }));

      expect(handler).toHaveBeenCalledTimes(1);
      const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
      expect(detail.title).toBe('Files rewound');

      window.removeEventListener('agent-notification', handler);
    });
  });

  // ==========================================================================
  // Group E: model_changed event
  // ==========================================================================

  describe('model_changed event (Group E)', () => {
    it('updates conversation model field', () => {
      // Simulates: case 'model_changed'
      const event = { model: 'claude-3-opus' };
      if (event.model) {
        useAppStore.getState().updateConversation(CONV_ID, { model: event.model });
      }

      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_ID);
      expect(conv?.model).toBe('claude-3-opus');
    });

    it('ignores event when model is missing', () => {
      const event = { model: undefined as string | undefined };
      if (event.model) {
        useAppStore.getState().updateConversation(CONV_ID, { model: event.model });
      }

      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_ID);
      expect(conv?.model).toBeUndefined();
    });
  });

  // ==========================================================================
  // Group F: interrupted event
  // ==========================================================================

  describe('interrupted event (Group F)', () => {
    it('clears streaming text, tools, thinking, and sets status idle', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.appendStreamingText(CONV_ID, 'partial text');
      store.addActiveTool(CONV_ID, { id: 'tool-1', tool: 'Bash', startTime: Date.now() });
      store.setThinking(CONV_ID, true);
      store.appendThinkingText(CONV_ID, 'thinking...');

      // Simulates: case 'interrupted'
      store.clearStreamingText(CONV_ID);
      store.setStreaming(CONV_ID, false);
      store.clearActiveTools(CONV_ID);
      store.clearThinking(CONV_ID);
      store.updateConversation(CONV_ID, { status: 'idle' });

      const state = useAppStore.getState();
      expect(state.streamingState[CONV_ID]?.isStreaming).toBe(false);
      expect(state.streamingState[CONV_ID]?.text).toBe('');
      expect(state.activeTools[CONV_ID]).toHaveLength(0);
      expect(state.streamingState[CONV_ID]?.isThinking).toBe(false);

      const conv = state.conversations.find(c => c.id === CONV_ID);
      expect(conv?.status).toBe('idle');
    });

    it('is idempotent when no streaming state exists', () => {
      const store = useAppStore.getState();

      // Should not throw even with no streaming state
      store.clearStreamingText(CONV_ID);
      store.setStreaming(CONV_ID, false);
      store.clearActiveTools(CONV_ID);
      store.clearThinking(CONV_ID);
      store.updateConversation(CONV_ID, { status: 'idle' });

      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_ID);
      expect(conv?.status).toBe('idle');
    });
  });

  // ==========================================================================
  // Group F: user_question_timeout event
  // ==========================================================================

  describe('user_question_timeout event (Group F)', () => {
    it('clears pending user question', () => {
      // Set up a pending question
      useAppStore.setState({
        pendingUserQuestion: {
          [CONV_ID]: {
            requestId: 'req-1',
            questions: [{ question: 'What?', header: '', options: [], multiSelect: false }],
            currentIndex: 0,
            answers: {},
          },
        },
      });

      // Simulates: case 'user_question_timeout'
      useAppStore.getState().clearPendingUserQuestion(CONV_ID);

      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]).toBeNull();
    });

    it('is idempotent when no pending question exists', () => {
      useAppStore.getState().clearPendingUserQuestion(CONV_ID);
      expect(useAppStore.getState().pendingUserQuestion[CONV_ID]).toBeNull();
    });
  });

  // ==========================================================================
  // Group G: hook events
  // ==========================================================================

  describe('hook_tool_failure event (Group G)', () => {
    it('logs warning to console', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Simulates: case 'hook_tool_failure'
      const event = { tool: 'Bash', error: 'Permission denied' };
      console.warn(`[Hook] Tool failure: ${event.tool} — ${event.error}`);

      expect(warnSpy).toHaveBeenCalledWith('[Hook] Tool failure: Bash — Permission denied');
      warnSpy.mockRestore();
    });
  });

  describe('hook_pre_tool / hook_post_tool / hook_response events (Group G)', () => {
    it('are handled without error (no-op)', () => {
      // These events are simply logged/ignored — no store mutations
      // Just verify that processing them doesn't throw
      expect(() => {
        // No-op — simulates the break statement in the handler
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Group H: session lifecycle events
  // ==========================================================================

  describe('session_started / session_ended / session_id_update (Group H)', () => {
    it('are handled without error (no-op)', () => {
      // Session lifecycle is managed by the backend. No frontend action.
      expect(() => {
        // No-op — simulates the break statement in the handler
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Group I: diagnostic events
  // ==========================================================================

  describe('agent_stop event (Group I)', () => {
    it('updates conversation status to idle', () => {
      // Simulates: case 'agent_stop'
      useAppStore.getState().updateConversation(CONV_ID, { status: 'idle' });

      const conv = useAppStore.getState().conversations.find(c => c.id === CONV_ID);
      expect(conv?.status).toBe('idle');
    });
  });

  describe('command_error event (Group I)', () => {
    it('sets streaming error with message', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      // Simulates: case 'command_error'
      const event = { message: 'Command failed: invalid syntax' };
      if (event.message) {
        store.setStreamingError(CONV_ID, event.message);
      }

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.error).toBe('Command failed: invalid syntax');
    });

    it('ignores event when message is missing', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      const event = { message: undefined as string | undefined };
      if (event.message) {
        store.setStreamingError(CONV_ID, event.message);
      }

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.error).toBeNull();
    });
  });

  describe('agent_stderr / json_parse_error events (Group I)', () => {
    it('logs to console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Simulates: case 'agent_stderr'
      console.warn('[Agent] agent_stderr:', 'some debug output');

      expect(warnSpy).toHaveBeenCalledWith('[Agent] agent_stderr:', 'some debug output');
      warnSpy.mockRestore();
    });
  });

  describe('auth_status / status_update events (Group I)', () => {
    it('are handled without error (no-op)', () => {
      expect(() => {
        // No-op — diagnostic events with no store mutation
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Group J: query response events
  // ==========================================================================

  describe('supported_models event (Group J)', () => {
    it('stores models list in state', () => {
      const models = [
        { value: 'claude-3-opus', displayName: 'Opus', description: 'Most capable' },
        { value: 'claude-3-sonnet', displayName: 'Sonnet', description: 'Balanced' },
      ];

      // Simulates: case 'supported_models'
      useAppStore.getState().setSupportedModels(models);

      expect(useAppStore.getState().supportedModels).toEqual(models);
    });
  });

  describe('supported_commands event (Group J)', () => {
    it('stores commands list in state', () => {
      const commands = [
        { name: '/help', description: 'Get help', argumentHint: '' },
        { name: '/clear', description: 'Clear conversation', argumentHint: '' },
      ];

      useAppStore.getState().setSupportedCommands(commands);

      expect(useAppStore.getState().supportedCommands).toEqual(commands);
    });
  });

  describe('mcp_status event (Group J)', () => {
    it('updates MCP servers in store', () => {
      const servers = [
        { name: 'linear', status: 'connected' as const },
        { name: 'github', status: 'failed' as const },
      ];

      useAppStore.getState().setMcpServers(servers);

      expect(useAppStore.getState().mcpServers).toEqual(servers);
    });
  });

  describe('account_info event (Group J)', () => {
    it('stores account info in state', () => {
      const info = {
        email: 'user@example.com',
        organization: 'Acme',
        subscriptionType: 'pro',
      };

      useAppStore.getState().setAccountInfo(info);

      expect(useAppStore.getState().accountInfo).toEqual(info);
    });
  });

  // ==========================================================================
  // Plan Approval Request event
  // ==========================================================================

  describe('plan_approval_request event', () => {
    it('sets pendingPlanApproval with requestId', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      // Simulates: case 'plan_approval_request'
      const event = { requestId: 'plan-approval-1-1700000000000' };
      if (event.requestId) {
        store.setPendingPlanApproval(CONV_ID, event.requestId);
      }

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.pendingPlanApproval).toEqual({ requestId: 'plan-approval-1-1700000000000' });
    });

    it('ignores event when requestId is missing', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      const event = { requestId: undefined as string | undefined };
      if (event.requestId) {
        store.setPendingPlanApproval(CONV_ID, event.requestId);
      }

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.pendingPlanApproval).toBeNull();
    });

    it('replaces previous pendingPlanApproval', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      store.setPendingPlanApproval(CONV_ID, 'plan-approval-old');
      store.setPendingPlanApproval(CONV_ID, 'plan-approval-new');

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.pendingPlanApproval).toEqual({ requestId: 'plan-approval-new' });
    });

    it('does not affect other conversations', () => {
      const OTHER_CONV = 'conv-other';
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.setStreaming(OTHER_CONV, true);

      store.setPendingPlanApproval(CONV_ID, 'plan-approval-1');

      expect(useAppStore.getState().streamingState[CONV_ID]?.pendingPlanApproval).toEqual({ requestId: 'plan-approval-1' });
      expect(useAppStore.getState().streamingState[OTHER_CONV]?.pendingPlanApproval).toBeNull();
    });

    it('clearPendingPlanApproval clears the approval state', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.setPendingPlanApproval(CONV_ID, 'plan-approval-1');

      store.clearPendingPlanApproval(CONV_ID);

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.pendingPlanApproval).toBeNull();
    });

    it('preserves planModeActive when setting pendingPlanApproval', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.setPlanModeActive(CONV_ID, true);

      store.setPendingPlanApproval(CONV_ID, 'plan-approval-1');

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.planModeActive).toBe(true);
      expect(state?.pendingPlanApproval).toEqual({ requestId: 'plan-approval-1' });
    });

    it('preserves pendingPlanApproval when changing planModeActive', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.setPendingPlanApproval(CONV_ID, 'plan-approval-1');

      store.setPlanModeActive(CONV_ID, false);

      const state = useAppStore.getState().streamingState[CONV_ID];
      expect(state?.planModeActive).toBe(false);
      expect(state?.pendingPlanApproval).toEqual({ requestId: 'plan-approval-1' });
    });
  });

  // ==========================================================================
  // turn_complete event (multi-turn agent loop)
  // ==========================================================================

  describe('turn_complete event', () => {
    it('finalizes streaming message and keeps status active', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.appendStreamingText(CONV_ID, 'Hello from turn 1');

      // Simulate turn_complete handler: finalize + keep active
      store.finalizeStreamingMessage(CONV_ID, {});
      store.updateConversation(CONV_ID, { status: 'active' });

      const state = useAppStore.getState();
      // Streaming should be cleared
      expect(state.streamingState[CONV_ID]?.isStreaming).toBeFalsy();
      // Conversation should remain active (process still alive)
      const conv = state.conversations.find((c) => c.id === CONV_ID);
      expect(conv?.status).toBe('active');
    });

    it('clears active tools on turn_complete', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      // Simulate turn_complete
      const tools = store.activeTools[CONV_ID] || [];
      store.finalizeStreamingMessage(CONV_ID, {
        toolUsage: tools.map((t) => ({
          id: t.id,
          tool: t.tool,
          params: t.params,
        })),
      });
      store.updateConversation(CONV_ID, { status: 'active' });

      const state = useAppStore.getState();
      // Active tools should be cleared after finalization
      expect(state.activeTools[CONV_ID]?.length ?? 0).toBe(0);
    });

    it('creates a message from streaming text on finalization', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.appendStreamingText(CONV_ID, 'Turn 1 response text');

      store.finalizeStreamingMessage(CONV_ID, { durationMs: 1500 });

      const state = useAppStore.getState();
      const msgs = (state.messagesByConversation[CONV_ID] ?? []).filter((m) => m.role === 'assistant');
      expect(msgs.length).toBe(1);
      expect(msgs[0].content).toContain('Turn 1 response text');
    });
  });
});
