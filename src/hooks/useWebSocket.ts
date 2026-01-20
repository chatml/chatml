'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, AgentEvent, AgentTodoItem } from '@/lib/types';
import { WEBSOCKET_RECONNECT_DELAY_MS } from '@/lib/constants';

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

// WebSocket URL - configurable via environment variable for non-Tauri builds
const WS_URL = typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__
  ? 'ws://localhost:9876/ws'  // Tauri always uses localhost sidecar
  : (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:9876/ws');

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
    addActiveTool,
    completeActiveTool,
    clearActiveTools,
    addMessage,
    setAgentTodos,
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
        }
        break;

      case 'tool_end':
        // Complete active tool with success/summary info
        if (event?.id) {
          completeActiveTool(conversationId, event.id, event.success, event.summary);
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
        // Result event signals the end of a turn - finalize streaming
        const state = useAppStore.getState();
        const streamingText = state.streamingState[conversationId]?.text;
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
        }));

        if (streamingText) {
          addMessage({
            id: `msg-${Date.now()}`,
            conversationId,
            role: 'assistant',
            content: streamingText,
            timestamp: new Date().toISOString(),
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
        }
        clearStreamingText(conversationId);
        setStreaming(conversationId, false);
        clearThinking(conversationId);
        clearActiveTools(conversationId);
        break;

      case 'complete':
        // Complete event signals the entire conversation ended (stdin closed)
        // Clear any remaining state
        clearStreamingText(conversationId);
        setStreaming(conversationId, false);
        clearThinking(conversationId);
        clearActiveTools(conversationId);
        break;

      case 'error':
        // Handle error - capture the error message and stop streaming
        const errorMessage = event?.message || 'An unknown error occurred';
        console.error('Conversation error:', errorMessage);
        setStreamingError(conversationId, errorMessage);
        // Update conversation status to idle
        updateConversation(conversationId, { status: 'idle' });
        break;
    }
  }, [
    appendStreamingText,
    addActiveTool,
    completeActiveTool,
    updateConversation,
    addMessage,
    clearStreamingText,
    setStreaming,
    setStreamingError,
    appendThinkingText,
    setThinking,
    clearThinking,
    clearActiveTools,
    setAgentTodos,
  ]);

  const connect = useCallback(() => {
    // Cancel any pending reconnect to prevent race condition
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (!enabledRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

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
