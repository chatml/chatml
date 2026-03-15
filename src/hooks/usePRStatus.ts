'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPRStatus, refreshPRStatus, ApiError, type PRDetails } from '@/lib/api';

const PR_STATUS_FALLBACK_POLL_MS = 90_000; // 90 seconds (fallback, WebSocket is primary)

interface UsePRStatusResult {
  prDetails: PRDetails | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and maintain PR status for a session.
 *
 * Features:
 * - Fetches status on mount and session change
 * - Polls every 60 seconds when prStatus is 'open'
 * - Returns null if no PR exists
 */
export function usePRStatus(
  workspaceId: string | null,
  sessionId: string | null,
  prStatus: string | undefined,
  active: boolean = true
): UsePRStatusResult {
  const [prDetails, setPRDetails] = useState<PRDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(false);

  // Track whether the hook's consumer has ever been active (for deferred loading).
  // Skip initial fetch until the caller signals active at least once.
  const hasBeenActiveRef = useRef(active);
  useEffect(() => {
    if (active) hasBeenActiveRef.current = true;
  }, [active]);

  // Fetch PR status
  const fetchStatus = useCallback(async () => {
    // Only fetch if we have a session with a PR
    if (!workspaceId || !sessionId || !prStatus || prStatus === 'none') {
      setPRDetails(null);
      setLoading(false);
      return;
    }

    try {
      const data = await getPRStatus(workspaceId, sessionId);
      if (isMountedRef.current) {
        setPRDetails(data);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        // Silently handle expected non-error cases
        const isTransientNetwork = err instanceof ApiError && err.status === 0;
        const isAuthMissing = err instanceof ApiError && err.status === 401;
        if (!isTransientNetwork && !isAuthMissing) {
          console.error('Failed to fetch PR status:', err);
        }
        // Treat auth errors as "no data" — PR details require GitHub auth
        if (isAuthMissing) {
          setPRDetails(null);
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to fetch PR status');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, sessionId, prStatus]);

  // Exposed refetch function
  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchStatus();
  }, [fetchStatus]);

  // Clear stale data immediately when session identity changes.
  // Without this, the previous session's PR details linger in state
  // while the new fetch is in-flight, causing downstream consumers
  // (e.g. PrimaryActionButton) to briefly render stale actions.
  // Uses setTimeout to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    const id = setTimeout(() => {
      setPRDetails(null);
      setLoading(true);
      setError(null);
    }, 0);
    return () => clearTimeout(id);
  }, [workspaceId, sessionId]);

  // Initial fetch and fetch on session change.
  // Deferred: skip fetch until the caller has been active at least once.
  useEffect(() => {
    isMountedRef.current = true;

    if (!hasBeenActiveRef.current) {
      return () => { isMountedRef.current = false; };
    }

    if (prStatus && prStatus !== 'none') {
      setLoading(true);
      fetchStatus();

      // Trigger a backend force-check so we get fresh data from GitHub
      if (workspaceId && sessionId) {
        refreshPRStatus(workspaceId, sessionId).catch(() => {
          // Silently ignore — the force-check is best-effort;
          // the GET above already returns cached data for immediate display
        });
      }
    } else {
      setPRDetails(null);
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchStatus, prStatus, workspaceId, sessionId, active]);

  // Slow fallback poll when PR is open (WebSocket is the primary update mechanism)
  useEffect(() => {
    if (!active || !workspaceId || !sessionId || prStatus !== 'open') return;

    const interval = setInterval(() => {
      fetchStatus();
    }, PR_STATUS_FALLBACK_POLL_MS);

    return () => clearInterval(interval);
  }, [active, workspaceId, sessionId, prStatus, fetchStatus]);

  return { prDetails, loading, error, refetch };
}
