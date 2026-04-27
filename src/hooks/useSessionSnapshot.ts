'use client';

import { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import {
  getSessionSnapshot,
  type SessionSnapshotDTO,
  type GitStatusDTO,
  type FileChangeDTO,
  type BranchStatsDTO,
  type BranchCommitDTO,
  ApiError,
  ErrorCode,
} from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { GIT_STATUS_POLL_INTERVAL_MS } from '@/lib/constants';
import {
  getSessionData,
  setSessionData,
} from '@/lib/sessionDataCache';

export interface UseSessionSnapshotResult {
  gitStatus: GitStatusDTO | null;
  changes: FileChangeDTO[];
  allChanges: FileChangeDTO[];
  branchStats: BranchStatsDTO | null;
  branchCommits: BranchCommitDTO[];
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refetch: () => Promise<void>;
}

/**
 * Consolidated hook that replaces separate useGitStatus + ChangesPanel fetch effects.
 * Fetches a single /snapshot endpoint that returns git status, changes, and branch data.
 *
 * Features:
 * - Stale-while-revalidate: shows cached data instantly on session switch
 * - Single network call instead of 3-4 separate API calls
 * - Debounced refetch on file change events (500ms)
 * - Periodic polling (30s)
 * - Stops on permanent errors (WORKTREE_NOT_FOUND)
 */
export function useSessionSnapshot(
  workspaceId: string | null,
  sessionId: string | null,
  active: boolean = true,
): UseSessionSnapshotResult {
  const [gitStatus, setGitStatus] = useState<GitStatusDTO | null>(null);
  const [changes, setChanges] = useState<FileChangeDTO[]>([]);
  const [allChanges, setAllChanges] = useState<FileChangeDTO[]>([]);
  const [branchStats, setBranchStats] = useState<BranchStatsDTO | null>(null);
  const [branchCommits, setBranchCommits] = useState<BranchCommitDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const lastFileChange = useAppStore((s) => s.lastFileChange);
  const lastStatsInvalidation = useAppStore((s) => s.lastStatsInvalidation);

  const hasBeenActiveRef = useRef(active);
  useEffect(() => {
    if (active) hasBeenActiveRef.current = true;
  }, [active]);

  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(false);
  const permanentErrorRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastFetchAtRef = useRef<number>(0);

  const applySnapshot = useCallback((snap: SessionSnapshotDTO) => {
    setGitStatus(snap.gitStatus);
    setChanges(snap.changes || []);
    setAllChanges(snap.allChanges || []);
    setBranchStats(snap.branchStats || null);
    setBranchCommits(snap.commits || []);
    setError(null);
    setErrorCode(null);
    setLoading(false);
  }, []);

  const fetchSnapshot = useCallback(async () => {
    if (!workspaceId || !sessionId) {
      setGitStatus(null);
      setChanges([]);
      setAllChanges([]);
      setBranchStats(null);
      setBranchCommits([]);
      setLoading(false);
      return;
    }

    if (permanentErrorRef.current) return;

    // Cancel any in-flight fetch for the previous session
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    lastFetchAtRef.current = Date.now();

    try {
      const snap = await getSessionSnapshot(workspaceId, sessionId, controller.signal);
      if (isMountedRef.current && !controller.signal.aborted) {
        applySnapshot(snap);

        // Update the session data cache for stale-while-revalidate
        setSessionData(workspaceId, sessionId, {
          files: [], // Files are fetched separately by ChangesPanel
          changes: snap.changes || [],
          allChanges: snap.allChanges || [],
          branchStats: snap.branchStats || null,
          gitStatus: snap.gitStatus,
          commits: snap.commits || [],
        });
      }
    } catch (err) {
      // Silently ignore aborted requests (user switched sessions)
      if (controller.signal.aborted) return;

      if (isMountedRef.current) {
        const isPermanent =
          err instanceof ApiError && err.code === ErrorCode.WORKTREE_NOT_FOUND;
        if (isPermanent) {
          permanentErrorRef.current = true;
        }
        if (!isPermanent) {
          const isTransientNetwork = err instanceof ApiError && err.status === 0;
          if (!isTransientNetwork) {
            console.error('Failed to fetch session snapshot:', err);
          }
        }
        setError(err instanceof Error ? err.message : 'Failed to fetch session snapshot');
        setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
        setLoading(false);
      }
    }
  }, [workspaceId, sessionId, applySnapshot]);

  // Debounced refetch for file change events
  const debouncedRefetch = useCallback(() => {
    if (permanentErrorRef.current) return;
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      fetchSnapshot();
    }, 500);
  }, [fetchSnapshot]);

  // Exposed refetch
  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchSnapshot();
  }, [fetchSnapshot]);

  // Reset state and restore cache on session change
  useEffect(() => {
    permanentErrorRef.current = false;

    if (workspaceId && sessionId) {
      // Try to restore cached data instantly (stale-while-revalidate)
      const cached = getSessionData(workspaceId, sessionId);
      if (cached) {
        // Wrap in startTransition so multiple setState calls are batched and
        // don't trigger the react-hooks/set-state-in-effect lint rule.
        startTransition(() => {
          setChanges(cached.changes);
          setAllChanges(cached.allChanges);
          setBranchStats(cached.branchStats);
          setGitStatus(cached.gitStatus ?? null);
          if (cached.commits) setBranchCommits(cached.commits);
          setLoading(false);
          setError(null);
          setErrorCode(null);
        });
        return; // Background fetch effect will still revalidate
      }
    }

    // No cache — clear and show loading
    const id = setTimeout(() => {
      setGitStatus(null);
      setChanges([]);
      setAllChanges([]);
      setBranchStats(null);
      setBranchCommits([]);
      setLoading(true);
      setError(null);
      setErrorCode(null);
    }, 0);
    return () => clearTimeout(id);
  }, [workspaceId, sessionId]);

  // Initial fetch and fetch on session change
  useEffect(() => {
    isMountedRef.current = true;

    if (!hasBeenActiveRef.current) {
      return () => {
        isMountedRef.current = false;
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }

    const id = setTimeout(() => fetchSnapshot(), 0);

    return () => {
      isMountedRef.current = false;
      clearTimeout(id);
      abortControllerRef.current?.abort();
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [fetchSnapshot, active]);

  // Periodic polling. Skipped when the document is hidden so backgrounded
  // windows don't keep re-fetching the 200KB+ snapshot every 30s. Also
  // throttled against `lastFetchAtRef` so a poll tick that fires within
  // half a poll-interval of the visibility-change refetch (below) collapses
  // into a single fetch instead of double-rendering on tab focus.
  useEffect(() => {
    if (!active || !workspaceId || !sessionId) return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (permanentErrorRef.current) return;
      if (Date.now() - lastFetchAtRef.current < GIT_STATUS_POLL_INTERVAL_MS / 2) {
        return;
      }
      fetchSnapshot();
    }, GIT_STATUS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [active, workspaceId, sessionId, fetchSnapshot]);

  // Refetch immediately when the tab becomes visible again. Without this,
  // returning users would see snapshot data up to one full poll interval
  // stale before the next setInterval tick fires. The poll tick above checks
  // `lastFetchAtRef` and skips if this fires close to a poll boundary, so
  // tab focus produces exactly one fetch even when the poll tick is imminent.
  useEffect(() => {
    if (!active || !workspaceId || !sessionId) return;
    if (typeof document === 'undefined') return;

    const onVisibilityChange = () => {
      if (!document.hidden && !permanentErrorRef.current) {
        fetchSnapshot();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [active, workspaceId, sessionId, fetchSnapshot]);

  // React to file change events
  useEffect(() => {
    if (!active || !workspaceId || !lastFileChange) return;
    if (lastFileChange.workspaceId === workspaceId) {
      debouncedRefetch();
    }
  }, [active, lastFileChange, workspaceId, debouncedRefetch]);

  // The session_stats_update WebSocket event updates the stats badge immediately
  // via updateSession(), but does not carry the full file-change list or branch
  // commits. This refetch ensures the detailed snapshot stays in sync after a
  // commit, stage, or index change.
  useEffect(() => {
    if (!active || !sessionId || !lastStatsInvalidation) return;
    if (lastStatsInvalidation.sessionId === sessionId) {
      debouncedRefetch();
    }
  }, [active, lastStatsInvalidation, sessionId, debouncedRefetch]);

  return {
    gitStatus,
    changes,
    allChanges,
    branchStats,
    branchCommits,
    loading,
    error,
    errorCode,
    refetch,
  };
}
