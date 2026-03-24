'use client';

import { MessageCircleQuestion, ClipboardCheck } from 'lucide-react';
import { useSessionActivityState } from '@/stores/selectors';
import { navigate } from '@/lib/navigation';
import { formatRelativeTime } from '@/components/shared/SessionInfoParts';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { cn } from '@/lib/utils';
import type { WorktreeSession, Workspace } from '@/lib/types';

interface SessionRowProps {
  session: WorktreeSession;
  workspace: Workspace | undefined;
  workspaceColors: Record<string, string>;
  isActive: boolean;
}

const STATUS_CONFIG = {
  working: {
    label: 'Working...',
    textClass: 'text-brand',
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

export function SessionRow({ session, workspace, workspaceColors, isActive }: SessionRowProps) {
  const activityState = useSessionActivityState(session.id);
  const color = resolveWorkspaceColor(session.workspaceId, workspaceColors);
  const hasStats = (session.stats?.additions ?? 0) > 0 || (session.stats?.deletions ?? 0) > 0;
  const hasSecondRow = workspace || session.task || hasStats || session.prNumber;
  const statusConfig = activityState !== 'idle' ? STATUS_CONFIG[activityState] : null;

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
      className={cn(
        'w-full flex flex-col gap-1 rounded-lg px-3 py-2.5 text-left cursor-pointer transition-colors duration-100',
        'border-l-2',
        isActive
          ? 'bg-surface-1/30 hover:bg-surface-1/50'
          : 'border-l-transparent hover:bg-surface-1/40'
      )}
      style={isActive ? { borderLeftColor: color } : undefined}
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
            <MessageCircleQuestion className="w-3.5 h-3.5 text-purple-500" />
          </div>
        )}
        {activityState === 'awaiting_approval' && (
          <div className="w-4 shrink-0 flex items-center justify-center">
            <ClipboardCheck className="w-3.5 h-3.5 text-blue-500" />
          </div>
        )}

        {/* Relative time */}
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </div>

      {/* Row 2: status label + secondary info */}
      {(hasSecondRow || statusConfig) && (
        <div className="flex items-center gap-3 ml-5 text-[11px] text-muted-foreground">
          {statusConfig && (
            <span className={cn('shrink-0', statusConfig.textClass)}>
              {statusConfig.label}
            </span>
          )}

          {workspace && (
            <>
              {statusConfig && <span className="text-border">·</span>}
              <span className="truncate max-w-[120px]">{workspace.name}</span>
            </>
          )}

          {session.task && (
            <>
              <span className="text-border">·</span>
              <span className="truncate max-w-[200px]">{session.task}</span>
            </>
          )}

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

          {session.prNumber && session.prStatus === 'open' && (
            <>
              <span className="text-border">·</span>
              <span className="shrink-0 text-brand">#{session.prNumber}</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}
