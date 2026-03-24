'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getGitStatus, type GitStatusDTO, ApiError } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { GIT_STATUS_POLL_INTERVAL_MS } from '@/lib/constants';

export interface UseBaseSessionGitStatusResult {
  gitStatus: GitStatusDTO | null;
  loading: boolean;
}

/**
 * Lightweight git status hook for base session cards in the sidebar.
 * Calls getGitStatus (not the full snapshot) and polls at 2x the normal interval.
 */
export function useBaseSessionGitStatus(
  workspaceId: string | null,
  sessionId: string | null,
  active: boolean = true,
): UseBaseSessionGitStatusResult {
  const [gitStatus, setGitStatus] = useState<GitStatusDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const lastFileChange = useAppStore((s) => s.lastFileChange);

  const isMountedRef = useRef(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!workspaceId || !sessionId) {
      setGitStatus(null);
      setLoading(false);
      return;
    }

    try {
      const status = await getGitStatus(workspaceId, sessionId);
      if (isMountedRef.current) {
        setGitStatus(status);
        setLoading(false);
      }
    } catch (err) {
      if (isMountedRef.current) {
        const isTransientNetwork = err instanceof ApiError && err.status === 0;
        if (!isTransientNetwork) {
          console.error('Failed to fetch base session git status:', err);
        }
        setLoading(false);
      }
    }
  }, [workspaceId, sessionId]);

  const debouncedRefetch = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      fetchStatus();
    }, 500);
  }, [fetchStatus]);

  // Initial fetch
  useEffect(() => {
    isMountedRef.current = true;

    if (active) {
      const id = setTimeout(() => fetchStatus(), 0);
      return () => {
        isMountedRef.current = false;
        clearTimeout(id);
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }

    return () => {
      isMountedRef.current = false;
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [fetchStatus, active]);

  // Periodic polling at 2x normal interval
  useEffect(() => {
    if (!active || !workspaceId || !sessionId) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, GIT_STATUS_POLL_INTERVAL_MS * 2);

    return () => clearInterval(interval);
  }, [active, workspaceId, sessionId, fetchStatus]);

  // React to file change events
  useEffect(() => {
    if (!active || !workspaceId || !lastFileChange) return;
    if (lastFileChange.workspaceId === workspaceId) {
      debouncedRefetch();
    }
  }, [active, lastFileChange, workspaceId, debouncedRefetch]);

  return { gitStatus, loading };
}
