'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, AgentEvent, AgentTodoItem, CheckpointInfo, BudgetStatus, UserQuestion, ReviewComment, TokenUsage, ModelUsageInfo, McpServerStatus } from '@/lib/types';

import {
  WEBSOCKET_RECONNECT_BASE_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_ATTEMPTS,
} from '@/lib/constants';
import { getAuthToken } from '@/lib/auth-token';
import { getBackendPort, getBackendPortSync } from '@/lib/backend-port';
import { useConnectionStore } from '@/stores/connectionStore';
import { getConversationDropStats, getActiveStreamingConversations, getConversationMessages, getStreamingSnapshot, toStoreMessage } from '@/lib/api';
import { notifyDesktop, getConversationLabel } from '@/hooks/useDesktopNotifications';

// Safely coerce an unknown value to a number, returning undefined for non-numeric values.
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

// Normalize SDK usage object (snake_case) to our TokenUsage type (camelCase)
function normalizeUsage(raw: Record<string, unknown> | undefined): TokenUsage | undefined {
  if (!raw) return undefined;
  const inputTokens = num(raw.input_tokens) ?? num(raw.inputTokens);
  const outputTokens = num(raw.output_tokens) ?? num(raw.outputTokens);
  if (inputTokens == null && outputTokens == null) return undefined;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheReadInputTokens: num(raw.cache_read_input_tokens) ?? num(raw.cacheReadInputTokens),
    cacheCreationInputTokens: num(raw.cache_creation_input_tokens) ?? num(raw.cacheCreationInputTokens),
  };
}

// Debounce interval for drop stats REST fetches (ms).
// The backend ticker fires every 2s, so 3s avoids redundant requests during bursty drops.
const DROP_STATS_DEBOUNCE_MS = 3000;
let lastDropStatsFetchTime = 0;

// Type guards for WebSocket payload validation
function isAgentEvent(payload: unknown): payload is AgentEvent {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const obj = payload as Record<string, unknown>;
  // AgentEvent must have at least a type field (string) or be a valid event object
  // Allow objects that have any of the known AgentEvent fields
  return (
    typeof obj.type === 'string' ||
    typeof obj.content === 'string' ||
    typeof obj.id === 'string' ||
    typeof obj.tool === 'string' ||
    typeof obj.name === 'string' ||
    typeof obj.message === 'string' ||
    Array.isArray(obj.todos)
  );
}

function isAgentTodoItem(item: unknown): item is AgentTodoItem {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.content === 'string' &&
    typeof obj.status === 'string' &&
    (obj.status === 'pending' || obj.status === 'in_progress' || obj.status === 'completed') &&
    typeof obj.activeForm === 'string'
  );
}

function isAgentTodoItemArray(payload: unknown): payload is AgentTodoItem[] {
  return Array.isArray(payload) && payload.every(isAgentTodoItem);
}

const VALID_CONVERSATION_STATUSES = ['active', 'idle', 'completed'] as const;
type ConversationStatus = typeof VALID_CONVERSATION_STATUSES[number];

function isValidConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === 'string' && VALID_CONVERSATION_STATUSES.includes(value as ConversationStatus);
}

// Get WebSocket URL dynamically based on the backend port
function getWsUrl(): string {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const port = getBackendPortSync();
    return `ws://localhost:${port}/ws`;
  }
  return process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:9876/ws';
}

