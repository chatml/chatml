'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getPRStatus, refreshPRStatus, ApiError, type PRDetails } from '@/lib/api';
import { getChecksData, setChecksData } from '@/lib/checksDataCache';
import { useAppStore } from '@/stores/appStore';

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
        setChecksData(workspaceId, sessionId, { prDetails: data });
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

  // Fire POST force-check alongside GET; without it, the backend serves cached/eventual
  // data and the refresh button appears to do nothing. Mirrors the session-change effect.
  const refetch = useCallback(async () => {
    setLoading(true);
    if (workspaceId && sessionId) {
      refreshPRStatus(workspaceId, sessionId).catch(() => {});
    }
    await fetchStatus();
  }, [fetchStatus, workspaceId, sessionId]);

  // Stale-while-revalidate on session change: restore cached details for the
  // new session immediately so downstream consumers (e.g. PrimaryActionButton)
  // never see another session's stale data, and the panel doesn't blank-flicker.
  // Also decides whether to flip loading=true (cold start) or revalidate silently.
  // Apply synchronously — cache restore is itself the urgent update.
  useEffect(() => {
    if (!workspaceId || !sessionId) {
      setPRDetails(null);
      setLoading(false);
      setError(null);
      return;
    }
    const cached = getChecksData(workspaceId, sessionId);
    if (cached?.prDetails !== undefined) {
      setPRDetails(cached.prDetails ?? null);
      setLoading(false);
      setError(null);
    } else {
      setPRDetails(null);
      setLoading(prStatus !== undefined && prStatus !== 'none');
      setError(null);
    }
  }, [workspaceId, sessionId, prStatus]);

  // Initial fetch and fetch on session change.
  // Deferred: skip fetch until the caller has been active at least once.
  useEffect(() => {
    isMountedRef.current = true;

    if (!hasBeenActiveRef.current) {
      return () => { isMountedRef.current = false; };
    }

    if (prStatus && prStatus !== 'none') {
      fetchStatus();
      // No POST force-check here. The backend prWatcher already pushes
      // updates over WebSocket (see useWebSocket setLastPRRefresh), and the
      // manual refetch path explicitly POSTs. Firing it on every session
      // switch would burn ~5 GitHub calls per click for stale-by-seconds data.
    } else {
      setPRDetails(null);
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchStatus, prStatus, workspaceId, sessionId, active]);

  // Slow fallback poll when PR is open (WebSocket is the primary update mechanism).
  // Skips when the document is hidden so backgrounded windows don't keep hitting GitHub.
  useEffect(() => {
    if (!active || !workspaceId || !sessionId || prStatus !== 'open') return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchStatus();
    }, PR_STATUS_FALLBACK_POLL_MS);

    return () => clearInterval(interval);
  }, [active, workspaceId, sessionId, prStatus, fetchStatus]);

  // Refetch immediately when the document becomes visible (covers long sleep / tab return)
  useEffect(() => {
    if (!active || !workspaceId || !sessionId || prStatus !== 'open') return;
    const onVisible = () => {
      if (!document.hidden) fetchStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active, workspaceId, sessionId, prStatus, fetchStatus]);

  // Refetch when the backend prWatcher signals a PR change for this session.
  // Eliminates the 30–90s gap between a check transition and the panel reflecting it.
  // Debounced so a burst of WS messages collapses into one fetch.
  const lastPRRefresh = useAppStore((s) => s.lastPRRefresh);
  useEffect(() => {
    if (!active || !workspaceId || !sessionId) return;
    if (!lastPRRefresh || lastPRRefresh.sessionId !== sessionId) return;
    const timer = setTimeout(() => fetchStatus(), 400);
    return () => clearTimeout(timer);
  }, [active, workspaceId, sessionId, lastPRRefresh, fetchStatus]);

  return { prDetails, loading, error, refetch };
}
