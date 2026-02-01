'use client';

import { useGitStatus } from '@/hooks/useGitStatus';
import { usePRStatus } from '@/hooks/usePRStatus';
import { useActionState } from './useActionState';
import { ActionButton } from './ActionButton';
import type { GitStatusDTO, PRDetails } from '@/lib/api';

interface WorktreeSession {
  id: string;
  status?: string;
  prStatus?: string;
  prUrl?: string;
}

interface PrimaryActionButtonProps {
  workspaceId: string | null;
  session: WorktreeSession | null | undefined;
  onSendMessage: (content: string) => void;
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

  // Determine if agent is currently working
  const isAgentWorking = session?.status === 'active';

  // Get the action based on current state
  const action = useActionState(
    gitStatus,
    session,
    prDetails,
    isAgentWorking
  );

  // Determine loading state
  const isLoading = gitLoading || prLoading;

  return (
    <ActionButton
      action={action}
      isLoading={isLoading}
      disabled={isAgentWorking}
      onSendMessage={onSendMessage}
      onArchiveSession={onArchiveSession}
      onCreatePR={onCreatePR}
    />
  );
}

// Re-export types for convenience
export type { PrimaryAction, ActionButtonProps } from './types';
