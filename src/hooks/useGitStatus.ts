'use client';

import type { GitStatusDTO } from '@/lib/api';
import { useSessionSnapshot } from './useSessionSnapshot';

interface UseGitStatusResult {
  status: GitStatusDTO | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and maintain git status for a session's worktree.
 *
 * Thin wrapper around useSessionSnapshot — delegates to the consolidated
 * /snapshot endpoint so that git status, changes, and branch data are all
 * fetched in a single round-trip.
 */
export function useGitStatus(
  workspaceId: string | null,
  sessionId: string | null,
  active: boolean = true
): UseGitStatusResult {
  const snapshot = useSessionSnapshot(workspaceId, sessionId, active);

  return {
    status: snapshot.gitStatus,
    loading: snapshot.loading,
    error: snapshot.error,
    errorCode: snapshot.errorCode,
    refetch: snapshot.refetch,
  };
}
