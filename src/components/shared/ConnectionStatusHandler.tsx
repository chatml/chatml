'use client';

import { useEffect, useRef } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useToast } from '@/components/ui/toast';
import { WEBSOCKET_DISCONNECT_GRACE_MS } from '@/lib/constants';

export function ConnectionStatusHandler() {
  const status = useConnectionStore((s) => s.status);
  const { warning, success } = useToast();
  const graceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wasDisconnectedRef = useRef(false);
  const hasShownDisconnectToastRef = useRef(false);

  useEffect(() => {
    if (status === 'disconnected' || status === 'connecting') {
      // Start grace period timer if not already started
      if (!graceTimerRef.current && !hasShownDisconnectToastRef.current) {
        graceTimerRef.current = setTimeout(() => {
          graceTimerRef.current = null;
          const currentStatus = useConnectionStore.getState().status;
          if (currentStatus !== 'connected') {
            warning(
              'Real-time updates paused. Attempting to reconnect...',
              'Connection Lost',
            );
            hasShownDisconnectToastRef.current = true;
            wasDisconnectedRef.current = true;
          }
        }, WEBSOCKET_DISCONNECT_GRACE_MS);
      }
    } else if (status === 'connected') {
      // Clear grace timer
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      // Show reconnected toast only if user saw the disconnect
      if (wasDisconnectedRef.current) {
        success('Real-time updates resumed.', 'Reconnected');
        wasDisconnectedRef.current = false;
        hasShownDisconnectToastRef.current = false;
      }
    }
  }, [status, warning, success]);

  useEffect(() => {
    return () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
      }
    };
  }, []);

  return null;
}
