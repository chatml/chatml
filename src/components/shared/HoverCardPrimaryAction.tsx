'use client';

import { useCallback } from 'react';
import { useHoverActionData } from '@/hooks/useHoverActionData';
import { useActionState } from '@/components/shared/PrimaryActionButton/useActionState';
import { ActionButton } from '@/components/shared/PrimaryActionButton/ActionButton';
import { dispatchAppEvent } from '@/lib/custom-events';
import { getTemplateKey } from '@/lib/action-templates';
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
  const { gitStatus, prDetails, loading } = useHoverActionData(
    session.workspaceId,
    session.id,
    session.prStatus,
    hoverOpen,
  );

  const action = useActionState(gitStatus, session, prDetails);

  const handleSendMessage = useCallback((content: string, actionType: PrimaryActionType) => {
    onClose();
    onSelectSession(session.id);
    requestAnimationFrame(() => {
      dispatchAppEvent('primary-action-execute', {
        message: content,
        templateKey: getTemplateKey(actionType),
        workspaceId: session.workspaceId,
      });
    });
  }, [onClose, onSelectSession, session.id, session.workspaceId]);

  const handleArchive = useCallback((sessionId: string) => {
    onClose();
    onArchiveSession?.(sessionId);
  }, [onClose, onArchiveSession]);

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
