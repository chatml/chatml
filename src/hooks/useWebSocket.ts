'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, AgentEvent, AgentTodoItem, UserQuestion, ReviewComment, TokenUsage, ModelUsageInfo, McpServerStatus } from '@/lib/types';

import {
  WEBSOCKET_RECONNECT_BASE_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_DELAY_MS,
  WEBSOCKET_RECONNECT_MAX_ATTEMPTS,
} from '@/lib/constants';
import { getAuthToken } from '@/lib/auth-token';
import { getBackendPort, getBackendPortSync } from '@/lib/backend-port';
import { useConnectionStore } from '@/stores/connectionStore';
import { getConversationDropStats, getActiveStreamingConversations, getConversationMessages, getStreamingSnapshot, toStoreMessage, updateSession as updateSessionApi } from '@/lib/api';
import { useSettingsStore } from '@/stores/settingsStore';
import { useBranchCacheStore } from '@/stores/branchCacheStore';
import { useSlashCommandStore } from '@/stores/slashCommandStore';
import { notifyDesktop, getConversationLabel } from '@/hooks/useDesktopNotifications';
import { playSound } from '@/lib/sounds';

// Conversations that recently exited plan mode. Maps conversationId → exit timestamp.
// Used to suppress stale SDK status messages that try to re-activate plan mode after
// ExitPlanMode approval (SDK bug #15755). A timestamp-based cooldown ensures multiple
// stale events are all suppressed (not just the first one, as with a Set).
const recentlyExitedPlanMode = new Map<string, number>();
const PLAN_MODE_EXIT_COOLDOWN_MS = 5000;

// Check if a conversation is within the plan mode exit cooldown window
function isInPlanModeExitCooldown(conversationId: string): boolean {
  const exitTime = recentlyExitedPlanMode.get(conversationId);
  if (exitTime == null) return false;
  return Date.now() - exitTime < PLAN_MODE_EXIT_COOLDOWN_MS;
}

// Allow UI components (e.g. plan approval, toggle) to mark a conversation as recently
// exited so that stale `init` or `permission_mode_changed` events don't re-activate it.
export function markPlanModeExited(conversationId: string) {
  recentlyExitedPlanMode.set(conversationId, Date.now());
  // Auto-cleanup after cooldown expires
  setTimeout(() => {
    // Only delete if timestamp hasn't been refreshed
    const exitTime = recentlyExitedPlanMode.get(conversationId);
    if (exitTime != null && Date.now() - exitTime >= PLAN_MODE_EXIT_COOLDOWN_MS) {
      recentlyExitedPlanMode.delete(conversationId);
    }
  }, PLAN_MODE_EXIT_COOLDOWN_MS + 100);
}

/**
 * Mark a session as unread and play an in-app sound when a background session
 * has a notable event (turn complete, question, plan approval).
 * Only fires if the conversation belongs to a session that is NOT currently selected.
 * Sound plays even when the app is focused (notifyDesktop only plays when unfocused).
 */
function notifyBackgroundSession(conversationId: string): void {
  const state = useAppStore.getState();
  const conv = state.conversations.find((c) => c.id === conversationId);
  if (!conv || conv.sessionId === state.selectedSessionId) return;

  useSettingsStore.getState().markSessionUnread(conv.sessionId);

  // Play in-app sound when focused (notifyDesktop handles the unfocused case)
  if (typeof document !== 'undefined' && document.hasFocus()) {
    const { soundEffects, soundEffectType } = useSettingsStore.getState();
    if (soundEffects) {
      playSound(soundEffectType);
    }
  }
}

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

// Check if an error message is auth-related (used for deduplication)
function isAuthErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('authentication') || lower.includes('api key') || lower.includes('oauth');
}

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

function isModelUsageRecord(value: unknown): value is Record<string, ModelUsageInfo> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(v => {
    if (typeof v !== 'object' || v === null) return false;
    const entry = v as Record<string, unknown>;
    return typeof entry.inputTokens === 'number' && typeof entry.outputTokens === 'number';
  });
}

