'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, ReviewComment } from '@/lib/types';
import { createStreamingBatcher, type StreamingBatcher } from '@/hooks/useStreamingBatcher';

import {
  WEBSOCKET_RECONNECT_BASE_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_ATTEMPTS,
} from '@/lib/constants';
import { getAuthToken } from '@/lib/auth-token';
import { getBackendPort } from '@/lib/backend-port';
import { useConnectionStore } from '@/stores/connectionStore';
import { dispatchAppEvent } from '@/lib/custom-events';
import { getConversationDropStats, getActiveStreamingConversations, getInterruptedConversations, getConversationMessages, getStreamingSnapshot, toStoreMessage, updateSession as updateSessionApi, refreshPRStatus, addSystemMessage, listAllSessions, mapSessionDTO } from '@/lib/api';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBranchCacheStore } from '@/stores/branchCacheStore';
import { useSlashCommandStore } from '@/stores/slashCommandStore';
import { notifyDesktop, getConversationLabel } from '@/hooks/useDesktopNotifications';
import { trackEvent } from '@/lib/telemetry';
import { unregisterSession, getSessionDirName } from '@/lib/tauri';

// Import extracted modules
import { markPlanModeExited, isInPlanModeExitCooldown, clearPlanModeState } from '@/hooks/useWebSocketPlanMode';
import { startReconciling, stopReconciling, isReconciling, clearReconciliationState } from '@/hooks/useWebSocketReconciliation';
import {
  normalizeUsage, isAuthErrorMessage, isAgentEvent, isAgentTodoItemArray,
  isValidConversationStatus, isModelUsageRecord, isUserQuestionArray,
  isMcpServerStatusArray, getWsUrl, mapStatus, notifyBackgroundSession,
  BATCHABLE_EVENTS, RECONCILIATION_SUPPRESSED_EVENTS,
  DROP_STATS_DEBOUNCE_MS, getLastDropStatsFetchTime, updateLastDropStatsFetchTime,
} from '@/hooks/useWebSocketHelpers';

// Re-export for backward compatibility (ChatInput.tsx imports markPlanModeExited from here)
export { markPlanModeExited };

// Track conversations where `result` already finalized streaming + committed queued messages.
// Prevents `turn_complete` (which always follows `result`) from double-finalizing and
// setting isStreaming=false in the gap before the next turn's `init`.
const resultFinalizedSet = new Set<string>();

// Timer for clearing Ollama progress after completion — tracked so new events
// can cancel a pending clear and avoid clobbering a new operation's progress.
let ollamaProgressClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Clean up module-level state for a conversation that is being removed.
 * Call this when deleting sessions to prevent stale entries from lingering
 * in reconcilingConversations and recentlyExitedPlanMode maps.
 */
export function cleanupConversationState(conversationId: string) {
  clearReconciliationState(conversationId);
  clearPlanModeState(conversationId);
  resultFinalizedSet.delete(conversationId);
}

