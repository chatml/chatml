'use client';

import type { WorktreeSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  Check,
  X,
  Clock,
  AlertTriangle,
  Plus,
  Minus,
} from 'lucide-react';
import { getPriorityOption } from '@/lib/session-fields';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';

interface SessionCardProps {
  session: WorktreeSession;
  onJumpToSession: () => void;
}

export function SessionCard({ session, onJumpToSession }: SessionCardProps) {
  const hasChanges = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);
  const hasPR = session.prStatus === 'open' && session.prUrl;

  // Status indicator colors
  const statusColors: Record<string, string> = {
    active: 'bg-green-500',
    idle: 'bg-yellow-500',
    done: 'bg-muted-foreground',
    error: 'bg-red-500',
  };

  // Status labels
  const statusLabels: Record<string, string> = {
    active: 'Active',
    idle: 'Idle',
    done: 'Done',
    error: 'Error',
  };

  // PR check status info
  const getPRStatusInfo = () => {
    if (!hasPR) return null;

    if (session.hasCheckFailures) {
      return {
        icon: X,
        text: 'Checks failing',
        color: 'text-red-500',
      };
    }

    if (session.hasMergeConflict) {
      return {
        icon: AlertTriangle,
        text: 'Merge conflict',
        color: 'text-yellow-500',
      };
    }

    // Default: checks passing
    return {
      icon: Check,
      text: 'Checks passing',
      color: 'text-green-500',
    };
  };

  const prStatus = getPRStatusInfo();
  const priorityOpt = session.priority > 0 ? getPriorityOption(session.priority) : null;
  const PriorityIcon = priorityOpt?.icon;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onJumpToSession();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'group border rounded-lg bg-card cursor-pointer transition-colors hover:bg-surface-1',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        session.status === 'error' && 'border-red-500/30'
      )}
      onClick={onJumpToSession}
      onKeyDown={handleKeyDown}
    >
      <div className="p-3">
        {/* First row: Status dot, branch name, pinned indicator, task description */}
        <div className="flex items-start gap-2">
          {/* Status indicator */}
          <div className="flex items-center gap-1.5 mt-1 shrink-0">
            <div
              className={cn('h-2 w-2 rounded-full', statusColors[session.status])}
              title={statusLabels[session.status]}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <TaskStatusIcon status={session.taskStatus} className="h-3.5 w-3.5 shrink-0" />
              {PriorityIcon && priorityOpt && (
                <PriorityIcon className={cn('h-3.5 w-3.5 shrink-0', priorityOpt.color)} />
              )}
              <span className="font-medium text-sm truncate">{session.branch}</span>
              {hasChanges && (
                <span className="flex items-center gap-1 text-xs shrink-0">
                  <span className="text-green-500 flex items-center">
                    <Plus className="h-3 w-3" />
                    {session.stats!.additions}
                  </span>
                  <span className="text-red-500 flex items-center">
                    <Minus className="h-3 w-3" />
                    {session.stats!.deletions}
                  </span>
                </span>
              )}
            </div>

            {/* Task description */}
            {session.task && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {session.task}
              </p>
            )}

            {/* PR info row */}
            {hasPR && (
              <div className="flex items-center gap-2 mt-1.5 text-xs">
                <span className="text-muted-foreground">
                  PR #{session.prNumber}
                </span>
                {prStatus && (
                  <span className={cn('flex items-center gap-1', prStatus.color)}>
                    <prStatus.icon className="h-3 w-3" />
                    {prStatus.text}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {hasPR && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(session.prUrl, '_blank');
                }}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                PR
              </Button>
            )}
          </div>
        </div>

        {/* Alert indicators (merge conflict or check failures) */}
        {(session.hasMergeConflict || session.hasCheckFailures || session.status === 'error') && (
          <div className="flex items-center gap-2 mt-2 text-xs">
            {session.status === 'error' && (
              <span className="flex items-center gap-1 text-red-500">
                <Clock className="h-3 w-3" />
                Session error
              </span>
            )}
            {session.hasMergeConflict && (
              <span className="flex items-center gap-1 text-yellow-500">
                <AlertTriangle className="h-3 w-3" />
                Merge conflict
              </span>
            )}
            {session.hasCheckFailures && !session.hasMergeConflict && (
              <span className="flex items-center gap-1 text-red-500">
                <X className="h-3 w-3" />
                CI checks failing
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