function isUserQuestionArray(value: unknown): value is UserQuestion[] {
  if (!Array.isArray(value)) return false;
  return value.every(q => {
    if (typeof q !== 'object' || q === null) return false;
    const obj = q as Record<string, unknown>;
    return typeof obj.question === 'string' && typeof obj.header === 'string' && Array.isArray(obj.options);
  });
}

function isMcpServerStatusArray(value: unknown): value is McpServerStatus[] {
  if (!Array.isArray(value)) return false;
  return value.every(s => {
    if (typeof s !== 'object' || s === null) return false;
    const obj = s as Record<string, unknown>;
    return typeof obj.name === 'string' && typeof obj.status === 'string';
  });
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
        // Safety net: when backend says idle, clear any stale streaming state.
        // This catches cases where result/complete events were dropped or missed.
        if (data.payload === 'idle' && store.streamingState[conversationId]?.isStreaming) {
          store.commitQueuedMessage(conversationId);
          store.clearStreamingText(conversationId);
          store.clearActiveTools(conversationId);
          store.clearThinking(conversationId);
          store.clearSubAgents(conversationId);
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
        // process was restarted. Clear stale content but preserve isStreaming and startTime
        // so the "Agent is working" timer continues uninterrupted.
        if (store.streamingState[conversationId]?.isStreaming) {
          store.clearStreamingContent(conversationId);
          store.clearActiveTools(conversationId);
          store.clearThinking(conversationId);
          store.clearSubAgents(conversationId);
        }
        // Clear stale input suggestions from the previous turn
        store.clearInputSuggestion(conversationId);
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
        break;

      case 'assistant_text':
        // Append streaming text - mark thinking as done but preserve content
        if (event?.content) {
          store.setThinking(conversationId, false);
          store.appendStreamingText(conversationId, event.content);
          // Clear input suggestions when new turn starts streaming
          store.clearInputSuggestion(conversationId);
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

          }
        }
        break;

      case 'tool_end':
        // Complete active tool with success/summary info
        // For Bash tools, also capture stdout/stderr; for all tools, capture metadata
        if (event?.id) {
          const toolAgentId = event.agentId as string | undefined;
          const stdout = event.stdout as string | undefined;
          const stderr = event.stderr as string | undefined;
          const metadata = event.metadata;

          if (toolAgentId) {
            // Sub-agent tool completion
            store.completeSubAgentTool(conversationId, toolAgentId, event.id, event.success, event.summary, stdout, stderr);
          } else {
            // Parent agent tool
            const activeTool = store.activeTools[conversationId]?.find(t => t.id === event.id);

            if (activeTool) {
              // Normal path: tool exists in state
              store.completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr, metadata);
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
              store.completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr, metadata);
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
        // Update conversation name (unless strict privacy is enabled)
        if (event?.name && !useSettingsStore.getState().strictPrivacy) {
          store.updateConversation(conversationId, { name: event.name });
        }
        break;

      case 'input_suggestion': {
        // AI-generated input suggestion (ghost text + optional pills)
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
            modelUsage: isModelUsageRecord(event.modelUsage) ? event.modelUsage : undefined,
            limitExceeded: event.subtype === 'error_max_budget_usd' ? 'budget' as const
                         : event.subtype === 'error_max_turns' ? 'turns' as const
                         : undefined,
          },
        });
        // Update context meter from reliable result data.
        // This ensures the meter is always updated at the end of each turn, even if
        // the per-message context_usage events were unreliable during streaming.
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
        const resultUsage = normalizeUsage(event.usage);
        if (resultUsage && resultUsage.inputTokens > 0) {
          freshStore.setContextUsage(conversationId, {
            inputTokens: resultUsage.inputTokens,
            outputTokens: resultUsage.outputTokens,
            cacheReadInputTokens: resultUsage.cacheReadInputTokens ?? 0,
            cacheCreationInputTokens: resultUsage.cacheCreationInputTokens ?? 0,
          });
        }
        // Update conversation status to completed
        freshStore.updateConversation(conversationId, { status: 'completed' });
        // Clear agent todos — tasks are no longer relevant after turn ends
        freshStore.clearAgentTodos(conversationId);
        // Clear any stale pending question — the turn is over
        freshStore.clearPendingUserQuestion(conversationId);
        // Trigger changes panel refresh for this session
        const resultConv = freshStore.conversations.find((c) => c.id === conversationId);
        if (resultConv) {
          freshStore.setLastTurnCompletedAt(resultConv.sessionId, Date.now());
        }
        // Notify background session (unread dot + in-app sound when focused)
        notifyBackgroundSession(conversationId);
        // Desktop notification for task completion.
        // success defaults to true when the field is absent (only explicitly false means failure).
        notifyDesktop(
          conversationId,
          event.success !== false ? 'Task completed' : 'Task finished with errors',
          getConversationLabel(conversationId),
        );
        break;
      }

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
        // Commit queued message to messages array (if any).
        // Must happen AFTER finalize (which checked for queued to keep isStreaming).
        turnStore.commitQueuedMessage(conversationId);
        // Explicitly set status to active — finalizeStreamingMessage only clears
        // streaming/activeTools state but does NOT update conversation status.
        // The process is still alive and ready for the next message.
        turnStore.updateConversation(conversationId, { status: 'active' });
        // Clear agent todos — tasks are no longer relevant after turn ends
        turnStore.clearAgentTodos(conversationId);
        // Trigger changes panel refresh for this session
        const turnConv = turnStore.conversations.find((c) => c.id === conversationId);
        if (turnConv) {
          turnStore.setLastTurnCompletedAt(turnConv.sessionId, Date.now());
        }
        // Notify background session (unread dot + in-app sound when focused)
        notifyBackgroundSession(conversationId);
        break;
      }

      case 'complete': {
        // Complete event signals the entire conversation ended (stdin closed)
        // Commit any queued message so it appears in history
        store.commitQueuedMessage(conversationId);
        // Clear any remaining state
        store.clearStreamingText(conversationId);
        store.setStreaming(conversationId, false);
        store.clearThinking(conversationId);
        store.clearActiveTools(conversationId);
        store.clearSubAgents(conversationId);
        store.clearAgentTodos(conversationId);
        store.clearPendingUserQuestion(conversationId);
        // Update conversation status to idle (ready for new input)
        store.updateConversation(conversationId, { status: 'idle' });
        // Trigger changes panel refresh for this session
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
            if (event.source === 'user') {
              recentlyExitedPlanMode.delete(conversationId);
              store.setPlanModeActive(conversationId, true);
              notifyDesktop(conversationId, 'Plan ready for review', 'The AI needs your approval');
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
        recentlyExitedPlanMode.delete(conversationId);
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

      case 'auth_error': {
        // Handle auth error with a clear, actionable message
        const authMessage = event?.message || 'Authentication failed. Check your API key in Settings > Claude Code.';
        console.error('Auth error:', authMessage);
        store.setStreamingError(conversationId, authMessage);
        store.updateConversation(conversationId, { status: 'idle' });
        notifyDesktop(conversationId, 'Authentication error', (authMessage as string).slice(0, 100));
        break;
      }

      case 'error': {
        // Handle error - capture the error message and stop streaming
        const errorMessage = event?.message || 'An unknown error occurred';
        console.error('Conversation error:', errorMessage);

        // Don't overwrite an auth error with a generic crash error
        const currentError = useAppStore.getState().streamingState[conversationId]?.error;
        if (currentError && isAuthErrorMessage(currentError)) {
          break;
        }

        // Commit any queued message so it appears in history
        store.commitQueuedMessage(conversationId);
        store.setStreamingError(conversationId, errorMessage);
        // Update conversation status to idle
        store.updateConversation(conversationId, { status: 'idle' });
        // Desktop notification for error
        notifyDesktop(conversationId, 'Task error', (errorMessage || 'Unknown error').slice(0, 100));
        break;
      }

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
        // Notify user that context was compacted
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
        break;

      case 'pre_compact':
        // Hook fires BEFORE context compaction occurs — no UI action needed
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
            isResult: event.isResult as boolean | undefined,
            conversationId,
          });
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
        // Commit any queued message so it appears in history
        store.commitQueuedMessage(conversationId);
        store.clearStreamingText(conversationId);
        store.setStreaming(conversationId, false);
        store.clearActiveTools(conversationId);
        store.clearThinking(conversationId);
        store.clearSubAgents(conversationId);
        store.clearPendingUserQuestion(conversationId);
        store.updateConversation(conversationId, { status: 'idle' });
        break;

      case 'user_question_timeout':
      case 'user_question_cancelled':
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
        // Informational only — do NOT clear streaming state here.
        // The SDK's stopHook fires BEFORE the result message, so clearing
        // here would destroy accumulated content. Cleanup is handled by
        // result (finalizeStreamingMessage) → complete (final cleanup).
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

      case 'session_recovering':
        // CLI process crashed — agent-runner is auto-recovering.
        // No UI change needed: streaming indicator keeps spinning.
        // The 'init' event from the recovered session clears stale state.
        // If all retries fail, the 'error' event handles it normally.
        console.warn(`Session recovering for ${conversationId} (attempt ${event.attempt}/${event.maxAttempts})`);
        break;

      case 'warning':
        // Surface agent warnings (e.g., API overloaded errors) as toast notifications
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
        if (event?.servers && isMcpServerStatusArray(event.servers)) {
          store.setMcpServers(event.servers);
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
          store.commitQueuedMessage(convId);
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

  // After the first WebSocket connection, discover conversations that are actively
  // streaming on the backend. Unlike reconnection reconciliation (which starts from
  // locally-known streaming state), this queries the backend for the source of truth
  // since the frontend resets all conversation statuses to 'idle' on a fresh load.
  const reconcileInitialStreamingState = useCallback(async () => {
    const store = getStore();

    try {
      const { conversationIds: serverActive } = await getActiveStreamingConversations();
      if (serverActive.length === 0) return;

      for (const convId of serverActive) {
        // Skip if conversation isn't loaded yet (dashboard data may still be loading)
        const conv = store.conversations.find(c => c.id === convId);
        if (!conv) continue;

        // Restore conversation status (was reset to 'idle' during load)
        store.updateConversation(convId, { status: 'active' });

        // Try to restore streaming content from snapshot
        try {
          const snapshot = await getStreamingSnapshot(convId);
          if (snapshot && snapshot.text) {
            store.restoreStreamingFromSnapshot(convId, snapshot);
          } else {
            // No snapshot yet — just mark streaming so the spinner shows
            store.setStreaming(convId, true);
          }
        } catch (err) {
          console.warn(`Failed to fetch initial streaming snapshot for ${convId}:`, err);
          store.setStreaming(convId, true);
        }
      }
    } catch (err) {
      console.warn('Failed to reconcile initial streaming state:', err);
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
      } else {
        // First connection: discover any agents already running on the backend.
        // Intentionally not awaited — same reasoning as reconnect reconciliation.
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

        // Handle init event for MCP server status
        if (data.type === 'init') {
          const payload = data.payload as Record<string, unknown> | undefined;
          if (payload?.mcpServers && Array.isArray(payload.mcpServers)) {
            getStore().setMcpServers(payload.mcpServers);
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

        // Handle session task status auto-update (backlog→in_progress, in_review, done)
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
          if (data.type === 'branch_dashboard_update') {
            useBranchCacheStore.getState().invalidateAll();
          }
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
            // Map checkStatus to hasCheckFailures AND preserve full checkStatus
            if (typeof payload.checkStatus === 'string') {
              updates.hasCheckFailures = payload.checkStatus === 'failure';
              updates.checkStatus = payload.checkStatus as 'none' | 'pending' | 'success' | 'failure';
            }
            // Map mergeable to hasMergeConflict
            if (typeof payload.mergeable === 'boolean') {
              updates.hasMergeConflict = !payload.mergeable;
            }
            // Pass through taskStatus if backend auto-updated it
            if (typeof payload.taskStatus === 'string') {
              updates.taskStatus = payload.taskStatus as import('@/lib/types').SessionTaskStatus;
            }

            getStore().updateSession(data.sessionId, updates);

            // Clear stale input suggestions for conversations in this session
            // so they regenerate with fresh PR context
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
                    if (result === null) {
                      // Blank session was deleted by backend
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
