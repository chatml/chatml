'use client';

import { MessageCircleQuestion, ClipboardCheck } from 'lucide-react';
import { useSessionActivityState } from '@/stores/selectors';
import { navigate } from '@/lib/navigation';
import { formatRelativeTime } from '@/components/shared/SessionInfoParts';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import type { WorktreeSession, Workspace } from '@/lib/types';

interface LiveActivityCardProps {
  session: WorktreeSession;
  workspace: Workspace | undefined;
  workspaceColors: Record<string, string>;
}

const STATUS_CONFIG = {
  working: {
    label: 'Working...',
    textClass: 'text-primary',
  },
  awaiting_input: {
    label: 'Needs input',
    textClass: 'text-purple-500',
  },
  awaiting_approval: {
    label: 'Awaiting approval',
    textClass: 'text-blue-500',
  },
} as const;

export function LiveActivityCard({ session, workspace, workspaceColors }: LiveActivityCardProps) {
  const activityState = useSessionActivityState(session.id);
  const config = activityState === 'idle' ? STATUS_CONFIG.working : STATUS_CONFIG[activityState];
  const color = resolveWorkspaceColor(session.workspaceId, workspaceColors);

  const handleClick = () => {
    navigate({
      workspaceId: session.workspaceId,
      sessionId: session.id,
      contentView: { type: 'conversation' },
    });
  };

  return (
    <button
      onClick={handleClick}
      className="w-[200px] shrink-0 snap-start rounded-xl border border-border/50 bg-card/50 px-4 py-3 hover:border-border hover:bg-card transition-all duration-200 cursor-pointer text-left"
    >
      {/* Row 1: workspace dot + session name */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-medium text-foreground truncate">
          {session.name || session.branch}
        </span>
      </div>

      {/* Row 2: status indicator + status text + time */}
      <div className="flex items-center gap-2">
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

        <span className={`text-xs ${config.textClass} truncate flex-1`}>
          {config.label}
        </span>

        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </div>
    </button>
  );
}
