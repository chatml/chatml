'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, AgentEvent, AgentTodoItem, CheckpointInfo, BudgetStatus } from '@/lib/types';
import { WEBSOCKET_RECONNECT_DELAY_MS } from '@/lib/constants';
import { getAuthToken } from '@/lib/auth-token';
import { getBackendPort, getBackendPortSync } from '@/lib/backend-port';

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

  // Update enabledRef in effect to satisfy linter
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const {
    appendOutput,
    updateSession,
    updateConversation,
    appendStreamingText,
    setStreaming,
    setStreamingError,
    clearStreamingText,
    appendThinkingText,
    setThinking,
    clearThinking,
    setPlanModeActive,
    setAwaitingPlanApproval,
    addActiveTool,
    completeActiveTool,
    clearActiveTools,
    setAgentTodos,
    finalizeStreamingMessage,
  } = useAppStore();

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

    // Handle conversation_status separately - it uses a string payload
    if (data.type === 'conversation_status') {
      if (typeof data.payload === 'string' && isValidConversationStatus(data.payload)) {
        updateConversation(conversationId, { status: data.payload });
      } else {
        console.warn('Invalid conversation status payload:', data.payload);
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
        // Capture budget configuration from init event
        if (event?.budgetConfig) {
          const config = event.budgetConfig as { maxBudgetUsd?: number; maxTurns?: number; maxThinkingTokens?: number };
          // Initialize budget status with max values from config
          const existingStatus = useAppStore.getState().budgetStatus;
          useAppStore.getState().setBudgetStatus({
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
          clearThinking(conversationId);
          appendStreamingText(conversationId, event.content);
        }
        break;

      case 'thinking_start':
        // Start a new thinking block
        setThinking(conversationId, true);
        break;

      case 'thinking_delta':
        // Append thinking text
        if (event?.content) {
          appendThinkingText(conversationId, event.content);
        }
        break;

      case 'thinking':
        // Full thinking content (non-streaming)
        if (event?.content) {
          appendThinkingText(conversationId, event.content);
        }
        break;

      case 'tool_start':
        // Add active tool
        if (event?.id && event?.tool) {
          addActiveTool(conversationId, {
            id: event.id,
            tool: event.tool,
            params: event.params,
            startTime: Date.now(),
          });

          // Detect ExitPlanMode tool - this means Claude wants plan approval
          if (event.tool === 'ExitPlanMode') {
            setAwaitingPlanApproval(conversationId, true);
          }
        }
        break;

      case 'tool_end':
        // Complete active tool with success/summary info
        // For Bash tools, also capture stdout/stderr
        if (event?.id) {
          // Check tool name BEFORE completing (to avoid race condition with state update)
          const activeTool = useAppStore.getState().activeTools[conversationId]?.find(t => t.id === event.id);
          const isExitPlanMode = activeTool?.tool === 'ExitPlanMode';

          const stdout = event.stdout as string | undefined;
          const stderr = event.stderr as string | undefined;
          completeActiveTool(conversationId, event.id, event.success, event.summary, stdout, stderr);

          // Clear awaiting plan approval when ExitPlanMode completes
          if (isExitPlanMode) {
            setAwaitingPlanApproval(conversationId, false);
          }
        }
        break;

      case 'todo_update':
        // Update agent todos for real-time tracking
        if (event?.todos && isAgentTodoItemArray(event.todos)) {
          setAgentTodos(conversationId, event.todos);
        }
        break;

      case 'name_suggestion':
        // Update conversation name
        if (event?.name) {
          updateConversation(conversationId, { name: event.name });
        }
        break;

      case 'result':
        // Result event signals the end of a turn - finalize streaming atomically
        // This prevents data loss by creating message and clearing state in one update
        const state = useAppStore.getState();
        const startTime = state.streamingState[conversationId]?.startTime;
        const durationMs = startTime ? Date.now() - startTime : undefined;

        // Capture tool usage before clearing
        const tools = state.activeTools[conversationId] || [];
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
        finalizeStreamingMessage(conversationId, {
          durationMs,
          toolUsage: toolUsage.length > 0 ? toolUsage : undefined,
          runSummary: {
            success: event.success !== false,
            cost: event.cost,
            turns: event.turns,
            durationMs,
            stats: event.stats,
            errors: event.errors,
          },
        });
// Update budget status from result event, preserving max values
        if (event.cost !== undefined) {
          const existingStatus = useAppStore.getState().budgetStatus;
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
          useAppStore.getState().setBudgetStatus(budgetStatus);
        }
        // Update conversation status to completed
        updateConversation(conversationId, { status: 'completed' });
        break;

      case 'complete':
        // Complete event signals the entire conversation ended (stdin closed)
        // Clear any remaining state
        clearStreamingText(conversationId);
        setStreaming(conversationId, false);
        clearThinking(conversationId);
        clearActiveTools(conversationId);
        // Update conversation status to idle (ready for new input)
        updateConversation(conversationId, { status: 'idle' });
        break;

      case 'permission_mode_changed':
        // Handle plan mode changes from the backend
        if (event?.mode) {
          const isPlanMode = event.mode === 'plan';
          setPlanModeActive(conversationId, isPlanMode);
        }
        break;

      case 'error':
        // Handle error - capture the error message and stop streaming
        const errorMessage = event?.message || 'An unknown error occurred';
        console.error('Conversation error:', errorMessage);
        setStreamingError(conversationId, errorMessage);
        // Update conversation status to idle
        updateConversation(conversationId, { status: 'idle' });
        break;

      case 'streaming_warning':
        // Emit custom event for StreamingWarningHandler to display toast
        window.dispatchEvent(new CustomEvent('streaming-warning', {
          detail: {
            source: event?.source,
            reason: event?.reason,
            message: event?.message || 'Some streaming data may have been lost',
          }
        }));
        break;
    }
  }, [
    appendStreamingText,
    addActiveTool,
    completeActiveTool,
    updateConversation,
    clearStreamingText,
    setStreaming,
    setStreamingError,
    appendThinkingText,
    setThinking,
    clearThinking,
    setPlanModeActive,
    setAwaitingPlanApproval,
    clearActiveTools,
    setAgentTodos,
    finalizeStreamingMessage,
  ]);

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
      // Connected successfully
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
            useAppStore.getState().setMcpServers(payload.mcpServers);
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
          useAppStore.getState().addCheckpoint(checkpoint);
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
            updateSession(data.sessionId, updates);
          }
          return;
        }

        // Handle session stats update (real-time stats from file watcher)
        if (data.type === 'session_stats_update' && data.sessionId) {
          const payload = data.payload as Record<string, unknown> | undefined;
          // stats can be null (no changes) or { additions: number, deletions: number }
          const stats = payload?.stats as { additions: number; deletions: number } | null | undefined;
          updateSession(data.sessionId, { stats: stats ?? undefined });
          return;
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

            updateSession(data.sessionId, updates);
          }
          return;
        }

        // Legacy agent events - validate string payloads
        if (data.type === 'output' && data.agentId && typeof data.payload === 'string') {
          appendOutput(data.agentId, data.payload);
        } else if (data.type === 'status' && data.agentId && typeof data.payload === 'string') {
          updateSession(data.agentId, {
            status: mapStatus(data.payload),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Only reconnect if still enabled
      if (enabledRef.current && connectRef.current) {
        reconnectTimeoutRef.current = setTimeout(connectRef.current, WEBSOCKET_RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [appendOutput, updateSession, handleConversationEvent]);

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
}
