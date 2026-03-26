'use client';

import { useState, useEffect, useRef } from 'react';
import { getSessionSnapshot, getPRStatus } from '@/lib/api';
import { getSessionData } from '@/lib/sessionDataCache';
import type { GitStatusDTO, PRDetails } from '@/lib/api';

interface UseHoverActionDataResult {
  gitStatus: GitStatusDTO | null;
  prDetails: PRDetails | null;
  loading: boolean;
}

/**
 * One-shot data fetcher for the session hover card primary action.
 *
 * Fires when `enabled` becomes true (hover card opens). No polling.
 * Uses sessionDataCache for instant stale display while fresh data loads.
 */
export function useHoverActionData(
  workspaceId: string,
  sessionId: string,
  prStatus: string | undefined,
  enabled: boolean,
): UseHoverActionDataResult {
  const [gitStatus, setGitStatus] = useState<GitStatusDTO | null>(null);
  const [prDetails, setPRDetails] = useState<PRDetails | null>(null);
  const [loading, setLoading] = useState(false);

  // Track fetch per session to avoid re-fetching on rapid re-hover
  const fetchedRef = useRef<string | null>(null);

  // Reset when session identity changes
  useEffect(() => {
    const key = `${workspaceId}:${sessionId}`;
    if (fetchedRef.current !== key) {
      fetchedRef.current = null;
      setGitStatus(null);
      setPRDetails(null);
    }
  }, [workspaceId, sessionId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !sessionId) return;

    const key = `${workspaceId}:${sessionId}`;
    // Already fetched for this session — skip
    if (fetchedRef.current === key) return;

    let cancelled = false;

    // Immediately show cached data if available
    const cached = getSessionData(workspaceId, sessionId);
    if (cached?.gitStatus) {
      setGitStatus(cached.gitStatus);
    }

    setLoading(true);

    // Fetch fresh data in parallel
    const snapshotPromise = getSessionSnapshot(workspaceId, sessionId)
      .then((snapshot) => {
        if (!cancelled) {
          setGitStatus(snapshot.gitStatus);
        }
      })
      .catch(() => { /* keep cached/null */ });

    const prPromise = (prStatus && prStatus !== 'none')
      ? getPRStatus(workspaceId, sessionId)
          .then((details) => {
            if (!cancelled) setPRDetails(details);
          })
          .catch(() => { /* keep null */ })
      : Promise.resolve();

    Promise.all([snapshotPromise, prPromise]).then(() => {
      if (!cancelled) {
        setLoading(false);
        fetchedRef.current = key;
      }
    });

    return () => {
      cancelled = true;
      setLoading(false);
    };
  }, [enabled, workspaceId, sessionId, prStatus]);

  return { gitStatus, prDetails, loading };
}
