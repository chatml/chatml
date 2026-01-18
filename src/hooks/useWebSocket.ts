'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, AgentEvent } from '@/lib/types';

const WS_URL = 'ws://localhost:9876/ws';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    appendOutput,
    updateSession,
    updateConversation,
    appendStreamingText,
    setStreaming,
    setStreamingError,
    clearStreamingText,
    addActiveTool,
    completeActiveTool,
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
        // Append streaming text
        if (event?.content) {
          appendStreamingText(conversationId, event.content);
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
        // Complete active tool
        if (event?.id) {
          completeActiveTool(conversationId, event.id);
        }
        break;

      case 'name_suggestion':
        // Update conversation name
        if (event?.name) {
          updateConversation(conversationId, { name: event.name });
        }
        break;

      case 'result':
        // Result event contains metadata (cost, turns) but we wait for 'complete' to add message
        // This prevents duplicate messages since both events are sent
        break;

      case 'complete':
        // Finalize streaming - add message and clear streaming state
        // Only handle on 'complete' to avoid duplicates (both 'result' and 'complete' are sent)
        const state = useAppStore.getState();
        const streamingText = state.streamingState[conversationId]?.text;
        if (streamingText) {
          addMessage({
            id: `msg-${Date.now()}`,
            conversationId,
            role: 'assistant',
            content: streamingText,
            timestamp: new Date().toISOString(),
          });
        }
        clearStreamingText(conversationId);
        setStreaming(conversationId, false);
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
  ]);

  const connect = useCallback(() => {
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
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [appendOutput, updateSession, handleConversationEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef.current;
}
