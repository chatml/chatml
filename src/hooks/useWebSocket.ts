'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent } from '@/lib/types';

const WS_URL = 'ws://localhost:9876/ws';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    appendOutput,
    updateSession,
    addMessage,
    selectedConversationId,
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

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data: WSEvent = JSON.parse(event.data);

        if (data.type === 'output' && data.agentId) {
          // Append to session output buffer
          appendOutput(data.agentId, data.payload);

          // Also add as a message to the current conversation if it matches
          const state = useAppStore.getState();
          const session = state.sessions.find(s => s.id === data.agentId);
          if (session) {
            const conv = state.conversations.find(c => c.sessionId === session.id);
            if (conv && conv.id === state.selectedConversationId) {
              // Update or append to the assistant message
              const existingMsg = state.messages.find(
                m => m.conversationId === conv.id && m.role === 'assistant' && !m.durationMs
              );
              if (existingMsg) {
                // Append to existing streaming message
                state.updateMessage(existingMsg.id, {
                  content: existingMsg.content + '\n' + data.payload,
                });
              } else {
                // Create new assistant message
                addMessage({
                  id: `msg-${Date.now()}`,
                  conversationId: conv.id,
                  role: 'assistant',
                  content: data.payload,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          }
        } else if (data.type === 'status' && data.agentId) {
          // Update session status
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
      console.log('WebSocket disconnected, reconnecting...');
      // Clear any existing reconnect timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      // Reconnect after delay
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [appendOutput, updateSession, addMessage, selectedConversationId]);

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
