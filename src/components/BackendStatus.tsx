'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, RefreshCw, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkHealthWithRetry } from '@/lib/api';
import { isTauri, safeListen, markAppReady, restartSidecar } from '@/lib/tauri';

interface BackendStatusProps {
  onConnected: () => void;
  maxRetries?: number;
  initialDelay?: number;
}

type ConnectionState = 'connecting' | 'connected' | 'error' | 'sidecar-error';

export function BackendStatus({
  onConnected,
  maxRetries = 15,
  initialDelay = 500
}: BackendStatusProps) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sidecarLogs, setSidecarLogs] = useState<string[]>([]);
  const [isRestarting, setIsRestarting] = useState(false);

  const connect = useCallback(async () => {
    setState('connecting');
    setAttempt(0);
    setError(null);

    const result = await checkHealthWithRetry(maxRetries, initialDelay, (attemptNum) => {
      setAttempt(attemptNum);
    });

    if (result.success) {
      setState('connected');
      // Mark app as ready so close confirmation can work
      await markAppReady();
      onConnected();
    } else {
      setState('error');
      setError(result.error || 'Could not connect to backend');
    }
  }, [maxRetries, initialDelay, onConnected]);

  // Listen for sidecar events
  useEffect(() => {
    if (!isTauri()) return;

    const cleanups: (() => void)[] = [];

    // Listen for sidecar stderr (useful for debugging)
    safeListen<string>('sidecar-stderr', (message) => {
      console.warn('[sidecar]', message);
      setSidecarLogs((prev) => [...prev.slice(-20), `[stderr] ${message}`]);
    }).then((cleanup) => cleanups.push(cleanup));

    // Listen for sidecar errors
    safeListen<string>('sidecar-error', (error) => {
      console.error('[sidecar error]', error);
      setState('sidecar-error');
      setError(error);
      setSidecarLogs((prev) => [...prev.slice(-20), `[error] ${error}`]);
    }).then((cleanup) => cleanups.push(cleanup));

    // Listen for sidecar termination
    safeListen<number | null>('sidecar-terminated', (code) => {
      console.error('[sidecar terminated] exit code:', code);
      setState('sidecar-error');
      setError(`Backend process terminated unexpectedly (code: ${code ?? 'unknown'})`);
      setSidecarLogs((prev) => [...prev.slice(-20), `[terminated] exit code: ${code}`]);
    }).then((cleanup) => cleanups.push(cleanup));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  // Start connection on mount
  useEffect(() => {
    // Use queueMicrotask to avoid synchronous setState warning
    queueMicrotask(() => {
      connect();
    });
  }, [connect]);

  const handleRestart = async () => {
    setIsRestarting(true);
    setSidecarLogs([]);
    setError(null);

    const success = await restartSidecar();
    if (success) {
      // Wait a bit for sidecar to start, then try connecting
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await connect();
    } else {
      setError('Failed to restart backend. Try restarting the application.');
    }

    setIsRestarting(false);
  };

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

        {(state === 'error' || state === 'sidecar-error') && (
          <>
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">
              {state === 'sidecar-error' ? 'Backend Error' : 'Connection Failed'}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {error}
            </p>

            {/* Show recent sidecar logs if available */}
            {sidecarLogs.length > 0 && (
              <div className="mb-4 text-left">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                  <Terminal className="w-3 h-3" />
                  <span>Backend logs:</span>
                </div>
                <div className="bg-muted/50 rounded-md p-2 max-h-32 overflow-y-auto">
                  {sidecarLogs.map((log, i) => (
                    <div key={i} className="text-[10px] font-mono text-muted-foreground">
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {isTauri() && (
                <Button
                  onClick={handleRestart}
                  disabled={isRestarting}
                  className="gap-2"
                >
                  {isRestarting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {isRestarting ? 'Restarting...' : 'Restart Backend'}
                </Button>
              )}
              <Button onClick={connect} variant="outline" className="gap-2 ml-2">
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
