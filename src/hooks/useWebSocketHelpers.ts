import type { AgentEvent, AgentTodoItem, UserQuestion, TokenUsage, ModelUsageInfo, McpServerStatus } from '@/lib/types';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getBackendPortSync } from '@/lib/backend-port';
import { playSound } from '@/lib/sounds';

// Safely coerce an unknown value to a number, returning undefined for non-numeric values.
export const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

// Normalize SDK usage object (snake_case) to our TokenUsage type (camelCase)
export function normalizeUsage(raw: Record<string, unknown> | undefined): TokenUsage | undefined {
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
export const DROP_STATS_DEBOUNCE_MS = 3000;
let _lastDropStatsFetchTime = 0;
export function getLastDropStatsFetchTime() { return _lastDropStatsFetchTime; }
export function updateLastDropStatsFetchTime(time: number) {
  _lastDropStatsFetchTime = time;
}

// Check if an error message is auth-related (used for deduplication)
export function isAuthErrorMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('authentication') || lower.includes('api key') || lower.includes('oauth') || lower.includes('aws credentials');
}

// Type guards for WebSocket payload validation
export function isAgentEvent(payload: unknown): payload is AgentEvent {
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

export function isAgentTodoItem(item: unknown): item is AgentTodoItem {
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

export function isAgentTodoItemArray(payload: unknown): payload is AgentTodoItem[] {
  return Array.isArray(payload) && payload.every(isAgentTodoItem);
}

const VALID_CONVERSATION_STATUSES = ['active', 'idle', 'completed'] as const;
type ConversationStatus = typeof VALID_CONVERSATION_STATUSES[number];

export function isValidConversationStatus(value: unknown): value is ConversationStatus {
  return typeof value === 'string' && VALID_CONVERSATION_STATUSES.includes(value as ConversationStatus);
}

export function isModelUsageRecord(value: unknown): value is Record<string, ModelUsageInfo> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(v => {
    if (typeof v !== 'object' || v === null) return false;
    const entry = v as Record<string, unknown>;
    return typeof entry.inputTokens === 'number' && typeof entry.outputTokens === 'number';
  });
}

export function isUserQuestionArray(value: unknown): value is UserQuestion[] {
  if (!Array.isArray(value)) return false;
  return value.every(q => {
    if (typeof q !== 'object' || q === null) return false;
    const obj = q as Record<string, unknown>;
    return typeof obj.question === 'string' && typeof obj.header === 'string' && Array.isArray(obj.options);
  });
}

export function isMcpServerStatusArray(value: unknown): value is McpServerStatus[] {
  if (!Array.isArray(value)) return false;
  return value.every(s => {
    if (typeof s !== 'object' || s === null) return false;
    const obj = s as Record<string, unknown>;
    return typeof obj.name === 'string' && typeof obj.status === 'string';
  });
}

// Get WebSocket URL dynamically based on the backend port
export function getWsUrl(): string {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const port = getBackendPortSync();
    return `ws://localhost:${port}/ws`;
  }
  return process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:9876/ws';
}

// Events that are buffered by the streaming batcher and should NOT trigger a force-flush.
// All other conversation events force-flush pending text/thinking before processing.
export const BATCHABLE_EVENTS = new Set([
  'assistant_text', 'thinking_delta', 'thinking_start', 'thinking',
  // Low-frequency informational events that don't depend on streaming text state
  'name_suggestion', 'input_suggestion', 'context_usage', 'context_window_size',
  'todo_update', 'tool_progress', 'agent_notification', 'warning',
  'hook_pre_tool', 'hook_post_tool', 'hook_response', 'hook_tool_failure',
  'session_started', 'session_ended', 'session_id_update',
  'auth_status', 'status_update', 'agent_stderr', 'json_parse_error',
  'agent_stop', 'pre_compact', 'post_compact', 'model_changed', 'supported_models',
  'supported_commands', 'mcp_status', 'account_info',
  'subagent_started', 'subagent_stopped', 'subagent_output', 'subagent_usage',
  'user_question_request', 'user_question_timeout', 'user_question_cancelled',
  'permission_mode_changed', 'plan_approval_request', 'plan_mode_auto_exited',
  'streaming_warning', 'summary_updated', 'checkpoint_created', 'files_rewound',
  'ghost_text',
  // SDK 0.2.72+ informational events
  'prompt_suggestion', 'tool_use_summary', 'rate_limit',
  'elicitation_request', 'elicitation_result', 'elicitation_complete',
  'hook_started', 'hook_progress', 'worktree_created', 'worktree_removed',
  'instructions_loaded', 'supported_agents', 'mcp_servers_updated',
  'initialization_result', 'session_forked', 'message_cancelled',
  // SDK 0.2.84+ events
  'api_retry', 'session_state_changed', 'stop_failure',
  'cwd_changed', 'file_changed', 'task_created',
]);

// Content event types that should be suppressed during reconciliation.
// Lifecycle events (result, turn_complete, complete, conversation_status) are NOT suppressed.
export const RECONCILIATION_SUPPRESSED_EVENTS = new Set([
  'assistant_text', 'tool_start', 'tool_end', 'thinking_start', 'thinking_delta',
  'thinking', 'subagent_started', 'subagent_stopped', 'subagent_output',
  'ghost_text', 'todo_update', 'tool_progress',
]);

// Map backend status to frontend session status
export const mapStatus = (status: string): 'active' | 'idle' | 'done' | 'error' => {
  switch (status) {
    case 'running': return 'active';
    case 'pending': return 'idle';
    case 'done': return 'done';
    case 'error': return 'error';
    default: return 'idle';
  }
};

/**
 * Mark a session as unread and play an in-app sound when a background session
 * has a notable event (turn complete, question, plan approval).
 * Only fires if the conversation belongs to a session that is NOT currently selected.
 * Sound plays even when the app is focused (notifyDesktop only plays when unfocused).
 */
export function notifyBackgroundSession(conversationId: string): void {
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
