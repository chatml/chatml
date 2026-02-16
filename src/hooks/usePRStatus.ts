'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPRStatus, refreshPRStatus, type PRDetails } from '@/lib/api';

const PR_STATUS_FALLBACK_POLL_MS = 300000; // 5 minutes (fallback, WebSocket is primary)

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
  prStatus: string | undefined
): UsePRStatusResult {
  const [prDetails, setPRDetails] = useState<PRDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(false);

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
        console.error('Failed to fetch PR status:', err);
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

  // Initial fetch and fetch on session change
  useEffect(() => {
    isMountedRef.current = true;

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
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchStatus, prStatus, workspaceId, sessionId]);

  // Slow fallback poll when PR is open (WebSocket is the primary update mechanism)
  useEffect(() => {
    if (!workspaceId || !sessionId || prStatus !== 'open') return;

    const interval = setInterval(() => {
      fetchStatus();
    }, PR_STATUS_FALLBACK_POLL_MS);

    return () => clearInterval(interval);
  }, [workspaceId, sessionId, prStatus, fetchStatus]);

  return { prDetails, loading, error, refetch };
}
