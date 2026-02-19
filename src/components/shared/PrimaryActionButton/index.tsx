'use client';

import { useEffect } from 'react';
import { useGitStatus } from '@/hooks/useGitStatus';
import { usePRStatus } from '@/hooks/usePRStatus';
import { useActionState } from './useActionState';
import { ActionButton } from './ActionButton';
import { useAppStore } from '@/stores/appStore';
import type { GitStatusDTO, PRDetails } from '@/lib/api';

interface WorktreeSession {
  id: string;
  status?: string;
  prStatus?: string;
  prNumber?: number;
  prUrl?: string;
  checkStatus?: string;
}

interface PrimaryActionButtonProps {
  workspaceId: string | null;
  session: WorktreeSession | null | undefined;
  onSendMessage: (content: string) => void;
  onFixIssues?: () => void;
  onArchiveSession?: (sessionId: string) => void;
  onCreatePR?: () => void;
  // Optional: pass pre-fetched data to avoid duplicate fetches
  gitStatus?: GitStatusDTO | null;
  prDetails?: PRDetails | null;
}

export function PrimaryActionButton({
  workspaceId,
  session,
  onSendMessage,
  onFixIssues,
  onArchiveSession,
  onCreatePR,
  gitStatus: externalGitStatus,
  prDetails: externalPRDetails,
}: PrimaryActionButtonProps) {
  // Use provided data or fetch it
  const {
    status: fetchedGitStatus,
    loading: gitLoading,
  } = useGitStatus(
    externalGitStatus !== undefined ? null : workspaceId,
    externalGitStatus !== undefined ? null : session?.id ?? null
  );

  const {
    prDetails: fetchedPRDetails,
    loading: prLoading,
  } = usePRStatus(
    externalPRDetails !== undefined ? null : workspaceId,
    externalPRDetails !== undefined ? null : session?.id ?? null,
    externalPRDetails !== undefined ? undefined : session?.prStatus
  );

  // Prefer external data if provided
  const gitStatus = externalGitStatus !== undefined ? externalGitStatus : fetchedGitStatus;
  const prDetails = externalPRDetails !== undefined ? externalPRDetails : fetchedPRDetails;

  // Sync store when GitHub reports a different PR state than what the store has.
  // This handles the case where a PR was merged/closed externally (e.g. by the agent
  // running `gh pr merge`) but the PRWatcher hasn't polled yet.
  // Guard: only sync when the session actually has a PR and the prDetails
  // belongs to this session (matching PR number) to avoid cross-contamination
  // when switching between sessions.
  const updateSession = useAppStore((s) => s.updateSession);
  useEffect(() => {
    if (!session?.id || !prDetails) return;
    if (!session.prNumber || prDetails.number !== session.prNumber) return;

    const updates: Record<string, string> = {};

    // Sync prStatus
    if (prDetails.merged && session.prStatus !== 'merged') {
      updates.prStatus = 'merged';
    } else if (prDetails.state === 'closed' && !prDetails.merged && session.prStatus !== 'closed') {
      updates.prStatus = 'closed';
    }

    // Sync checkStatus
    if (prDetails.checkStatus && prDetails.checkStatus !== session.checkStatus) {
      updates.checkStatus = prDetails.checkStatus;
    }

    if (Object.keys(updates).length > 0) {
      updateSession(session.id, updates);
    }
  }, [session?.id, session?.prNumber, session?.prStatus, session?.checkStatus, prDetails, updateSession]);

  // Get the action based on current state
  const action = useActionState(
    gitStatus,
    session,
    prDetails,
  );

  // Determine loading state
  const isLoading = gitLoading || prLoading;

  return (
    <ActionButton
      action={action}
      isLoading={isLoading}
      onSendMessage={onSendMessage}
      onFixIssues={onFixIssues}
      onArchiveSession={onArchiveSession}
      onCreatePR={onCreatePR}
    />
  );
}

// Re-export types for convenience
export type { PrimaryAction, ActionButtonProps } from './types';
