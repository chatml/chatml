'use client';

import type { ReactNode } from 'react';
import { FolderGit2, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';
import { getTaskStatusOption, getPRStatusInfo, getSprintPhaseOption } from '@/lib/session-fields';
import { PRNumberBadge } from '@/components/shared/PRNumberBadge';
import type { WorktreeSession } from '@/lib/types';
import { SPRINT_PHASES } from '@/lib/types';
import type { GitStatusDTO } from '@/lib/api';

interface SessionHoverCardBodyProps {
  session: WorktreeSession;
  formatTimeAgo: (date: string) => string;
  lastAgentCompletedAt?: number;
  actionSlot?: ReactNode;
  gitStatus?: { data: GitStatusDTO | null; loading: boolean };
}

export function SessionHoverCardBody({
  session,
  formatTimeAgo,
  lastAgentCompletedAt,
  actionSlot,
  gitStatus,
}: SessionHoverCardBodyProps) {
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);
  const hasPR = session.prStatus && session.prStatus !== 'none';
  const statusOption = getTaskStatusOption(session.taskStatus);
  const prStatusInfo = getPRStatusInfo(session);
  const sprintPhaseOpt = session.sprintPhase ? getSprintPhaseOption(session.sprintPhase) : null;
  const SprintPhaseIcon = sprintPhaseOpt?.icon;

  return (
    <>
      {/* Header: branch icon + name */}
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
        {session.sessionType === 'base' ? (
          <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        ) : (
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground truncate">
          {session.branch || session.name}
        </span>
        {session.sessionType === 'base' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium shrink-0">Base</span>
        )}
      </div>

      {/* Meta row: status + time */}
      <div className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground flex-wrap">
        {session.sessionType === 'base' ? (
          <>
            {gitStatus?.loading ? (
              <div className="w-20 h-3 rounded bg-muted animate-pulse" />
            ) : gitStatus?.data ? (
              <>
                {gitStatus.data.workingDirectory.hasChanges ? (
                  <span className="text-amber-500">{gitStatus.data.workingDirectory.totalUncommitted} uncommitted</span>
                ) : (
                  <span className="text-text-success">Clean</span>
                )}
                {gitStatus.data.sync.aheadBy > 0 && (
                  <>
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span>{gitStatus.data.sync.aheadBy}&uarr;</span>
                  </>
                )}
                {gitStatus.data.sync.behindBy > 0 && (
                  <>
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span>{gitStatus.data.sync.behindBy}&darr;</span>
                  </>
                )}
                <span className="text-muted-foreground/40">&middot;</span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <TaskStatusIcon status={session.taskStatus} className="h-3 w-3 shrink-0" />
            <span className="shrink-0">{statusOption.label}</span>
            <span className="text-muted-foreground/50">&middot;</span>
          </>
        )}
        <span className="shrink-0">
          {formatTimeAgo(
            lastAgentCompletedAt !== undefined && lastAgentCompletedAt > new Date(session.updatedAt).getTime()
              ? new Date(lastAgentCompletedAt).toISOString()
              : session.updatedAt
          )}
        </span>
      </div>

      {/* Sprint phase — prominent pill with progress */}
      {sprintPhaseOpt && SprintPhaseIcon && (
        <div className="px-3 pb-1.5 flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center gap-1.5 text-xs font-semibold rounded-md px-2 py-1',
            sprintPhaseOpt.activeClass,
          )}>
            <SprintPhaseIcon className="h-3.5 w-3.5" />
            {sprintPhaseOpt.label}
          </span>
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {SPRINT_PHASES.indexOf(sprintPhaseOpt.value) + 1}/{SPRINT_PHASES.length}
          </span>
        </div>
      )}

      {/* PR row */}
      {hasPR && session.prNumber && (
        <div className="border-t border-border/50 px-3 py-2 flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <PRNumberBadge
              prNumber={session.prNumber}
              prStatus={session.prStatus as 'open' | 'merged' | 'closed'}
              checkStatus={session.checkStatus}
              hasMergeConflict={session.hasMergeConflict}
              prUrl={session.prUrl}
            />
            {prStatusInfo && (
              <span className={cn('text-xs', prStatusInfo.color)}>{prStatusInfo.text}</span>
            )}
          </div>
          {session.prTitle && (
            <span className="text-sm font-medium text-foreground line-clamp-3">{session.prTitle}</span>
          )}
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

      {/* Footer: stats + primary action */}
      {(hasStats || actionSlot) && (
        <div className="border-t border-border/50 px-3 py-2 flex items-center gap-2">
          {hasStats && (
            <span className="text-xs font-mono tabular-nums">
              <span className="text-text-success">+{session.stats!.additions}</span>
              <span className="text-text-error ml-1.5">-{session.stats!.deletions}</span>
            </span>
          )}
          {actionSlot && <div className="ml-auto">{actionSlot}</div>}
        </div>
      )}
    </>
  );
}
