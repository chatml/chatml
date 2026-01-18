'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, AgentEvent } from '@/lib/types';

const WS_URL = 'ws://localhost:9876/ws';

export function useWebSocket(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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

    const event = data.payload as AgentEvent;

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
          completeActiveTool(
            conversationId,
            event.id,
            event.success as boolean | undefined,
            event.summary as string | undefined
          );
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

      case 'conversation_status':
        // Update conversation status
        const statusPayload = data.payload as string;
        if (statusPayload) {
          updateConversation(conversationId, {
            status: statusPayload as 'active' | 'idle' | 'completed',
          });
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
  ]);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data: WSEvent = JSON.parse(event.data);

        // Handle conversation events
        if (data.conversationId) {
          handleConversationEvent(data);
          return;
        }

        // Legacy agent events
        if (data.type === 'output' && data.agentId) {
          appendOutput(data.agentId, data.payload as string);
        } else if (data.type === 'status' && data.agentId) {
          updateSession(data.agentId, {
            status: mapStatus(data.payload as string),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected, reconnecting...');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Only reconnect if still enabled
      if (enabledRef.current) {
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [appendOutput, updateSession, handleConversationEvent]);

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

  return wsRef.current;
}
