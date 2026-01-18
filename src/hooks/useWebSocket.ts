'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WSEvent, Agent } from '@/lib/types';

const WS_URL = 'ws://localhost:9876/ws';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { appendOutput, updateAgentStatus } = useAppStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      // Connected successfully
    };

    ws.onmessage = (event) => {
      try {
        const data: WSEvent = JSON.parse(event.data);

        if (data.type === 'output') {
          appendOutput(data.agentId, data.payload);
        } else if (data.type === 'status') {
          updateAgentStatus(data.agentId, data.payload as Agent['status']);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      // Reconnect after delay
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // Silently handle - will reconnect via onclose
      ws.close();
    };

    wsRef.current = ws;
  }, [appendOutput, updateAgentStatus]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef.current;
}
