'use client';

import { useCallback } from 'react';
import { useHoverActionData } from '@/hooks/useHoverActionData';
import { useActionState } from '@/components/shared/PrimaryActionButton/useActionState';
import { ActionButton } from '@/components/shared/PrimaryActionButton/ActionButton';
import { dispatchAppEvent } from '@/lib/custom-events';
import { getTemplateKey, ACTION_TEMPLATES } from '@/lib/action-templates';
import { useSessionActivityState } from '@/stores/selectors';
import type { WorktreeSession } from '@/lib/types';
import type { PrimaryActionType } from '@/components/shared/PrimaryActionButton/types';

interface HoverCardPrimaryActionProps {
  session: WorktreeSession;
  hoverOpen: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onArchiveSession?: (sessionId: string) => void;
}

export function HoverCardPrimaryAction({
  session,
  hoverOpen,
  onClose,
  onSelectSession,
  onArchiveSession,
}: HoverCardPrimaryActionProps) {
  const sessionActivityState = useSessionActivityState(session.id);
  const isAgentWorking = sessionActivityState === 'working';

  const { gitStatus, prDetails, templates, loading } = useHoverActionData(
    session.workspaceId,
    session.id,
    session.prStatus,
    hoverOpen,
  );

  const action = useActionState(gitStatus, session, prDetails);

  const handleSendMessage = useCallback((content: string, actionType: PrimaryActionType) => {
    const templateKey = getTemplateKey(actionType);
    // Resolve template content eagerly — templates were pre-fetched on hover open
    const templateContent = templateKey
      ? (templates?.[templateKey] ?? ACTION_TEMPLATES[templateKey])
      : undefined;
    onClose();
    onSelectSession(session.id);
    requestAnimationFrame(() => {
      dispatchAppEvent('primary-action-execute', {
        message: content,
        templateKey,
        templateContent,
        workspaceId: session.workspaceId,
      });
    });
  }, [onClose, onSelectSession, session.id, session.workspaceId, templates]);

  const handleArchive = useCallback((sessionId: string) => {
    onClose();
    onArchiveSession?.(sessionId);
  }, [onClose, onArchiveSession]);

  if (isAgentWorking) {
    return (
      <div className="flex items-center gap-1.5 h-6 px-2">
        <div className="flex items-end gap-[1.5px] h-3" aria-hidden="true">
          <div className="w-[2.5px] bg-ai-active rounded-full animate-agent-bar-1" />
          <div className="w-[2.5px] bg-ai-active rounded-full animate-agent-bar-2" />
          <div className="w-[2.5px] bg-ai-active rounded-full animate-agent-bar-3" />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">Agent is working</span>
      </div>
    );
  }

  // Show nothing while loading with no cached data, or when no action is available
  if (loading && !gitStatus && !action) {
    return <div className="h-6 w-24 rounded bg-muted animate-pulse" />;
  }

  if (!action) {
    return null;
  }

  return (
    <ActionButton
      action={action}
      isLoading={loading}
      onSendMessage={handleSendMessage}
      onArchiveSession={onArchiveSession ? handleArchive : undefined}
    />
  );
}
