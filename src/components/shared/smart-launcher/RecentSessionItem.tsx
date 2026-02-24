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
  const hasStats = (session.stats?.additions ?? 0) > 0 || (session.stats?.deletions ?? 0) > 0;
  const hasSecondRow = workspace || session.task || hasStats || session.prNumber;

  return (
    <button
      onClick={handleClick}
      className="w-full rounded-xl border border-transparent px-4 py-3 hover:bg-card/60 hover:border-border/50 transition-all duration-150 text-left cursor-pointer"
    >
      {/* Row 1: primary info */}
      <div className="flex items-center gap-2.5">
        {/* Workspace color dot */}
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />

        {/* Session name */}
        <span className="text-sm font-medium text-foreground truncate min-w-0 flex-1">
          {session.name || session.branch}
        </span>

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
      </div>

      {/* Row 2: secondary info */}
      {hasSecondRow && (
        <div className="flex items-center gap-3 mt-1.5 ml-5 text-xs text-muted-foreground">
          {/* Workspace name */}
          {workspace && (
            <span className="truncate max-w-[120px]">{workspace.name}</span>
          )}

          {/* Task description */}
          {session.task && (
            <>
              <span className="text-border">·</span>
              <span className="truncate max-w-[200px]">{session.task}</span>
            </>
          )}

          {/* Diff stats */}
          {session.stats && (session.stats.additions > 0 || session.stats.deletions > 0) && (
            <>
              <span className="text-border">·</span>
              <span className="shrink-0">
                {session.stats.additions > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">+{session.stats.additions}</span>
                )}
                {session.stats.additions > 0 && session.stats.deletions > 0 && ' '}
                {session.stats.deletions > 0 && (
                  <span className="text-red-500">-{session.stats.deletions}</span>
                )}
              </span>
            </>
          )}

          {/* PR badge */}
          {session.prNumber && session.prStatus === 'open' && (
            <>
              <span className="text-border">·</span>
              <span className="shrink-0 text-primary">#{session.prNumber}</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}
