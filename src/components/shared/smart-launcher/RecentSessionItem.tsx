'use client';

import { MessageCircleQuestion, ClipboardCheck } from 'lucide-react';
import { useSessionActivityState } from '@/stores/selectors';
import { navigate } from '@/lib/navigation';
import { formatRelativeTime } from '@/components/shared/SessionInfoParts';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import type { WorktreeSession, Workspace } from '@/lib/types';

interface RecentSessionItemProps {
  session: WorktreeSession;
  workspace: Workspace | undefined;
  workspaceColors: Record<string, string>;
}

export function RecentSessionItem({ session, workspace, workspaceColors }: RecentSessionItemProps) {
  const activityState = useSessionActivityState(session.id);

  const handleClick = () => {
    navigate({
      workspaceId: session.workspaceId,
      sessionId: session.id,
      contentView: { type: 'conversation' },
    });
  };

  const color = resolveWorkspaceColor(session.workspaceId, workspaceColors);

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-card/50 transition-colors text-left cursor-pointer"
    >
      {/* Workspace color dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />

      {/* Session name */}
      <span className="text-sm text-foreground truncate min-w-0 flex-1">
        {session.name || session.branch}
      </span>

      {/* Workspace name */}
      {workspace && (
        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
          {workspace.name}
        </span>
      )}

      {/* Activity indicator */}
      {activityState === 'working' && (
        <div className="w-4 shrink-0 flex items-center justify-center">
          <div className="session-active-indicator">
            <div className="bar" />
            <div className="bar" />
            <div className="bar" />
          </div>
        </div>
      )}
      {activityState === 'awaiting_input' && (
        <div className="w-4 shrink-0 flex items-center justify-center">
          <div className="session-awaiting-input-indicator">
            <MessageCircleQuestion className="w-3.5 h-3.5 text-purple-500" />
          </div>
        </div>
      )}
      {activityState === 'awaiting_approval' && (
        <div className="w-4 shrink-0 flex items-center justify-center">
          <div className="session-awaiting-approval-indicator">
            <ClipboardCheck className="w-3.5 h-3.5 text-blue-500" />
          </div>
        </div>
      )}

      {/* Relative time */}
      <span className="text-xs text-muted-foreground shrink-0">
        {formatRelativeTime(session.updatedAt)}
      </span>
    </button>
  );
}
