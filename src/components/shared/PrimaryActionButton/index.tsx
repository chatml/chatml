'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGitStatus } from '@/hooks/useGitStatus';
import { usePRStatus } from '@/hooks/usePRStatus';
import { useActionState } from './useActionState';
import { ActionButton } from './ActionButton';
import { useAppStore } from '@/stores/appStore';
import type { GitStatusDTO, PRDetails } from '@/lib/api';
import { getGlobalActionTemplates, getWorkspaceActionTemplates } from '@/lib/api';
import type { WorktreeSession } from '@/lib/types';
import { ACTION_TEMPLATES, getTemplateKey, fetchMergedActionTemplates } from '@/lib/action-templates';
import type { ActionTemplateKey } from '@/lib/action-templates';
import type { PrimaryActionType } from './types';

interface PrimaryActionButtonProps {
  workspaceId: string | null;
  session: WorktreeSession | null | undefined;
  onSendMessage: (content: string) => void;
  onSendMessageWithTemplate: (content: string, templateContent: string, templateKey: ActionTemplateKey) => void;
  onFixIssues?: () => void;
  onArchiveSession?: (sessionId: string) => void;
  // Optional: pass pre-fetched data to avoid duplicate fetches
  gitStatus?: GitStatusDTO | null;
  prDetails?: PRDetails | null;
}

export function PrimaryActionButton({
  workspaceId,
  session,
  onSendMessage,
  onSendMessageWithTemplate,
  onFixIssues,
  onArchiveSession,
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
  // Uses a ref to track what was last synced, preventing cascading re-render loops
  // where updateSession → sessions change → Home re-renders → new config → repeat.
  const updateSession = useAppStore((s) => s.updateSession);
  const lastSyncedRef = useRef<string | null>(null);
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
      // Deduplicate: skip if we already synced this exact update for this session
      const syncKey = `${session.id}:${JSON.stringify(updates)}`;
      if (lastSyncedRef.current === syncKey) return;
      lastSyncedRef.current = syncKey;
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

  // ---------------------------------------------------------------------------
  // Action templates — fetch merged templates and wrap onSendMessage
  // ---------------------------------------------------------------------------

  const [mergedTemplates, setMergedTemplates] = useState<Record<ActionTemplateKey, string>>(ACTION_TEMPLATES);

  // Fetch helper — used on mount and when settings change
  const refreshTemplates = useCallback(() => {
    if (!workspaceId) return;
    fetchMergedActionTemplates(workspaceId, getGlobalActionTemplates, getWorkspaceActionTemplates)
      .then((t) => setMergedTemplates(t))
      .catch(() => { /* use built-in defaults */ });
  }, [workspaceId]);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  // Re-fetch when action templates are saved in settings
  useEffect(() => {
    const handler = () => refreshTemplates();
    window.addEventListener('action-templates-changed', handler);
    return () => window.removeEventListener('action-templates-changed', handler);
  }, [refreshTemplates]);

  // Wrap onSendMessage to include template content when available.
  // Accepts actionType from the click handler to avoid stale closure issues.
  const handleSendWithTemplate = useCallback((content: string, actionType: PrimaryActionType) => {
    const templateKey = getTemplateKey(actionType);
    const templateContent = templateKey ? mergedTemplates[templateKey] : null;
    if (templateContent && templateKey) {
      onSendMessageWithTemplate(content, templateContent, templateKey);
    } else {
      onSendMessage(content);
    }
  }, [mergedTemplates, onSendMessage, onSendMessageWithTemplate]);

  return (
    <ActionButton
      action={action}
      isLoading={isLoading}
      onSendMessage={handleSendWithTemplate}
      onFixIssues={onFixIssues}
      onArchiveSession={onArchiveSession}
    />
  );
}

// Re-export types for convenience
export type { PrimaryAction, ActionButtonProps } from './types';
