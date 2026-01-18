'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkHealthWithRetry } from '@/lib/api';

interface BackendStatusProps {
  onConnected: () => void;
  maxRetries?: number;
  initialDelay?: number;
}

type ConnectionState = 'connecting' | 'connected' | 'error';

export function BackendStatus({
  onConnected,
  maxRetries = 10,
  initialDelay = 500
}: BackendStatusProps) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setState('connecting');
    setAttempt(0);
    setError(null);

    const result = await checkHealthWithRetry(maxRetries, initialDelay, (attemptNum) => {
      setAttempt(attemptNum);
    });

    if (result.success) {
      setState('connected');
      onConnected();
    } else {
      setState('error');
      setError(result.error || 'Could not connect to backend');
    }
  }, [maxRetries, initialDelay, onConnected]);

  useEffect(() => {
    connect();
  }, [connect]);

  if (state === 'connected') {
    return null;
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        {state === 'connecting' && (
          <>
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Starting ChatML</h2>
            <p className="text-sm text-muted-foreground mb-2">
              Connecting to backend service...
            </p>
            {attempt > 0 && (
              <p className="text-xs text-muted-foreground">
                Attempt {attempt} of {maxRetries}
              </p>
            )}
          </>
        )}

        {state === 'error' && (
          <>
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Connection Failed</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {error}
            </p>
            <div className="space-y-2">
              <Button onClick={connect} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                Retry Connection
              </Button>
              <p className="text-xs text-muted-foreground mt-4">
                If this persists, try restarting the application.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
