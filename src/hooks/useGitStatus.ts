'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getGitStatus, GitStatusDTO } from '@/lib/api';
import { GIT_STATUS_POLL_INTERVAL_MS } from '@/lib/constants';
import { listenForFileChanges, type FileChangedEvent } from '@/lib/tauri';

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
 * - Refetches on file change events
 * - Debounces rapid file changes
 */
export function useGitStatus(
  workspaceId: string | null,
  sessionId: string | null
): UseGitStatusResult {
  const [status, setStatus] = useState<GitStatusDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Listen for file change events
  useEffect(() => {
    if (!workspaceId) return;

    const cleanupRef = { current: null as (() => void) | null };
    let isMounted = true;

    const handleFileChange = (event: FileChangedEvent) => {
      // Only refetch if the file change is for this workspace
      if (event.workspaceId === workspaceId) {
        debouncedRefetch();
      }
    };

    listenForFileChanges(handleFileChange).then((unlisten) => {
      if (isMounted) {
        cleanupRef.current = unlisten;
      } else {
        // Component unmounted before listener was set up - safely try to unlisten
        try {
          unlisten();
        } catch {
          // Ignore errors if listener was never fully registered
        }
      }
    });

    return () => {
      isMounted = false;
      try {
        cleanupRef.current?.();
      } catch {
        // Ignore errors during cleanup if listener state is inconsistent
      }
    };
  }, [workspaceId, debouncedRefetch]);

  return { status, loading, error, refetch };
}
