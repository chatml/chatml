'use client';

import { GitBranch, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';
import { getTaskStatusOption } from '@/lib/session-fields';
import { PRNumberBadge } from '@/components/shared/PRNumberBadge';
import type { WorktreeSession } from '@/lib/types';

interface SessionHoverCardBodyProps {
  session: WorktreeSession;
  formatTimeAgo: (date: string) => string;
  onCreatePR?: () => void;
}

export function SessionHoverCardBody({
  session,
  formatTimeAgo,
  onCreatePR,
}: SessionHoverCardBodyProps) {
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);
  const hasPR = session.prStatus && session.prStatus !== 'none';
  const statusOption = getTaskStatusOption(session.taskStatus);

  return (
    <>
      {/* Header: branch icon + name */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground truncate">
          {session.branch || session.name}
        </span>
      </div>

      {/* Meta row: status + time */}
      <div className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground">
        <TaskStatusIcon status={session.taskStatus} className="h-3 w-3 shrink-0" />
        <span className="shrink-0">{statusOption.label}</span>
        <span className="text-muted-foreground/50">&middot;</span>
        <span className="shrink-0">{formatTimeAgo(session.updatedAt)}</span>
      </div>

      {/* PR row */}
      {hasPR && session.prNumber && session.prTitle && (
        <div className="border-t border-border/50 px-3 py-2 flex items-center gap-2 min-w-0">
          <PRNumberBadge
            prNumber={session.prNumber}
            prStatus={session.prStatus as 'open' | 'merged' | 'closed'}
            checkStatus={session.checkStatus}
            hasMergeConflict={session.hasMergeConflict}
            prUrl={session.prUrl}
          />
          <span className="text-xs text-muted-foreground truncate">{session.prTitle}</span>
        </div>
      )}

      {/* Description */}
      {session.task && (
        <div className="border-t border-border/50 px-3 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {session.task}
          </p>
        </div>
      )}

      {/* Footer: stats + Create PR */}
      {hasStats && (
        <div className="border-t border-border/50 px-3 py-2 flex items-center gap-2">
          <span className="text-xs font-mono tabular-nums">
            <span className="text-text-success">+{session.stats!.additions}</span>
            <span className="text-text-error ml-1.5">-{session.stats!.deletions}</span>
          </span>
          {!hasPR && onCreatePR && (
            <button
              type="button"
              className={cn(
                'ml-auto flex items-center gap-1 text-xs px-2 py-1 rounded',
                'border border-border/50 text-muted-foreground',
                'hover:bg-surface-1 hover:text-foreground transition-colors',
              )}
              onClick={(e) => {
                e.stopPropagation();
                onCreatePR();
              }}
            >
              <GitPullRequest className="h-3 w-3" />
              Create PR
            </button>
          )}
        </div>
      )}
    </>
  );
}
