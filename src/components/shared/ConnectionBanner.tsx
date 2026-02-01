'use client';

import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConnectionStore } from '@/stores/connectionStore';
import { WEBSOCKET_DISCONNECT_GRACE_MS } from '@/lib/constants';

interface ConnectionBannerProps {
  onReconnect: () => void;
}

export function ConnectionBanner({ onReconnect }: ConnectionBannerProps) {
  const status = useConnectionStore((s) => s.status);
  const attempt = useConnectionStore((s) => s.reconnectAttempt);
  const lastDisconnectedAt = useConnectionStore((s) => s.lastDisconnectedAt);
  const [gracePeriodElapsed, setGracePeriodElapsed] = useState(false);

  useEffect(() => {
    // Reset when connection restores or no disconnect timestamp
    if (status === 'connected' || !lastDisconnectedAt) {
      // Only reset via timer callback to satisfy react-hooks/set-state-in-effect
      if (gracePeriodElapsed) {
        const id = setTimeout(() => setGracePeriodElapsed(false), 0);
        return () => clearTimeout(id);
      }
      return;
    }

    // Already elapsed from a previous render
    if (gracePeriodElapsed) return;

    const elapsed = Date.now() - lastDisconnectedAt;
    if (elapsed >= WEBSOCKET_DISCONNECT_GRACE_MS) {
      // Past grace period — fire immediately via microtask
      const id = setTimeout(() => {
        if (useConnectionStore.getState().status !== 'connected') {
          setGracePeriodElapsed(true);
        }
      }, 0);
      return () => clearTimeout(id);
    }

    const timer = setTimeout(() => {
      if (useConnectionStore.getState().status !== 'connected') {
        setGracePeriodElapsed(true);
      }
    }, WEBSOCKET_DISCONNECT_GRACE_MS - elapsed);

    return () => clearTimeout(timer);
  }, [status, lastDisconnectedAt, gracePeriodElapsed]);

  const isDisconnected = status !== 'connected';
  const visible = isDisconnected && gracePeriodElapsed;

  if (!visible) return null;

  const isReconnecting = status === 'connecting';

  return (
    <div className="bg-destructive/10 border-b border-destructive/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 text-destructive shrink-0" />
        <span className="text-sm">
          Connection lost. Real-time updates are paused.
          {isReconnecting && attempt > 0 && (
            <span className="text-muted-foreground ml-1">
              Reconnecting (attempt {attempt})...
            </span>
          )}
        </span>
        <div className="flex-1" />
        <Button
          variant="destructive"
          size="sm"
          className="h-6 text-xs gap-1.5 px-2"
          onClick={onReconnect}
          disabled={isReconnecting}
        >
          {isReconnecting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Reconnect
        </Button>
      </div>
    </div>
  );
}
