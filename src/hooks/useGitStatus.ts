'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getGitStatus, GitStatusDTO } from '@/lib/api';
import { GIT_STATUS_POLL_INTERVAL_MS } from '@/lib/constants';
import { useAppStore } from '@/stores/appStore';

interface UseGitStatusResult {
  status: GitStatusDTO | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and maintain git status for a session's worktree.
 *
 * Features:
 * - Fetches status on mount and session change
 * - Polls periodically (every 30 seconds)
 * - Refetches on file change events via the centralized lastFileChange store
 * - Debounces rapid file changes
 */
export function useGitStatus(
  workspaceId: string | null,
  sessionId: string | null
): UseGitStatusResult {
  const [status, setStatus] = useState<GitStatusDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to centralized file change events from the store
  const lastFileChange = useAppStore((s) => s.lastFileChange);

  // Refs for debouncing and cleanup
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(false);

  // Fetch git status
  const fetchStatus = useCallback(async () => {
    if (!workspaceId || !sessionId) {
      setStatus(null);
      setLoading(false);
      return;
    }

    try {
      const data = await getGitStatus(workspaceId, sessionId);
      if (isMountedRef.current) {
        setStatus(data);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Failed to fetch git status:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch git status');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, sessionId]);

  // Debounced refetch for file change events
  const debouncedRefetch = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      fetchStatus();
    }, 500); // 500ms debounce for rapid file changes
  }, [fetchStatus]);

  // Exposed refetch function
  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchStatus();
  }, [fetchStatus]);

  // Initial fetch and fetch on session change
  useEffect(() => {
    isMountedRef.current = true;
    setLoading(true);
    fetchStatus();

    return () => {
      isMountedRef.current = false;
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [fetchStatus]);

  // Periodic polling
  useEffect(() => {
    if (!workspaceId || !sessionId) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, GIT_STATUS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [workspaceId, sessionId, fetchStatus]);

  // React to file change events from centralized store
  useEffect(() => {
    if (!workspaceId || !lastFileChange) return;
    if (lastFileChange.workspaceId === workspaceId) {
      debouncedRefetch();
    }
  }, [lastFileChange, workspaceId, debouncedRefetch]);

  return { status, loading, error, refetch };
}