/** Clean up the module-level Ollama progress timer to prevent HMR leaks. */
export function cleanupOllamaProgressTimer() {
  if (ollamaProgressClearTimer !== null) {
    clearTimeout(ollamaProgressClearTimer);
    ollamaProgressClearTimer = null;
  }
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

  // Streaming batcher: accumulates assistant_text and thinking_delta events,
  // flushing to the store once per animation frame (~16ms) instead of per-event.
  // Reduces store updates from 60+/sec to ~10/sec during fast streaming.
  const batcherRef = useRef<StreamingBatcher | null>(null);
  if (!batcherRef.current) {
    batcherRef.current = createStreamingBatcher(
      // onFlushText: batch all side-effects that accompany assistant_text
      (convId, text) => {
        const s = useAppStore.getState();
        s.setThinking(convId, false);
        s.appendStreamingText(convId, text);
        s.clearInputSuggestion(convId);
        s.clearPromptSuggestions(convId);
      },
      // onFlushThinking: simple append
      (convId, text) => {
        useAppStore.getState().appendThinkingText(convId, text);
      },
    );
  }

  const handleConversationEvent = useCallback((data: WSEvent) => {
    const conversationId = data.conversationId;
    if (!conversationId) return;

    // Drop content events for conversations being reconciled from a snapshot.
    // This prevents the race where live events overlap with snapshot data, causing
    // duplicate tools and text. Lifecycle events are always processed.
    if (isReconciling(conversationId) && RECONCILIATION_SUPPRESSED_EVENTS.has(data.type)) {
      return;
    }

    const store = getStore();
    const batcher = batcherRef.current!;

    // Force-flush any buffered text/thinking before events that depend on
    // up-to-date store state (tool boundaries, turn ends, errors, etc.).
    // No-op when buffers are empty, so safe to call unconditionally.
    if (!BATCHABLE_EVENTS.has(data.type)) {
      batcher.flush();
    }

    // Handle conversation_status separately - it uses a string payload
    if (data.type === 'conversation_status') {
      if (typeof data.payload === 'string' && isValidConversationStatus(data.payload)) {
        store.updateConversation(conversationId, { status: data.payload });
        // Safety net: when backend says idle, finalize any stale streaming state.
        // This catches cases where result/complete events were dropped or missed.
        // Uses finalizeStreamingMessage instead of clearStreamingText to preserve
        // any streamed content (text + tool blocks) that hasn't been committed yet.
        if (data.payload === 'idle' && store.streamingState[conversationId]?.isStreaming) {
          // Don't finalize if the agent is blocked waiting for user approval —
          // canUseTool/hooks pause the agent, so the backend may report idle even
          // though the session is actually waiting for user interaction.
          const streaming = store.streamingState[conversationId];
          if (streaming?.pendingToolApproval || streaming?.pendingBatchToolApproval || streaming?.pendingPlanApproval || store.pendingUserQuestion[conversationId]) {
            return;
          }
          resultFinalizedSet.delete(conversationId);
          const startTime = streaming?.startTime;
          const durationMs = startTime ? Date.now() - startTime : undefined;
          // Finalize streaming and commit any queued user message atomically.
          // commitQueued commits the user message AFTER the assistant message
          // so the conversation order is chronologically correct.
          // terminal clears remaining queue and forces isStreaming=false.
          store.finalizeStreamingMessage(conversationId, { durationMs, commitQueued: true, terminal: true });
          store.clearAgentTodos(conversationId);
        }
      } else {
        console.warn('Invalid conversation status payload:', data.payload);
      }
      return;
    }

    // Handle summary_updated events
    if (data.type === 'summary_updated') {
      const payload = data.payload as unknown as Record<string, unknown> | null;
      if (payload && typeof payload === 'object' && payload.id) {
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
        // Clear result-finalized flag — a new turn is starting
        resultFinalizedSet.delete(conversationId);

        // If an init event arrives for an already-streaming conversation, finalize
        // the previous turn. When queued messages exist, this is the earliest signal
        // that the agent picked up the queued message — commit it to the timeline.
        if (store.streamingState[conversationId]?.isStreaming) {
          const hasQueued = (store.queuedMessages[conversationId] ?? []).length > 0;
          if (hasQueued) {
            // Agent picked up a queued message. Finalize previous turn's streaming
            // content as an assistant message and commit the queued user message.
            // Idempotent: if result/turn_complete already committed, queue is empty.
            store.finalizeStreamingMessage(conversationId, { commitQueued: true });
          } else {
            // No queued messages — process restart recovery. Clear stale content
            // without creating a message.
            store.clearStreamingContent(conversationId);
          }
          store.clearActiveTools(conversationId);
          store.clearThinking(conversationId);
          store.clearSubAgents(conversationId);
        }
        // Always activate streaming on init — a new turn is starting.
        // This bridges the isStreaming gap that occurs when result+turn_complete
        // set isStreaming=false before the next turn's assistant_text arrives.
        // Safety: if the process stalls after init without sending further events,
        // the conversation_status:'idle' safety-net (above) will clear isStreaming.
        store.setStreaming(conversationId, true);
        // Clear recovery state — the agent recovered successfully
        store.clearAgentRecovery(conversationId);
        // Clear interrupted state — the agent resumed successfully after app restart
        store.clearInterruptedState(conversationId);
        // Clear stale input suggestions from the previous turn
        store.clearInputSuggestion(conversationId);
        store.clearPromptSuggestions(conversationId);
        store.clearToolUseSummaries(conversationId);
        // Capture budget/thinking configuration from init event (per-conversation)
        if (event?.budgetConfig) {
          const config = event.budgetConfig;
          store.updateConversation(conversationId, {
            budgetConfig: { maxBudgetUsd: config.maxBudgetUsd, maxTurns: config.maxTurns },
            thinkingConfig: { effort: config.effort, maxThinkingTokens: config.maxThinkingTokens },
          });
        }
        // Sync plan mode state from the agent's initial permission mode.
        // Guard: if the UI recently exited plan mode (approval or toggle),
        // don't let a stale init event re-activate it during the cooldown window.
        if (event?.permissionMode) {
          const isPlan = event.permissionMode === 'plan';
          if (isPlan && isInPlanModeExitCooldown(conversationId)) {
            // Suppress — don't consume the cooldown, more stale events may follow
          } else {
            store.setPlanModeActive(conversationId, isPlan);
          }
        }
        // Forward SDK-discovered slash commands to the slash command store
        if (event?.slashCommands && Array.isArray(event.slashCommands)) {
          useSlashCommandStore.getState().setSdkCommands(event.slashCommands as string[]);
        }
        // Capture turn-start metadata for timeline status indicators
        store.setTurnStartMeta(conversationId, {
          model: event?.model as string | undefined,
          effort: (event?.budgetConfig as Record<string, unknown> | undefined)?.effort as string | undefined,
          permissionMode: event?.permissionMode as string | undefined,
          fastModeState: event?.fastModeState as 'off' | 'cooldown' | 'on' | undefined,
          backendType: event?.backendType as string | undefined,
        });
        // Extract MCP tools grouped by server from the tools list
        if (event?.tools && Array.isArray(event.tools)) {
          const toolsByServer: Record<string, string[]> = {};
          for (const tool of event.tools as string[]) {
            if (tool.startsWith('mcp__')) {
              const parts = tool.split('__');
              if (parts.length >= 3) {
                const serverName = parts[1];
                if (!toolsByServer[serverName]) toolsByServer[serverName] = [];
                toolsByServer[serverName].push(parts.slice(2).join('__'));
              }
            }
          }
          store.setMcpToolsByServer(toolsByServer);
        }
        // Extract MCP server source origins
        if (event?.mcpServerSources && typeof event.mcpServerSources === 'object') {
          store.setMcpServerSources(event.mcpServerSources as Record<string, string>);
        }
        break;

      case 'assistant_text':
        if (event?.content) {
          batcher.batchText(conversationId, event.content);
        }
        // Clear API retry indicator — streaming resumed successfully
        if (store.streamingState[conversationId]?.apiRetryStatus) {
          store.setApiRetryStatus(conversationId, null);
        }
        break;

      case 'thinking_start':
        store.setThinking(conversationId, true);
        break;

      case 'thinking_delta':
        if (event?.content) {
          batcher.batchThinking(conversationId, event.content);
        }
        break;

      case 'thinking':
        if (event?.content) {
          store.appendThinkingText(conversationId, event.content);
        }
        break;

      case 'tool_start':
        if (event?.id && event?.tool) {
          const agentId = event.agentId as string | undefined;
          if (agentId) {
            store.addSubAgentTool(conversationId, agentId, {
              id: event.id,
              tool: event.tool,
              params: event.params,
              startTime: Date.now(),
              agentId,
            });
          } else {
            const isUserInteractiveTool = event.tool === 'ExitPlanMode' || event.tool === 'AskUserQuestion';
            store.addActiveTool(conversationId, {
              id: event.id,
              tool: event.tool,
              params: event.params,
              startTime: Date.now(),
            }, isUserInteractiveTool ? { skipTimeout: true } : undefined);
          }
        }
        break;

      case 'tool_end':
        if (event?.id) {
          const toolAgentId = event.agentId as string | undefined;
          const stdout = event.stdout as string | undefined;
          const stderr = event.stderr as string | undefined;
          const metadata = event.metadata;

          if (toolAgentId) {
            store.completeSubAgentTool(conversationId, toolAgentId, event.id, event.success, event.summary, stdout, stderr);
          } else {
            const activeTool = store.activeTools[conversationId]?.find(t => t.id === event.id);

            if (activeTool) {
              store.completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr, metadata);
            } else if (event.tool) {
              console.warn(`[WebSocket] tool_end for untracked tool: ${event.id} (${event.tool})`);
              store.addActiveTool(conversationId, {
                id: event.id,
                tool: event.tool as string,
                startTime: Date.now(),
                untracked: true,
              }, { skipTimeout: true });
              store.completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr, metadata);
            }
          }
        }
        break;

      case 'todo_update':
        if (event?.todos && isAgentTodoItemArray(event.todos)) {
          store.setAgentTodos(conversationId, event.todos);
        }
        break;

      case 'name_suggestion':
        if (event?.name && !useSettingsStore.getState().strictPrivacy) {
          store.updateConversation(conversationId, { name: event.name });
        }
        break;

      case 'input_suggestion': {
        const currentStreaming = getStore().streamingState[conversationId];
        if (!currentStreaming?.isStreaming && useSettingsStore.getState().suggestionsEnabled) {
          store.setInputSuggestion(conversationId, {
            ghostText: event?.ghostText || '',
            pills: event?.pills || [],
          });
        }
        break;
      }

      case 'result': {
        const freshStore = getStore();
        const startTime = freshStore.streamingState[conversationId]?.startTime;
        const durationMs = startTime ? Date.now() - startTime : undefined;

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
          metadata: t.metadata,
        }));

        const permissionDenials = Array.isArray(event.permissionDenials) && event.permissionDenials.length > 0
          ? (event.permissionDenials as Array<{ toolName: string; toolUseId: string }>)
          : undefined;

        // Extract context window size BEFORE finalization — finalizeStreamingMessage
        // clears turnStartMeta, which setContextUsage needs to detect [1m] models
        // and clamp the SDK-reported 200K window to the correct 1M.
        const resultModelUsage = event.modelUsage as Record<string, { contextWindow?: number }> | undefined;
        if (resultModelUsage) {
          for (const key of Object.keys(resultModelUsage)) {
            if (resultModelUsage[key]?.contextWindow) {
              freshStore.setContextUsage(conversationId, {
                contextWindow: resultModelUsage[key].contextWindow!,
              });
              break;
            }
          }
        }

        freshStore.finalizeStreamingMessage(conversationId, {
          durationMs,
          toolUsage: toolUsage.length > 0 ? toolUsage : undefined,
          commitQueued: true,
          runSummary: {
            success: event.success !== false,
            cost: event.cost,
            turns: event.turns,
            durationMs,
            stats: event.stats,
            errors: event.errors,
            usage: normalizeUsage(event.usage),
            modelUsage: isModelUsageRecord(event.modelUsage) ? event.modelUsage : undefined,
            limitExceeded: event.subtype === 'error_max_budget_usd' ? 'budget' as const
                         : event.subtype === 'error_max_turns' ? 'turns' as const
                         : undefined,
            permissionDenials,
          },
        });
        // Mark that result already finalized — turn_complete should skip re-finalization
        resultFinalizedSet.add(conversationId);

        // Only mark completed if there were no queued messages at the time of result.
        // If there were queued messages, the agent will pick them up for the next turn.
        // Note: freshStore is a pre-finalization snapshot, so this checks the pre-commit count.
        const hadQueuedMessages = (freshStore.queuedMessages[conversationId] ?? []).length > 0;
        if (!hadQueuedMessages) {
          freshStore.updateConversation(conversationId, { status: 'completed' });
        }
        freshStore.clearAgentTodos(conversationId);
        freshStore.clearPendingUserQuestion(conversationId);
        freshStore.clearPendingToolApproval(conversationId);
        freshStore.clearPendingPlanApproval(conversationId);
        freshStore.clearBackgroundTasks(conversationId);
        const resultConv = freshStore.conversations.find((c) => c.id === conversationId);
        if (resultConv) {
          freshStore.setLastTurnCompletedAt(resultConv.sessionId, Date.now());
        }
        trackEvent('conversation_completed', {
          success: event.success !== false ? 1 : 0,
        });
        notifyBackgroundSession(conversationId);
        notifyDesktop(
          conversationId,
          event.success !== false ? 'Task completed' : 'Task finished with errors',
          getConversationLabel(conversationId),
        );
        // Invalidate dashboard spend data when a turn completes with cost
        if (event.cost && event.cost > 0) {
          dispatchAppEvent('dashboard-spend-invalidate');
        }
        break;
      }

      case 'turn_complete': {
        const turnStore = getStore();
        // If `result` already finalized streaming + committed queued messages,
        // skip re-finalization to avoid setting isStreaming=false in the gap
        // before the next turn's `init`. Just do cleanup.
        if (resultFinalizedSet.has(conversationId)) {
          resultFinalizedSet.delete(conversationId);
          // Only override status to 'active' if there are queued messages the agent
          // will process next. Otherwise leave status as 'completed' (set by result).
          const hasQueuedForNextTurn = (turnStore.queuedMessages[conversationId] ?? []).length > 0;
          if (hasQueuedForNextTurn) {
            turnStore.updateConversation(conversationId, { status: 'active' });
          }
          turnStore.clearAgentTodos(conversationId);
          turnStore.clearPendingToolApproval(conversationId);
          turnStore.clearPendingPlanApproval(conversationId);
          turnStore.clearBackgroundTasks(conversationId);
          const turnConvSkip = turnStore.conversations.find((c) => c.id === conversationId);
          if (turnConvSkip) {
            turnStore.setLastTurnCompletedAt(turnConvSkip.sessionId, Date.now());
          }
          notifyBackgroundSession(conversationId);
          break;
        }

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

        turnStore.finalizeStreamingMessage(conversationId, {
          durationMs: turnDurationMs,
          toolUsage: turnToolUsage.length > 0 ? turnToolUsage : undefined,
          commitQueued: true,
        });
        turnStore.updateConversation(conversationId, { status: 'active' });
        turnStore.clearAgentTodos(conversationId);
        turnStore.clearPendingToolApproval(conversationId);
        turnStore.clearPendingPlanApproval(conversationId);
        turnStore.clearBackgroundTasks(conversationId);
        const turnConv = turnStore.conversations.find((c) => c.id === conversationId);
        if (turnConv) {
          turnStore.setLastTurnCompletedAt(turnConv.sessionId, Date.now());
        }
        notifyBackgroundSession(conversationId);
        break;
      }

      case 'complete': {
        resultFinalizedSet.delete(conversationId);
        store.finalizeStreamingMessage(conversationId, { commitQueued: true, terminal: true });
        store.clearAgentTodos(conversationId);
        store.clearPendingUserQuestion(conversationId);
        store.clearPendingToolApproval(conversationId);
        store.clearPendingPlanApproval(conversationId);
        store.clearBackgroundTasks(conversationId);
        store.updateConversation(conversationId, { status: 'idle' });
        const completeConv = store.conversations.find((c) => c.id === conversationId);
        if (completeConv) {
          store.setLastTurnCompletedAt(completeConv.sessionId, Date.now());
        }
        break;
      }

      case 'permission_mode_changed':
        // Handle plan mode changes from the backend.
        // Events carry a `source` field: "user" (explicit UI action), "exit_plan"
        // (ExitPlanMode restoration), or "sdk_status" (SDK status message).
        if (event?.mode) {
          if (event.mode === 'plan') {
            // User-initiated plan mode activations are always honored.
            // SDK-originated events are suppressed if within the exit cooldown
            // (guards against SDK bug #15755 stale status messages).
            if (event.source === 'user' || event.source === 'enter_plan_tool') {
              // Genuine activation (user toggle or agent EnterPlanMode tool) — always honor
              // and clear cooldown so subsequent sdk_status events for this cycle aren't suppressed.
              clearPlanModeState(conversationId);
              store.setPlanModeActive(conversationId, true);
              // Only notify when user explicitly toggles plan mode. Agent-initiated entry
              // (enter_plan_tool) means the agent just started planning — no plan to review yet.
              if (event.source === 'user') {
                notifyDesktop(conversationId, 'Plan ready for review', 'The AI needs your approval');
              }
            } else if (isInPlanModeExitCooldown(conversationId)) {
              // Suppress — cooldown window handles multiple stale events
            } else {
              store.setPlanModeActive(conversationId, true);
              notifyDesktop(conversationId, 'Plan ready for review', 'The AI needs your approval');
            }
          } else {
            // Exiting plan mode — track so we can suppress stale re-activation
            const current = store.streamingState[conversationId];
            if (current?.planModeActive) {
              markPlanModeExited(conversationId);
            }
            // Only honor plan mode deactivation from explicit sources:
            // - "exit_plan": ExitPlanMode tool completed (postToolUseHook)
            // - "user": user toggled plan mode off via the UI
            // SDK status messages are unreliable — they may carry stale permission
            // modes (e.g., the initial non-plan mode) that override the user's intent.
            if (event.source === 'sdk_status') {
              break;
            }
            store.setPlanModeActive(conversationId, false);
          }
        }
        break;

      case 'plan_approval_request':
        // ExitPlanMode tool intercepted by PreToolUse hook - show approval UI
        // Clear cooldown — this is a fresh plan approval cycle
        clearPlanModeState(conversationId);
        if (event?.requestId) {
          store.setPendingPlanApproval(
            conversationId,
            event.requestId as string,
            event.planContent as string | undefined,
          );
          notifyBackgroundSession(conversationId);
          notifyDesktop(conversationId, 'Plan ready for approval', 'Review and approve the plan to continue');
        }
        break;

      case 'tool_approval_request':
        // Non-bypass permission mode: a tool needs user approval
        if (event?.requestId && event?.toolName) {
          store.setPendingToolApproval(
            conversationId,
            event.requestId as string,
            event.toolName as string,
            (event.toolInput as Record<string, unknown>) || {},
            event.specifier as string | undefined,
          );
          notifyBackgroundSession(conversationId);
          notifyDesktop(conversationId, 'Tool approval needed', `${event.toolName} requires permission`);
        }
        break;

      case 'tool_batch_approval_request':
        // Batch approval: multiple tools need user approval at once
        if (event?.requestId && Array.isArray(event.batchApprovalItems)) {
          const rawItems = event.batchApprovalItems as unknown[];
          const items = rawItems.filter((i): i is { toolUseId: string; toolName: string; toolInput: Record<string, unknown>; specifier?: string } =>
            typeof i === 'object' && i !== null &&
            'toolUseId' in i && 'toolName' in i && 'toolInput' in i
          );
          if (items.length !== rawItems.length) {
            console.warn(`batch approval: ${rawItems.length - items.length} item(s) had unexpected shape and were filtered out`);
          }
          if (items.length === 0) break;
          store.setPendingBatchToolApproval(conversationId, event.requestId as string, items);
          const toolNames = items.map((i) => i.toolName).join(', ');
          notifyBackgroundSession(conversationId);
          notifyDesktop(conversationId, 'Tools need approval', `${items.length} tools: ${toolNames}`);
        }
        break;

      case 'plan_mode_auto_exited':
        store.setPlanModeActive(conversationId, false);
        markPlanModeExited(conversationId);
        break;

      case 'auth_error': {
        const authMessage = event?.message || 'Authentication failed. Check your API key in Settings > Claude Code.';
        console.error('Auth error:', authMessage);
        store.setStreamingError(conversationId, authMessage);
        store.updateConversation(conversationId, { status: 'idle' });
        notifyDesktop(conversationId, 'Authentication error', (authMessage as string).slice(0, 100));
        break;
      }

      case 'error': {
        const errorMessage = event?.message || 'An unknown error occurred';
        console.error('Conversation error:', errorMessage);

        const currentError = useAppStore.getState().streamingState[conversationId]?.error;
        if (currentError && isAuthErrorMessage(currentError)) {
          break;
        }

        store.finalizeStreamingMessage(conversationId, { commitQueued: true, terminal: true });
        store.clearPendingToolApproval(conversationId);
        store.clearPendingPlanApproval(conversationId);
        store.setStreamingError(conversationId, errorMessage);
        store.updateConversation(conversationId, { status: 'idle' });
        notifyDesktop(conversationId, 'Task error', (errorMessage || 'Unknown error').slice(0, 100));
        break;
      }

      case 'streaming_warning': {
        const now = Date.now();
        if (now - getLastDropStatsFetchTime() >= DROP_STATS_DEBOUNCE_MS) {
          updateLastDropStatsFetchTime(now);
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
            window.dispatchEvent(new CustomEvent('streaming-warning', {
              detail: {
                source: event?.source,
                reason: event?.reason,
                message: event?.message || 'Some streaming data may have been lost',
              }
            }));
          });
        } else {
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
        if (event?.requestId && isUserQuestionArray(event?.questions)) {
          store.setPendingUserQuestion(conversationId, {
            requestId: event.requestId as string,
            questions: event.questions,
            currentIndex: 0,
            answers: {},
          });
          notifyBackgroundSession(conversationId);
          notifyDesktop(conversationId, 'Question from AI', 'The AI needs your input');
        }
        break;

      case 'context_usage':
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
        if (event?.contextWindow) {
          store.setContextUsage(conversationId, {
            contextWindow: event.contextWindow,
          });
        }
        break;

      case 'compact_boundary':
        store.setContextUsage(conversationId, {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        });
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: 'Context compacted',
            message: event?.trigger
              ? `Conversation context was compacted (${event.trigger})`
              : 'Conversation context was compacted to stay within limits',
            type: 'info',
            conversationId,
          }
        }));
        // Inject compact boundary into the streaming timeline so it appears
        // inline at the correct chronological position (not as a separate system message).
        store.setCompactBoundary(conversationId, {
          timestamp: Date.now(),
          trigger: typeof event?.trigger === 'string' ? event.trigger : undefined,
        });
        break;

      case 'pre_compact':
        break;

      case 'post_compact':
        // SDK 0.2.76: PostCompact hook fires after compaction with the conversation summary.
        // Enrich the compact boundary in the streaming state with the summary.
        if (typeof event?.compactSummary === 'string' && event.compactSummary) {
          store.setCompactSummary(conversationId, event.compactSummary);
        }
        break;

      case 'tool_progress':
        if (event?.parentToolUseId || event?.id) {
          const toolId = (event.id ?? event.parentToolUseId) as string;
          store.updateToolProgress(conversationId, toolId, {
            elapsedTimeSeconds: event.elapsedTimeSeconds as number | undefined,
            toolName: event.toolName as string | undefined,
          });
        }
        break;

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

      case 'checkpoint_created':
        if (event?.checkpointUuid) {
          store.addCheckpoint({
            uuid: event.checkpointUuid as string,
            timestamp: new Date().toISOString(),
            messageIndex: event.messageIndex ?? 0,
            isResult: event.isResult as boolean | undefined,
            conversationId,
          });
          store.setPendingCheckpointUuid(conversationId, String(event.checkpointUuid));
        }
        break;

      case 'files_rewound': {
        const success = event?.success !== false;
        const errorMsg = event?.error as string | undefined;
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: success ? 'Files rewound' : 'Rewind failed',
            message: success
              ? 'Files restored to checkpoint'
              : `Failed to rewind: ${errorMsg || 'Unknown error'}`,
            type: success ? 'info' : 'error',
            conversationId,
          }
        }));
        break;
      }

      case 'model_changed':
        if (event?.model) {
          store.updateConversation(conversationId, { model: event.model as string });
        }
        break;

      case 'fast_mode_changed':
        // Confirm fast mode toggle from agent-runner — dispatch event so ChatInput can sync
        window.dispatchEvent(new CustomEvent('fast-mode-synced', {
          detail: { conversationId, enabled: !!(event as unknown as { fastMode?: boolean })?.fastMode },
        }));
        break;

      case 'interrupted':
        store.finalizeStreamingMessage(conversationId, { commitQueued: true, terminal: true });
        store.clearPendingToolApproval(conversationId);
        store.clearPendingPlanApproval(conversationId);
        addSystemMessage(conversationId, 'Agent was stopped by user.')
          .then(({ id }) => {
            store.addMessage({
              id,
              conversationId,
              role: 'system',
              content: 'Agent was stopped by user.',
              timestamp: new Date().toISOString(),
            });
          })
          .catch((err) => console.warn('Failed to persist stopped message:', err));
        store.clearPendingUserQuestion(conversationId);
        store.updateConversation(conversationId, { status: 'idle' });
        break;

      case 'user_question_timeout':
      case 'user_question_cancelled':
        store.clearPendingUserQuestion(conversationId);
        break;

      case 'hook_tool_failure':
        console.debug(`[Hook] Tool failure: ${event?.tool} — ${event?.error}`);
        break;

      case 'hook_pre_tool':
      case 'hook_post_tool':
      case 'hook_response':
        break;

      case 'session_started':
      case 'session_ended':
      case 'session_id_update':
        break;

      case 'agent_stop':
        break;

      case 'command_error':
        if (event?.message) {
          store.setStreamingError(conversationId, event.message as string);
        }
        break;

      case 'auth_status': {
        const isAuthenticating = event?.isAuthenticating;
        if (isAuthenticating) {
          window.dispatchEvent(new CustomEvent('agent-notification', {
            detail: {
              title: 'Authenticating',
              message: event?.output?.[0] || 'Authenticating with provider...',
              type: 'info',
              conversationId,
            }
          }));
        } else if (event?.error) {
          window.dispatchEvent(new CustomEvent('agent-notification', {
            detail: {
              title: 'Authentication failed',
              message: String(event.error),
              type: 'error',
              conversationId,
            }
          }));
        }
        break;
      }

      case 'status_update':
        break;

      case 'session_recovering':
        store.setAgentRecovering(
          conversationId,
          typeof event.attempt === 'number' ? event.attempt : 1,
          typeof event.maxAttempts === 'number' ? event.maxAttempts : 3,
        );
        break;

      case 'warning':
        if (event?.message) {
          window.dispatchEvent(new CustomEvent('agent-notification', {
            detail: {
              title: 'Agent warning',
              message: event.message,
              type: 'warning',
              conversationId,
            }
          }));
        }
        break;

      case 'agent_stderr':
      case 'json_parse_error':
        console.warn(`[Agent] ${data.type}:`, event?.message || event?.data);
        break;

      case 'supported_models':
        if (event?.models) {
          store.setSupportedModels(event.models as Array<{
            value: string;
            displayName: string;
            description: string;
            supportsEffort?: boolean;
            supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[];
            supportsAdaptiveThinking?: boolean;
            supportsFastMode?: boolean;
          }>);
        }
        break;

      case 'supported_commands':
        if (event?.commands) {
          const cmds = event.commands as Array<{ name: string; description: string; argumentHint: string }>;
          store.setSupportedCommands(cmds);
          useSlashCommandStore.getState().setSdkCommandsRich(cmds);
        }
        break;

      case 'mcp_status':
        if (event?.servers && isMcpServerStatusArray(event.servers)) {
          store.setMcpServers(event.servers);
        }
        break;

      case 'mcp_server_reconnected':
        if (event?.serverName) {
          store.updateMcpServerStatus(event.serverName as string, 'connected');
        }
        break;

      case 'mcp_server_toggled':
        if (event?.serverName) {
          if (event.enabled === true) {
            store.updateMcpServerStatus(event.serverName as string, 'connected');
          } else if (event.enabled === false) {
            store.removeMcpServer(event.serverName as string);
          }
        }
        break;

      case 'account_info':
        if (event?.info) {
          store.setAccountInfo(event.info as Record<string, unknown>);
        }
        break;

      case 'subagent_started':
        if (event?.agentId && event?.agentType) {
          store.addSubAgent(conversationId, {
            agentId: event.agentId as string,
            agentType: event.agentType as string,
            parentToolUseId: event.parentToolUseId as string | undefined,
            description: event.description,
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

      case 'subagent_output':
        if (event?.agentId) {
          store.setSubAgentOutput(conversationId, event.agentId as string, event.agentOutput || '');
        }
        break;

      case 'subagent_usage':
        if (event?.toolUseId && event?.usage) {
          const usage = event.usage as { totalTokens: number; toolUses: number; durationMs: number };
          store.setSubAgentUsage(conversationId, event.toolUseId as string, usage);
        }
        break;

      // ── SDK 0.2.84+ background task events ──────────────────────

      case 'task_started':
        if (event?.taskId) {
          store.addBackgroundTask(conversationId, {
            taskId: event.taskId!,
            toolUseId: event.toolUseId,
            description: event.description,
            status: 'running',
            startTime: Date.now(),
          });
          // Auto-switch sidebar bottom panel to Background tab (only for the task's own session)
          if (data.sessionId) {
            dispatchAppEvent('sidebar-switch-bottom-tab', { tab: 'background', sessionId: data.sessionId });
          }
        }
        break;

      case 'task_progress':
        if (event?.taskId) {
          const taskUsage = event.taskUsage;
          store.updateBackgroundTask(conversationId, event.taskId as string, {
            lastToolName: event.lastToolName,
            ...(taskUsage ? {
              usage: {
                totalTokens: taskUsage.total_tokens ?? 0,
                toolUses: taskUsage.tool_uses ?? 0,
                durationMs: taskUsage.duration_ms ?? 0,
              },
            } : {}),
          });
        }
        break;

      case 'task_stopped':
        if (event?.taskId) {
          const stoppedTaskId = event.taskId as string;
          const existing = store.backgroundTasks[conversationId]?.find(t => t.taskId === stoppedTaskId);
          if (existing?.status !== 'stopped') {
            store.stopBackgroundTask(conversationId, stoppedTaskId);
          }
          // Remove completed task after a brief delay so the user sees the green completion indicator
          setTimeout(() => {
            store.removeBackgroundTask(conversationId, stoppedTaskId);
          }, 2000);
        }
        break;

      // ── SDK 0.2.72+ event types ──────────────────────────────────

      case 'prompt_suggestion':
        if (event?.suggestion && typeof event.suggestion === 'string') {
          store.addPromptSuggestion(conversationId, event.suggestion);
        }
        break;

      case 'tool_use_summary':
        if (event?.summary && event?.precedingToolUseIds) {
          store.addToolUseSummary(conversationId, {
            summary: event.summary as string,
            toolUseIds: event.precedingToolUseIds as string[],
          });
        }
        break;

      case 'rate_limit':
        if (event?.rateLimitInfo) {
          window.dispatchEvent(new CustomEvent('agent-notification', {
            detail: { title: 'Rate limited', message: 'API rate limit reached, requests will be delayed', type: 'warning', conversationId },
          }));
        }
        break;

      case 'elicitation_request':
        if (event?.mcpServerName) {
          window.dispatchEvent(new CustomEvent('agent-notification', {
            detail: { title: 'MCP Input', message: `${event.mcpServerName as string} is requesting input...`, type: 'info', conversationId },
          }));
        }
        break;

      case 'elicitation_result':
      case 'elicitation_complete':
      case 'hook_started':
      case 'hook_progress':
      case 'worktree_created':
      case 'worktree_removed':
      case 'instructions_loaded':
      case 'supported_agents':
      case 'mcp_servers_updated':
      case 'initialization_result':
      case 'session_forked':
      case 'message_cancelled':
      case 'file_changed':
      case 'task_created':
        // Informational events — no frontend state changes needed
        break;

      // SDK 0.2.84+ events

      case 'api_retry': {
        const attempt = event.attempt as number;
        const maxRetries = event.maxRetries as number;
        const retryDelayMs = event.retryDelayMs as number;
        const error = event.error as string;
        store.setApiRetryStatus(conversationId, { attempt, maxRetries, retryDelayMs, error });
        break;
      }

      case 'session_state_changed': {
        const state = event.state as string;
        if (state === 'idle') {
          store.updateConversation(conversationId, { status: 'idle' });
        } else if (state === 'running') {
          store.updateConversation(conversationId, { status: 'active' });
        }
        // 'requires_action' is already handled by permission/question request events
        break;
      }

      case 'stop_failure': {
        const errorType = event.error as string;
        const errorDetails = event.errorDetails as string | undefined;
        window.dispatchEvent(new CustomEvent('agent-notification', {
          detail: {
            title: 'Agent error',
            message: errorDetails || `API error: ${errorType}`,
            type: 'error',
            conversationId,
          },
        }));
        break;
      }

      case 'cwd_changed': {
        // Working directory changed — dispatch custom event for file tree refresh
        window.dispatchEvent(new CustomEvent('cwd-changed', {
          detail: {
            conversationId,
            oldCwd: event.oldCwd as string,
            newCwd: event.newCwd as string,
          },
        }));
        break;
      }

    }
  // getStore is a stable reference (useAppStore.getState), no deps needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a WebSocket reconnection, reconcile frontend streaming state with backend reality.
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
          store.finalizeStreamingMessage(convId, { commitQueued: true, terminal: true });
          store.clearPendingToolApproval(convId);
          store.clearPendingPlanApproval(convId);
          store.clearThinking(convId);
          store.updateConversation(convId, { status: 'completed' });

          try {
            const page = await getConversationMessages(convId, { compact: true });
            const messages = page.messages.map(m => toStoreMessage(m, convId, { compacted: true }));
            store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
          } catch (err) {
            console.warn(`Failed to reload messages for ${convId} after reconnect:`, err);
          }
        } else {
          startReconciling(convId);
          try {
            const snapshot = await getStreamingSnapshot(convId);
            if (snapshot && snapshot.text) {
              store.restoreStreamingFromSnapshot(convId, snapshot);
            } else {
              try {
                const page = await getConversationMessages(convId, { compact: true });
                const messages = page.messages.map(m => toStoreMessage(m, convId, { compacted: true }));
                store.setMessagePage(convId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
              } catch (innerErr) {
                console.warn(`Failed to reload messages for ${convId} during snapshot fallback:`, innerErr);
              }
            }
          } catch (err) {
            console.warn(`Failed to fetch streaming snapshot for ${convId}:`, err);
          } finally {
            stopReconciling(convId);
          }
        }
      }
    } catch (err) {
      console.warn('Failed to reconcile streaming state after reconnect:', err);
    }

    // Refresh PR status for ALL sessions with open PRs to catch events missed during disconnect.
    try {
      const { sessions } = getStore();
      const openPRSessions = sessions.filter(s => s.prStatus === 'open');
      for (const session of openPRSessions) {
        refreshPRStatus(session.workspaceId, session.id).catch(() => {});
        await new Promise(r => setTimeout(r, 150));
      }
    } catch {
      // Silently ignore
    }
  // getStore is a stable reference (useAppStore.getState), no deps needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After the first WebSocket connection, discover conversations that are actively
  // streaming on the backend.
  const reconcileInitialStreamingState = useCallback(async () => {
    const store = getStore();

    // Phase 1: Discover conversations that are actively streaming (agent still running)
    try {
      const { conversationIds: serverActive } = await getActiveStreamingConversations();

      for (const convId of serverActive) {
        const conv = store.conversations.find(c => c.id === convId);
        if (!conv) continue;

        store.updateConversation(convId, { status: 'active' });

        startReconciling(convId);
        try {
          const snapshot = await getStreamingSnapshot(convId);
          if (snapshot && snapshot.text) {
            store.restoreStreamingFromSnapshot(convId, snapshot);
          } else {
            store.setStreaming(convId, true);
          }
        } catch (err) {
          console.warn(`Failed to fetch initial streaming snapshot for ${convId}:`, err);
          store.setStreaming(convId, true);
        } finally {
          stopReconciling(convId);
        }
      }
    } catch (err) {
      console.warn('Failed to reconcile initial streaming state:', err);
    }

    // Phase 2: Discover conversations interrupted by app shutdown
    try {
      const interrupted = await getInterruptedConversations();
      for (const item of interrupted) {
        const conv = store.conversations.find(c => c.id === item.id);
        if (!conv) continue;

        store.updateConversation(item.id, { status: 'idle' });
        store.setInterruptedState(item.id, {
          agentSessionId: item.agentSessionId,
          hadPendingPlan: !!item.snapshot?.pendingPlanApproval,
          hadPendingQuestion: !!item.snapshot?.pendingUserQuestion,
          hadPendingElicitation: !!item.snapshot?.pendingElicitation,
          elicitationMcpServer: item.snapshot?.pendingElicitation?.mcpServerName,
          snapshot: item.snapshot,
        });
        // Inject the snapshot's text as a visible assistant message so the user
        // can see what the agent produced before the interruption. The dedup
        // inside injectInterruptedAssistantMessage prevents duplicates if the
        // backend's ConvertSnapshotsToMessages already persisted it.
        if (item.snapshot?.text) {
          store.injectInterruptedAssistantMessage(item.id, item.snapshot);
        }
      }
    } catch (err) {
      console.warn('Failed to reconcile interrupted conversations:', err);
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

    await getBackendPort();

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
        reconcileStreamingState();
        // Re-sync sessions that may have been created during disconnect (e.g., scheduled tasks).
        // Merge rather than replace to avoid overwriting concurrent WS-driven updates.
        listAllSessions(true).then((sessions) => {
          const store = getStore();
          const mapped = sessions.map(mapSessionDTO);
          const existing = store.sessions;
          const existingIds = new Set(existing.map((s) => s.id));
          for (const s of mapped) {
            if (existingIds.has(s.id)) {
              store.updateSession(s.id, s);
            } else {
              store.addSession(s);
            }
          }
        }).catch((err) => {
          console.warn('Failed to re-sync sessions on reconnect:', err);
        });
        // Refresh scheduled task state (next_run_at, last_run_at may have changed)
        useScheduledTaskStore.getState().fetchTasks();
      } else {
        reconcileInitialStreamingState();
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

        // Handle init event for MCP server status and source tracking
        if (data.type === 'init') {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload?.mcpServers && Array.isArray(payload.mcpServers)) {
            getStore().setMcpServers(payload.mcpServers);
          }
          if (payload?.mcpServerSources && typeof payload.mcpServerSources === 'object') {
            getStore().setMcpServerSources(payload.mcpServerSources as Record<string, string>);
          }
          return;
        }

        // Handle Ollama progress events (binary download or model pull)
        if (data.type === 'ollama_download' || data.type === 'ollama_pull') {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload) {
            // Cancel any pending clear timer so a new operation isn't clobbered
            if (ollamaProgressClearTimer !== null) {
              clearTimeout(ollamaProgressClearTimer);
              ollamaProgressClearTimer = null;
            }
            const rawPercent = typeof payload.percent === 'number' ? payload.percent : 0;

            // Negative percent signals an error from the backend (see ollama_handlers.go broadcastError)
            if (rawPercent < 0) {
              getStore().setOllamaProgress({
                type: data.type as 'ollama_download' | 'ollama_pull',
                status: typeof payload.status === 'string' ? payload.status : 'Error',
                percent: 0,
                downloaded: 0,
                total: 0,
                timestamp: Date.now(),
              });
              ollamaProgressClearTimer = setTimeout(() => {
                getStore().setOllamaProgress(null);
                ollamaProgressClearTimer = null;
              }, 5000);
              return;
            }

            const percent = rawPercent;
            // Throttle non-final updates to ~3/s — the CSS transition (duration-300)
            // smooths the visual, so more frequent React re-renders add no benefit.
            const now = Date.now();
            const lastUpdate = getStore().ollamaProgress?.timestamp ?? 0;
            if (percent < 100 && now - lastUpdate < 300) {
              return;
            }
            getStore().setOllamaProgress({
              type: data.type as 'ollama_download' | 'ollama_pull',
              status: typeof payload.status === 'string' ? payload.status : '',
              model: typeof payload.model === 'string' ? payload.model : undefined,
              percent,
              downloaded: typeof payload.downloaded === 'number' ? payload.downloaded : 0,
              total: typeof payload.total === 'number' ? payload.total : 0,
              timestamp: now,
            });
            // Clear progress when complete (after brief display)
            if (percent >= 100) {
              ollamaProgressClearTimer = setTimeout(() => {
                getStore().setOllamaProgress(null);
                ollamaProgressClearTimer = null;
              }, 1500);
            }
          }
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

        // Handle session task status auto-update
        if (data.type === 'session_task_status_update' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload?.taskStatus && typeof payload.taskStatus === 'string') {
            getStore().updateSession(data.sessionId, {
              taskStatus: payload.taskStatus as import('@/lib/types').SessionTaskStatus,
            });
          }
          return;
        }

        // Handle session stats update (real-time stats from file watcher)
        if (data.type === 'session_stats_update' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          const stats = payload?.stats as { additions: number; deletions: number } | null | undefined;
          getStore().updateSession(data.sessionId, { stats: stats ?? undefined });
          // Signal git status hooks to refetch (branch watcher detected index change)
          getStore().setLastStatsInvalidation(data.sessionId);
          return;
        }

        // Handle scheduled task run events — refresh sessions and task store
        if (data.type === 'scheduled_task_run') {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload?.sessionId && typeof payload.sessionId === 'string') {
            // Fetch all sessions to find the newly created one
            listAllSessions().then((sessions) => {
              const store = getStore(); // fresh read inside callback
              for (const dto of sessions) {
                const mapped = mapSessionDTO(dto);
                const existing = store.sessions.find((s) => s.id === mapped.id);
                if (!existing) {
                  store.addSession(mapped);
                }
              }
            }).catch(() => {});
            // Refresh scheduled task store
            useScheduledTaskStore.getState().fetchTasks();
          }
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
          if (data.type === 'branch_dashboard_update') {
            useBranchCacheStore.getState().invalidateAll();
          }
          window.dispatchEvent(new CustomEvent(data.type, { detail: data.payload }));
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
              prTitle?: string;
              hasCheckFailures?: boolean;
              hasMergeConflict?: boolean;
              checkStatus?: 'none' | 'pending' | 'success' | 'failure';
              taskStatus?: import('@/lib/types').SessionTaskStatus;
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
            if (typeof payload.prTitle === 'string') {
              updates.prTitle = payload.prTitle;
            }
            if (typeof payload.checkStatus === 'string') {
              updates.hasCheckFailures = payload.checkStatus === 'failure';
              updates.checkStatus = payload.checkStatus as 'none' | 'pending' | 'success' | 'failure';
            }
            if (typeof payload.mergeable === 'boolean') {
              updates.hasMergeConflict = !payload.mergeable;
            }
            if (typeof payload.taskStatus === 'string') {
              updates.taskStatus = payload.taskStatus as import('@/lib/types').SessionTaskStatus;
            }

            // When PR is cleared (e.g., branch switch), ensure all PR fields are reset
            if (updates.prStatus === 'none') {
              updates.prNumber = 0;
              updates.prUrl = '';
              updates.prTitle = '';
              updates.checkStatus = 'none';
              updates.hasCheckFailures = false;
              updates.hasMergeConflict = false;
            }

            const prevPrStatus = getStore().sessions.find(
              (s: { id: string }) => s.id === data.sessionId
            )?.prStatus;
            getStore().updateSession(data.sessionId, updates);

            if (updates.prStatus === 'open' && prevPrStatus !== 'open') {
              trackEvent('pr_created');
            } else if (updates.prStatus === 'merged' && prevPrStatus !== 'merged') {
              trackEvent('pr_merged');
            }

            // Clear stale input suggestions for conversations in this session
            const sessionConvs = getStore().conversations.filter(
              (c: { sessionId: string }) => c.sessionId === data.sessionId
            );
            for (const conv of sessionConvs) {
              getStore().clearInputSuggestion(conv.id);
            }

            // Auto-archive on merge if setting is enabled
            if (updates.prStatus === 'merged') {
              const { archiveOnMerge, deleteBranchOnArchive } = useSettingsStore.getState();
              const sid = data.sessionId!;
              if (archiveOnMerge) {
                const session = getStore().sessions.find((s: { id: string }) => s.id === sid);
                if (session && !session.archived) {
                  updateSessionApi(session.workspaceId, sid, {
                    archived: true,
                    ...(deleteBranchOnArchive ? { deleteBranch: true } : {}),
                  }).then((result) => {
                    // Unregister from file watcher — no need to watch archived/deleted sessions
                    if (session.worktreePath) {
                      const dirName = getSessionDirName(session.worktreePath);
                      if (dirName) unregisterSession(dirName);
                    }
                    if (result === null) {
                      getStore().removeSession(sid);
                    } else {
                      getStore().archiveSession(sid);
                    }
                  }).catch((err: unknown) => {
                    console.error('Failed to auto-archive on merge:', err);
                  });
                }
              }
            }
          }
          return;
        }

        // Handle archive summary updates
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
            if (data.sessionId === getStore().selectedSessionId) {
              window.dispatchEvent(new CustomEvent('select-sidebar-tab', { detail: { tab: 'review' } }));
            }
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

        // Legacy agent events
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

      const { sidecarState } = useConnectionStore.getState();
      if (sidecarState === 'restarting' || sidecarState === 'failed') {
        return;
      }

      if (enabledRef.current && connectRef.current) {
        attemptRef.current += 1;
        const attempt = attemptRef.current;

        if (attempt <= WEBSOCKET_RECONNECT_MAX_ATTEMPTS) {
          useConnectionStore.getState().setConnecting(attempt);
          const delay = Math.min(
            WEBSOCKET_RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
            WEBSOCKET_RECONNECT_MAX_DELAY_MS,
          );
          reconnectTimeoutRef.current = setTimeout(connectRef.current, delay);
        }
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
      batcherRef.current?.destroy();
      cleanupOllamaProgressTimer();
    };
  }, [enabled, connect]);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    useConnectionStore.getState().setConnecting(0);
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    const oldWs = wsRef.current;
    if (oldWs) {
      oldWs.onclose = null;
      oldWs.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  return { reconnect };
}