export function useWebSocket(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const enabledRef = useRef(enabled);
  const connectRef = useRef<(() => void) | null>(null);
  const attemptRef = useRef(0);
  const hasConnectedRef = useRef(false);

  // Update enabledRef in effect to satisfy linter
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Access store actions via getState() to avoid subscribing to all state changes.
  // Actions are stable references so this is safe and avoids re-renders on every store update.
  const getStore = useAppStore.getState;

  // Map backend status to frontend session status
  const mapStatus = (status: string): 'active' | 'idle' | 'done' | 'error' => {
    switch (status) {
      case 'running': return 'active';
      case 'pending': return 'idle';
      case 'done': return 'done';
      case 'error': return 'error';
      default: return 'idle';
    }
  };

  const handleConversationEvent = useCallback((data: WSEvent) => {
    const conversationId = data.conversationId;
    if (!conversationId) return;
    const store = getStore();

    // Handle conversation_status separately - it uses a string payload
    if (data.type === 'conversation_status') {
      if (typeof data.payload === 'string' && isValidConversationStatus(data.payload)) {
        store.updateConversation(conversationId, { status: data.payload });
      } else {
        console.warn('Invalid conversation status payload:', data.payload);
      }
      return;
    }

    // Handle summary_updated events
    if (data.type === 'summary_updated') {
      const payload = data.payload as unknown as Record<string, unknown> | null;
      if (payload && typeof payload === 'object' && payload.id) {
        // Use updateSummary for partial payloads (e.g., failed status only has id/status/errorMessage)
        // Use setSummary only when we have a full Summary object (completed status with all fields)
        const existing = store.summaries[conversationId];
        if (existing) {
          store.updateSummary(conversationId, payload as unknown as Partial<import('@/lib/types').Summary>);
        } else {
          store.setSummary(conversationId, payload as unknown as import('@/lib/types').Summary);
        }
      }
      return;
    }

    // For all other events, validate payload is an AgentEvent object
    if (!isAgentEvent(data.payload)) {
      console.warn('Invalid WebSocket payload for conversation event:', data.type);
      return;
    }
    const event = data.payload;

    switch (data.type) {
      case 'init':
        // If an init event arrives for an already-streaming conversation, it means the
        // process was restarted. Clear stale streaming state before processing new events.
        if (store.streamingState[conversationId]?.isStreaming) {
          store.clearStreamingText(conversationId);
          store.setStreaming(conversationId, false);
          store.clearActiveTools(conversationId);
          store.clearThinking(conversationId);
          store.clearSubAgents(conversationId);
        }
        // Capture budget configuration from init event
        if (event?.budgetConfig) {
          const config = event.budgetConfig as { maxBudgetUsd?: number; maxTurns?: number; maxThinkingTokens?: number };
          // Initialize budget status with max values from config
          const existingStatus = store.budgetStatus;
          store.setBudgetStatus({
            maxBudgetUsd: config.maxBudgetUsd,
            maxTurns: config.maxTurns,
            maxThinkingTokens: config.maxThinkingTokens,
            currentCostUsd: existingStatus?.currentCostUsd || 0,
            currentTurns: existingStatus?.currentTurns || 0,
            currentThinkingTokens: existingStatus?.currentThinkingTokens || 0,
          });
        }
        break;

      case 'assistant_text':
        // Append streaming text - clear thinking when regular text starts
        if (event?.content) {
          store.clearThinking(conversationId);
          store.appendStreamingText(conversationId, event.content);
        }
        break;

      case 'thinking_start':
        // Start a new thinking block
        store.setThinking(conversationId, true);
        break;

      case 'thinking_delta':
        // Append thinking text
        if (event?.content) {
          store.appendThinkingText(conversationId, event.content);
        }
        break;

      case 'thinking':
        // Full thinking content (non-streaming)
        if (event?.content) {
          store.appendThinkingText(conversationId, event.content);
        }
        break;

      case 'tool_start':
        // Add active tool — route to sub-agent if agentId is present
        if (event?.id && event?.tool) {
          const agentId = event.agentId as string | undefined;
          if (agentId) {
            // Sub-agent tool — add to sub-agent's tool list
            store.addSubAgentTool(conversationId, agentId, {
              id: event.id,
              tool: event.tool,
              params: event.params,
              startTime: Date.now(),
              agentId,
            });
          } else {
            // Parent agent tool
            store.addActiveTool(conversationId, {
              id: event.id,
              tool: event.tool,
              params: event.params,
              startTime: Date.now(),
            });

            // Detect ExitPlanMode tool - this means Claude wants plan approval
            if (event.tool === 'ExitPlanMode') {
              store.setAwaitingPlanApproval(conversationId, true);
            }
          }
        }
        break;

      case 'tool_end':
        // Complete active tool with success/summary info
        // For Bash tools, also capture stdout/stderr
        if (event?.id) {
          const toolAgentId = event.agentId as string | undefined;
          const stdout = event.stdout as string | undefined;
          const stderr = event.stderr as string | undefined;

          if (toolAgentId) {
            // Sub-agent tool completion
            store.completeSubAgentTool(conversationId, toolAgentId, event.id, event.success, event.summary, stdout, stderr);
          } else {
            // Parent agent tool
            const activeTool = store.activeTools[conversationId]?.find(t => t.id === event.id);

            if (activeTool) {
              // Normal path: tool exists in state
              const isExitPlanMode = activeTool.tool === 'ExitPlanMode';
              store.completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr);

              if (isExitPlanMode) {
                store.setAwaitingPlanApproval(conversationId, false);
              }
            } else if (event.tool) {
              // Race condition recovery: tool_end arrived but tool wasn't in state.
              // Create a synthetic completed entry so the timeline shows it as finished.
              console.warn(`[WebSocket] tool_end for untracked tool: ${event.id} (${event.tool})`);
              store.addActiveTool(conversationId, {
                id: event.id,
                tool: event.tool as string,
                startTime: Date.now(),
                untracked: true,
              }, { skipTimeout: true });
              store.completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr);
            }
            // If no tool name and not in state, silently skip - tool was never shown to user
          }
        }
        break;

      case 'todo_update':
        // Update agent todos for real-time tracking
        if (event?.todos && isAgentTodoItemArray(event.todos)) {
          store.setAgentTodos(conversationId, event.todos);
        }
        break;

      case 'name_suggestion':
        // Update conversation name
        if (event?.name) {
          store.updateConversation(conversationId, { name: event.name });
        }
        break;

      case 'result':
        // Result event signals the end of a turn - finalize streaming atomically
        // This prevents data loss by creating message and clearing state in one update
        // Re-read store to capture any mutations from earlier cases in this handler
        const freshStore = getStore();
        const startTime = freshStore.streamingState[conversationId]?.startTime;
        const durationMs = startTime ? Date.now() - startTime : undefined;

        // Capture tool usage before clearing
        const tools = freshStore.activeTools[conversationId] || [];
        const toolUsage = tools.map((t) => ({
          id: t.id,
          tool: t.tool,
          params: t.params,
          success: t.success,
          summary: t.summary,
          durationMs: t.endTime && t.startTime ? t.endTime - t.startTime : undefined,
          stdout: t.stdout,
          stderr: t.stderr,
        }));

        // Atomic finalization - creates message and clears streaming/activeTools in one update
        // Note: finalizeStreamingMessage also clears thinking state, so no separate clearThinking needed
        freshStore.finalizeStreamingMessage(conversationId, {
          durationMs,
          toolUsage: toolUsage.length > 0 ? toolUsage : undefined,
          runSummary: {
            success: event.success !== false,
            cost: event.cost,
            turns: event.turns,
            durationMs,
            stats: event.stats,
            errors: event.errors,
            usage: normalizeUsage(event.usage),
            modelUsage: event.modelUsage as Record<string, ModelUsageInfo> | undefined,
          },
        });
        // Update budget status from result event, preserving max values
        if (event.cost !== undefined) {
          const existingStatus = freshStore.budgetStatus;
          const budgetStatus: BudgetStatus = {
            // Preserve max values from init event
            maxBudgetUsd: existingStatus?.maxBudgetUsd,
            maxTurns: existingStatus?.maxTurns,
            maxThinkingTokens: existingStatus?.maxThinkingTokens,
            // Update current values from result
            currentCostUsd: (event.cost as number) || 0,
            currentTurns: (event.turns as number) || 0,
            currentThinkingTokens: existingStatus?.currentThinkingTokens || 0,
            limitExceeded: event.subtype === 'error_max_budget_usd' ? 'budget'
                         : event.subtype === 'error_max_turns' ? 'turns'
                         : undefined,
          };
          freshStore.setBudgetStatus(budgetStatus);
        }
        // Update conversation status to completed
        freshStore.updateConversation(conversationId, { status: 'completed' });
        // Desktop notification for task completion.
        // success defaults to true when the field is absent (only explicitly false means failure).
        notifyDesktop(
          conversationId,
          event.success !== false ? 'Task completed' : 'Task finished with errors',
          getConversationLabel(conversationId),
        );
        break;

      case 'turn_complete': {
        // Turn completed but process is still alive — finalize streaming state
        // but keep conversation as active (ready for next message without restart)
        const turnStore = getStore();
        const turnStartTime = turnStore.streamingState[conversationId]?.startTime;
        const turnDurationMs = turnStartTime ? Date.now() - turnStartTime : undefined;

        const turnTools = turnStore.activeTools[conversationId] || [];
        const turnToolUsage = turnTools.map((t) => ({
          id: t.id,
          tool: t.tool,
          params: t.params,
          success: t.success,
          summary: t.summary,
          durationMs: t.endTime && t.startTime ? t.endTime - t.startTime : undefined,
          stdout: t.stdout,
          stderr: t.stderr,
        }));

        // Atomic finalization - creates message and clears streaming/activeTools
        turnStore.finalizeStreamingMessage(conversationId, {
          durationMs: turnDurationMs,
          toolUsage: turnToolUsage.length > 0 ? turnToolUsage : undefined,
        });
        // Explicitly set status to active — finalizeStreamingMessage only clears
        // streaming/activeTools state but does NOT update conversation status.
        // The process is still alive and ready for the next message.
        turnStore.updateConversation(conversationId, { status: 'active' });
        break;
      }

      case 'complete':
        // Complete event signals the entire conversation ended (stdin closed)
        // Clear any remaining state
        store.clearStreamingText(conversationId);
        store.setStreaming(conversationId, false);
        store.clearThinking(conversationId);
        store.clearActiveTools(conversationId);
        store.clearSubAgents(conversationId);
        // Update conversation status to idle (ready for new input)
        store.updateConversation(conversationId, { status: 'idle' });
        break;

      case 'permission_mode_changed':
        // Handle plan mode changes from the backend
        if (event?.mode) {
          const isPlanMode = event.mode === 'plan';
          store.setPlanModeActive(conversationId, isPlanMode);
          if (isPlanMode) {
            notifyDesktop(conversationId, 'Plan ready for review', 'The AI needs your approval');
          }
        }
        break;

      case 'error':
        // Handle error - capture the error message and stop streaming
        const errorMessage = event?.message || 'An unknown error occurred';
        console.error('Conversation error:', errorMessage);
        store.setStreamingError(conversationId, errorMessage);
        // Update conversation status to idle
        store.updateConversation(conversationId, { status: 'idle' });
        // Desktop notification for error
        notifyDesktop(conversationId, 'Task error', (errorMessage || 'Unknown error').slice(0, 100));
        break;

      case 'streaming_warning': {
        // Emit custom event for StreamingWarningHandler to display toast.
        // Debounce the REST call to avoid redundant requests during bursty drops.
        // The backend ticker fires every 2s, so at most one fetch per 3s is sufficient.
        const now = Date.now();
        if (now - lastDropStatsFetchTime >= DROP_STATS_DEBOUNCE_MS) {
          lastDropStatsFetchTime = now;
          getConversationDropStats(conversationId).then((stats) => {
            window.dispatchEvent(new CustomEvent('streaming-warning', {
              detail: {
                source: event?.source,
                reason: event?.reason,
                message: stats.droppedMessages > 0
                  ? `${stats.droppedMessages} streaming events were dropped`
                  : (event?.message || 'Some streaming data may have been lost'),
                droppedMessages: stats.droppedMessages,
              }
            }));
          }).catch(() => {
            // Fallback: emit warning with whatever info we have from WebSocket
            window.dispatchEvent(new CustomEvent('streaming-warning', {
              detail: {
                source: event?.source,
                reason: event?.reason,
                message: event?.message || 'Some streaming data may have been lost',
              }
            }));
          });
        } else {
          // Debounced: emit warning with WebSocket data only (no REST call)
          window.dispatchEvent(new CustomEvent('streaming-warning', {
            detail: {
              source: event?.source,
              reason: event?.reason,
              message: event?.message || 'Some streaming data may have been lost',
            }
          }));
        }
        break;
      }

      case 'user_question_request':
        // AskUserQuestion tool - set pending question for the conversation
        if (event?.requestId && Array.isArray(event?.questions)) {
          store.setPendingUserQuestion(conversationId, {
            requestId: event.requestId as string,
            questions: event.questions as UserQuestion[],
            currentIndex: 0,
            answers: {},
          });
          notifyDesktop(conversationId, 'Question from AI', 'The AI needs your input');
        }
        break;

      case 'context_usage':
        // Update context usage from per-assistant-message token counts
        if (event?.inputTokens !== undefined) {
          store.setContextUsage(conversationId, {
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            cacheReadInputTokens: event.cacheReadInputTokens ?? 0,
            cacheCreationInputTokens: event.cacheCreationInputTokens ?? 0,
          });
        }
        break;

      case 'context_window_size':
        // Update the max context window from modelUsage in result
        if (event?.contextWindow) {
          store.setContextUsage(conversationId, {
            contextWindow: event.contextWindow,
          });
        }
        break;

      case 'compact_boundary':
        // After compaction, reset all token fields until next assistant message provides fresh data
        store.setContextUsage(conversationId, {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        });
        break;

      // ====================================================================
      // Group B: Tool Progress — elapsed time on long-running tools
      // The agent SDK emits tool_progress with `parentToolUseId` as the
      // canonical tool identifier. Some backend paths also set `id`.
      // We prefer `id` when present for consistency with tool_start/tool_end.
      // ====================================================================
      case 'tool_progress':
        if (event?.parentToolUseId || event?.id) {
          const toolId = (event.id ?? event.parentToolUseId) as string;
          store.updateToolProgress(conversationId, toolId, {
            elapsedTimeSeconds: event.elapsedTimeSeconds as number | undefined,
            toolName: event.toolName as string | undefined,
          });
        }
        break;

      // ====================================================================
      // Group C: Agent Notifications — toast + desktop for important ones
      // ====================================================================
      case 'agent_notification':
        if (event?.title || event?.message) {
          window.dispatchEvent(new CustomEvent('agent-notification', {
            detail: {
              title: event.title,
              message: event.message,
              type: event.notificationType || 'info',
              conversationId,
            }
          }));
          if (event.notificationType === 'error' || event.notificationType === 'warning') {
            notifyDesktop(conversationId, (event.title as string) || 'Agent notification', (event.message as string) || '');
          }
        }
        break;

      // ====================================================================
      // Group D: Checkpoints & File Rewind
      // ====================================================================
      case 'checkpoint_created':
        if (event?.checkpointUuid) {
          store.addCheckpoint({
            uuid: event.checkpointUuid as string,
            timestamp: new Date().toISOString(),
            messageIndex: event.messageIndex ?? 0,
          });
        }
        break;

      case 'files_rewound':
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: 'Files rewound',
            message: 'Files restored to checkpoint',
            type: 'info',
            conversationId,
          }
        }));
        break;

      // ====================================================================
      // Group E: Model Changed
      // ====================================================================
      case 'model_changed':
        if (event?.model) {
          store.updateConversation(conversationId, { model: event.model as string });
        }
        break;

      // ====================================================================
      // Group F: Interrupted + User Question Timeout
      // ====================================================================
      case 'interrupted':
        store.clearStreamingText(conversationId);
        store.setStreaming(conversationId, false);
        store.clearActiveTools(conversationId);
        store.clearThinking(conversationId);
        store.clearSubAgents(conversationId);
        store.updateConversation(conversationId, { status: 'idle' });
        break;

      case 'user_question_timeout':
        store.clearPendingUserQuestion(conversationId);
        break;

      // ====================================================================
      // Group G: Hook Events — surface failures, log the rest
      // ====================================================================
      case 'hook_tool_failure':
        console.warn(`[Hook] Tool failure: ${event?.tool} — ${event?.error}`);
        break;

      case 'hook_pre_tool':
      case 'hook_post_tool':
      case 'hook_response':
        // Diagnostic — no UI action needed
        break;

      // ====================================================================
      // Group H: Session Lifecycle — managed by backend
      // ====================================================================
      case 'session_started':
      case 'session_ended':
      case 'session_id_update':
        // Session lifecycle managed by backend. No frontend action needed.
        break;

      // ====================================================================
      // Group I: Diagnostic Events
      // ====================================================================
      case 'agent_stop':
        store.updateConversation(conversationId, { status: 'idle' });
        break;

      case 'command_error':
        if (event?.message) {
          store.setStreamingError(conversationId, event.message as string);
        }
        break;

      case 'auth_status':
      case 'status_update':
        // Diagnostic — no UI action needed
        break;

      case 'agent_stderr':
      case 'json_parse_error':
        console.warn(`[Agent] ${data.type}:`, event?.message || event?.data);
        break;

      // ====================================================================
      // Group J: Query Responses
      // ====================================================================
      case 'supported_models':
        if (event?.models) {
          store.setSupportedModels(event.models as Array<{ value: string; displayName: string; description: string }>);
        }
        break;

      case 'supported_commands':
        if (event?.commands) {
          store.setSupportedCommands(event.commands as Array<{ name: string; description: string; argumentHint: string }>);
        }
        break;

      case 'mcp_status':
        if (event?.servers) {
          store.setMcpServers(event.servers as McpServerStatus[]);
        }
        break;

      case 'account_info':
        if (event?.info) {
          store.setAccountInfo(event.info as Record<string, unknown>);
        }
        break;

      // ====================================================================
      // Sub-agent lifecycle events (Group A)
      // ====================================================================
      case 'subagent_started':
        if (event?.agentId && event?.agentType) {
          store.addSubAgent(conversationId, {
            agentId: event.agentId as string,
            agentType: event.agentType as string,
            parentToolUseId: event.parentToolUseId as string | undefined,
            startTime: Date.now(),
            completed: false,
            tools: [],
          });
        }
        break;

      case 'subagent_stopped':
        if (event?.agentId) {
          store.completeSubAgent(conversationId, event.agentId as string);
        }
        break;

    }
  // getStore is a stable reference (useAppStore.getState), no deps needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a WebSocket reconnection, reconcile frontend streaming state with backend reality.
  // If the agent finished while disconnected: clear orphaned streaming state and reload messages.
  // If the agent is still active: fetch the streaming snapshot to restore the view.
  const reconcileStreamingState = useCallback(async () => {
    const store = getStore();

    const locallyStreaming = Object.entries(store.streamingState)
      .filter(([, state]) => state.isStreaming)
      .map(([convId]) => convId);

    if (locallyStreaming.length === 0) return;

    try {
      const { conversationIds: serverActive } = await getActiveStreamingConversations();
      const serverActiveSet = new Set(serverActive);

      for (const convId of locallyStreaming) {
        if (!serverActiveSet.has(convId)) {
          // Agent finished while we were disconnected — clear orphaned state
          store.clearStreamingText(convId);
          store.clearActiveTools(convId);
          store.clearThinking(convId);
          store.clearSubAgents(convId);
          store.updateConversation(convId, { status: 'completed' });

          // Reload messages to pick up any assistant responses we missed
          try {
            const page = await getConversationMessages(convId);
            const messages = page.messages.map(m => toStoreMessage(m, convId));
            store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
          } catch (err) {
            console.warn(`Failed to reload messages for ${convId} after reconnect:`, err);
          }
        } else {
          // Agent still active — restore streaming view from snapshot.
          // Note: the snapshot may be up to 500ms stale (debounce interval). Text
          // emitted between the last flush and the disconnect is lost. New WebSocket
          // events after reconnect append from where the backend left off, so there's
          // no duplication — just a small gap.
          try {
            const snapshot = await getStreamingSnapshot(convId);
            if (snapshot && snapshot.text) {
              store.restoreStreamingFromSnapshot(convId, snapshot);
            } else {
              // No snapshot (race: result just persisted but process hasn't exited yet)
              // Reload messages as safety net, keep streaming active
              try {
                const page = await getConversationMessages(convId);
                const messages = page.messages.map(m => toStoreMessage(m, convId));
                store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
              } catch (innerErr) {
                console.warn(`Failed to reload messages for ${convId} during snapshot fallback:`, innerErr);
              }
            }
          } catch (err) {
            console.warn(`Failed to fetch streaming snapshot for ${convId}:`, err);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to reconcile streaming state after reconnect:', err);
    }
  // getStore is a stable reference (useAppStore.getState), no deps needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    // Cancel any pending reconnect to prevent race condition
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (!enabledRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Ensure we have the backend port before connecting
    // This is especially important for Tauri builds with dynamic port allocation
    await getBackendPort();

    // Fetch auth token (awaits if not yet cached, uses cache otherwise)
    // This ensures we always have the current token, even after sidecar restarts
    const token = await getAuthToken();
    const baseWsUrl = getWsUrl();
    const wsUrl = token ? `${baseWsUrl}?token=${encodeURIComponent(token)}` : baseWsUrl;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const isReconnect = hasConnectedRef.current;
      hasConnectedRef.current = true;
      attemptRef.current = 0;
      useConnectionStore.getState().setConnected();

      if (isReconnect) {
        // Intentionally not awaited — we don't want to block the WebSocket onopen handler.
        // The UI may briefly show stale streaming state until reconciliation completes.
        reconcileStreamingState();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WSEvent = JSON.parse(event.data);

        // Handle conversation events
        if (data.conversationId) {
          handleConversationEvent(data);
          return;
        }

        // Handle init event for MCP server status
        if (data.type === 'init') {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload?.mcpServers && Array.isArray(payload.mcpServers)) {
            getStore().setMcpServers(payload.mcpServers);
          }
          return;
        }

        // Handle checkpoint events
        if (data.type === 'checkpoint_created') {
          const eventData = data as WSEvent & Record<string, unknown>;
          const checkpoint: CheckpointInfo = {
            uuid: eventData.checkpointUuid as string,
            timestamp: new Date().toISOString(),
            messageIndex: (eventData.messageIndex as number) || 0,
            isResult: eventData.isResult as boolean | undefined,
          };
          getStore().addCheckpoint(checkpoint);
          return;
        }

        // Handle files rewound event
        if (data.type === 'files_rewound') {
          const eventData = data as WSEvent & Record<string, unknown>;
          console.log('Files rewound to checkpoint:', eventData.checkpointUuid);
          return;
        }

        // Handle session name update (auto-naming based on conversation context)
        if (data.type === 'session_name_update' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload?.name && typeof payload.name === 'string') {
            const updates: { name: string; branch?: string } = { name: payload.name };
            if (payload?.branch && typeof payload.branch === 'string') {
              updates.branch = payload.branch;
            }
            getStore().updateSession(data.sessionId, updates);
          }
          return;
        }

        // Handle session stats update (real-time stats from file watcher)
        if (data.type === 'session_stats_update' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          // stats can be null (no changes) or { additions: number, deletions: number }
          const stats = payload?.stats as { additions: number; deletions: number } | null | undefined;
          getStore().updateSession(data.sessionId, { stats: stats ?? undefined });
          return;
        }

        // Handle script output events
        if (data.type === 'script_output' && data.sessionId) {
          const payload = data.payload as { runId: string; line: string } | undefined;
          if (payload?.runId && typeof payload.line === 'string') {
            getStore().appendScriptOutput(data.sessionId, payload.runId, payload.line);
          }
          return;
        }

        // Handle script status events
        if (data.type === 'script_status' && data.sessionId) {
          const run = data.payload as import('@/lib/types').ScriptRun | undefined;
          if (run?.id) {
            const store = getStore();
            const existing = store.scriptRuns[data.sessionId]?.find(r => r.id === run.id);
            if (existing) {
              store.updateScriptRunStatus(data.sessionId, run);
            } else {
              store.addScriptRun(data.sessionId, run);
            }
          }
          return;
        }

        // Handle setup progress events
        if (data.type === 'setup_progress' && data.sessionId) {
          const payload = data.payload as import('@/lib/types').SetupProgress | undefined;
          if (payload) {
            getStore().setSetupProgress(data.sessionId, payload);
          }
          return;
        }

        // Handle dashboard-level invalidation events (PR or branch changes)
        if (data.type === 'pr_dashboard_update' || data.type === 'branch_dashboard_update') {
          window.dispatchEvent(new CustomEvent(data.type, { detail: data.payload }));
          // Don't return -- pr_dashboard_update is also followed by session_pr_update
          // which we still want to process
        }

        // Handle session PR status update (background GitHub polling)
        if (data.type === 'session_pr_update' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload) {
            type PRStatus = 'none' | 'open' | 'merged' | 'closed';
            const validPRStatuses: PRStatus[] = ['none', 'open', 'merged', 'closed'];

            const updates: {
              prStatus?: PRStatus;
              prNumber?: number;
              prUrl?: string;
              hasCheckFailures?: boolean;
              hasMergeConflict?: boolean;
            } = {};

            if (typeof payload.prStatus === 'string' && validPRStatuses.includes(payload.prStatus as PRStatus)) {
              updates.prStatus = payload.prStatus as PRStatus;
            }
            if (typeof payload.prNumber === 'number') {
              updates.prNumber = payload.prNumber;
            }
            if (typeof payload.prUrl === 'string') {
              updates.prUrl = payload.prUrl;
            }
            // Map checkStatus to hasCheckFailures
            if (typeof payload.checkStatus === 'string') {
              updates.hasCheckFailures = payload.checkStatus === 'failure';
            }
            // Map mergeable to hasMergeConflict
            if (typeof payload.mergeable === 'boolean') {
              updates.hasMergeConflict = !payload.mergeable;
            }

            getStore().updateSession(data.sessionId, updates);
          }
          return;
        }

        // Handle archive summary updates (generated asynchronously after archiving)
        if (data.type === 'archive_summary_updated' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload) {
            const updates: Record<string, unknown> = {};
            if (typeof payload.archiveSummary === 'string') {
              updates.archiveSummary = payload.archiveSummary;
            }
            if (typeof payload.archiveSummaryStatus === 'string') {
              updates.archiveSummaryStatus = payload.archiveSummaryStatus;
            }
            if (Object.keys(updates).length > 0) {
              getStore().updateSession(data.sessionId, updates);
            }
          }
          return;
        }

        // Handle review comment events
        if (data.type === 'comment_added' && data.sessionId) {
          const payload = data.payload as ReviewComment | undefined;
          if (payload?.id) {
            getStore().addReviewComment(data.sessionId, payload);
          }
          return;
        }

        if ((data.type === 'comment_updated' || data.type === 'comment_resolved') && data.sessionId) {
          const payload = data.payload as ReviewComment | undefined;
          if (payload?.id) {
            getStore().updateReviewComment(data.sessionId, payload.id, payload);
          }
          return;
        }

        if (data.type === 'comment_deleted' && data.sessionId) {
          const payload = data.payload as { id?: string } | undefined;
          if (payload?.id) {
            getStore().deleteReviewComment(data.sessionId, payload.id);
          }
          return;
        }

        // Legacy agent events - validate string payloads
        if (data.type === 'output' && data.agentId && typeof data.payload === 'string') {
          getStore().appendOutput(data.agentId, data.payload);
        } else if (data.type === 'status' && data.agentId && typeof data.payload === 'string') {
          getStore().updateSession(data.agentId, {
            status: mapStatus(data.payload),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      useConnectionStore.getState().setDisconnected();

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Only reconnect if still enabled and under max attempts
      if (enabledRef.current && connectRef.current) {
        attemptRef.current += 1;
        const attempt = attemptRef.current;

        if (attempt <= WEBSOCKET_RECONNECT_MAX_ATTEMPTS) {
          useConnectionStore.getState().setConnecting(attempt);
          // Exponential backoff: base * 2^(attempt-1), capped at max delay
          const delay = Math.min(
            WEBSOCKET_RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
            WEBSOCKET_RECONNECT_MAX_DELAY_MS,
          );
          reconnectTimeoutRef.current = setTimeout(connectRef.current, delay);
        }
        // Max attempts exceeded — stay disconnected so the UI can prompt manual reconnect
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [handleConversationEvent, reconcileStreamingState, getStore]);

  // Store connect function in ref for self-referential reconnection
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      // Close connection if disabled
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [enabled, connect]);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    useConnectionStore.getState().setConnecting(0);
    // connect() already cancels pending reconnect timers and checks readyState,
    // so we just need to tear down the old socket without triggering onclose reconnect.
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const oldWs = wsRef.current;
    if (oldWs) {
      // Remove onclose to prevent the auto-reconnect logic from racing with us
      oldWs.onclose = null;
      oldWs.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  return { reconnect };
}
