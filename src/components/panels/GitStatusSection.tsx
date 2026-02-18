'use client';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Check,
  Circle,
  AlertTriangle,
  XCircle,
  FolderX,
  Loader2,
  RefreshCw,
  ChevronDown,
  GitBranch,
  GitMerge,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorCode, type GitStatusDTO } from '@/lib/api';

interface DropdownAction {
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}

interface GitStatusItemProps {
  type: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  dropdownActions?: DropdownAction[];
}

function GitStatusItem({ type, message, action, dropdownActions }: GitStatusItemProps) {
  const Icon = {
    success: Check,
    warning: AlertTriangle,
    error: XCircle,
    info: Circle,
    neutral: Circle,
  }[type];

  const iconColor = {
    success: 'text-text-success',
    warning: 'text-text-warning',
    error: 'text-text-error',
    info: 'text-text-info',
    neutral: 'text-muted-foreground',
  }[type];

  return (
    <div className="flex items-center gap-2 py-1 px-2 group min-w-0">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', iconColor)} />
      <span className="text-xs flex-1 min-w-0 truncate" title={message}>{message}</span>
      {action && dropdownActions ? (
        <div className="inline-flex rounded-sm shadow-sm">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2 rounded-r-none rounded-l-sm border-r-0 transition-none"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l border-l-border"
              >
                <ChevronDown className="size-2.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              {dropdownActions.map((da) => (
                <button
                  key={da.label}
                  className="w-full text-left rounded-md px-3 py-2.5 hover:bg-accent transition-colors"
                  onClick={da.onClick}
                >
                  <div className="flex items-start gap-3">
                    <da.icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium">{da.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{da.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      ) : action ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

function buildStatusItems(
  status: GitStatusDTO,
  sendMessage: (content: string) => void
): GitStatusItemProps[] {
  const items: GitStatusItemProps[] = [];

  // Priority 1: Blocking states (conflicts, in-progress operations)
  if (status.conflicts.hasConflicts) {
    items.push({
      type: 'error',
      message: `${status.conflicts.count} merge conflict${status.conflicts.count !== 1 ? 's' : ''}`,
      action: {
        label: 'Resolve',
        onClick: () => sendMessage('Resolve the merge conflicts'),
      },
    });
  }

  if (status.inProgress.type !== 'none') {
    const progress = status.inProgress.current && status.inProgress.total
      ? ` (${status.inProgress.current}/${status.inProgress.total})`
      : '';
    const operationType = status.inProgress.type.charAt(0).toUpperCase() + status.inProgress.type.slice(1);

    items.push({
      type: 'warning',
      message: `${operationType} in progress${progress}`,
      action: {
        label: 'Continue',
        onClick: () => sendMessage(`Continue the ${status.inProgress.type}`),
      },
      dropdownActions: [
        {
          icon: RefreshCw,
          label: `Continue ${operationType}`,
          description: `Resume the ${status.inProgress.type} from where it left off`,
          onClick: () => sendMessage(`Continue the ${status.inProgress.type}`),
        },
        {
          icon: XCircle,
          label: `Abort ${operationType}`,
          description: `Cancel the ${status.inProgress.type} and restore previous state`,
          onClick: () => sendMessage(`Abort the ${status.inProgress.type}`),
        },
      ],
    });
  }

  // Priority 2: Working directory status
  const { stagedCount, unstagedCount, untrackedCount, hasChanges } = status.workingDirectory;

  if (stagedCount > 0 && unstagedCount === 0 && untrackedCount === 0) {
    // Only staged changes
    items.push({
      type: 'info',
      message: `${stagedCount} change${stagedCount !== 1 ? 's' : ''} staged`,
      action: {
        label: 'Commit',
        onClick: () => sendMessage('Commit my staged changes'),
      },
    });
  } else if (hasChanges) {
    // Mixed or only unstaged changes
    const totalUncommitted = stagedCount + unstagedCount + untrackedCount;
    items.push({
      type: 'neutral',
      message: `${totalUncommitted} uncommitted change${totalUncommitted !== 1 ? 's' : ''}`,
      action: {
        label: 'Commit and push',
        onClick: () => sendMessage('Commit and push my changes'),
      },
    });

    // Show detailed breakdown if there's a mix
    if (stagedCount > 0 && (unstagedCount > 0 || untrackedCount > 0)) {
      items.push({
        type: 'info',
        message: `${stagedCount} staged`,
        action: undefined,
      });
    }

    if (unstagedCount > 0) {
      items.push({
        type: 'neutral',
        message: `${unstagedCount} unstaged change${unstagedCount !== 1 ? 's' : ''}`,
        action: {
          label: 'Stage all',
          onClick: () => sendMessage('Stage all changes'),
        },
      });
    }

    if (untrackedCount > 0) {
      items.push({
        type: 'neutral',
        message: `${untrackedCount} untracked file${untrackedCount !== 1 ? 's' : ''}`,
        action: {
          label: 'Add to git',
          onClick: () => sendMessage('Add untracked files to git'),
        },
      });
    }
  } else {
    // Clean working tree
    items.push({
      type: 'success',
      message: 'Working tree clean',
    });
  }

  // Priority 3: Sync status
  const { aheadBy, behindBy, diverged, baseBranch, unpushedCommits } = status.sync;

  if (diverged) {
    items.push({
      type: 'warning',
      message: `${aheadBy} ahead, ${behindBy} behind ${baseBranch}`,
      action: {
        label: 'Rebase',
        onClick: () => sendMessage(`Rebase my branch on ${baseBranch}`),
      },
      dropdownActions: [
        {
          icon: GitBranch,
          label: 'Rebase',
          description: `Replay your commits on top of ${baseBranch} for a linear history`,
          onClick: () => sendMessage(`Rebase my branch on ${baseBranch}`),
        },
        {
          icon: GitMerge,
          label: 'Merge',
          description: `Merge ${baseBranch} into your branch with a merge commit`,
          onClick: () => sendMessage(`Merge ${baseBranch} into my branch`),
        },
      ],
    });
  } else if (behindBy > 0) {
    items.push({
      type: 'neutral',
      message: `${behindBy} commit${behindBy !== 1 ? 's' : ''} behind ${baseBranch}`,
      action: {
        label: 'Rebase',
        onClick: () => sendMessage(`Rebase my branch on ${baseBranch}`),
      },
      dropdownActions: [
        {
          icon: GitBranch,
          label: 'Rebase',
          description: `Replay your commits on top of ${baseBranch} for a linear history`,
          onClick: () => sendMessage(`Rebase my branch on ${baseBranch}`),
        },
        {
          icon: GitMerge,
          label: 'Merge',
          description: `Merge ${baseBranch} into your branch with a merge commit`,
          onClick: () => sendMessage(`Merge ${baseBranch} into my branch`),
        },
      ],
    });
  } else if (unpushedCommits > 0) {
    items.push({
      type: 'info',
      message: `${unpushedCommits} commit${unpushedCommits !== 1 ? 's' : ''} ahead`,
      action: {
        label: 'Push',
        onClick: () => sendMessage('Push my commits'),
      },
    });
  } else if (aheadBy === 0 && behindBy === 0 && !hasChanges) {
    items.push({
      type: 'success',
      message: `Up to date with ${baseBranch}`,
    });
  }

  return items;
}

interface GitStatusSectionProps {
  onSendMessage?: (content: string) => void;
  status: GitStatusDTO | null;
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  onRefresh: () => void;
}

export function GitStatusSection({ onSendMessage, status, loading, error, errorCode, onRefresh }: GitStatusSectionProps) {
  // Wrapper that handles missing callback
  const sendMessage = (content: string) => {
    if (!onSendMessage) {
      console.warn('No onSendMessage callback provided, cannot send git action message');
      return;
    }
    onSendMessage(content);
  };

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 py-2 px-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (error) {
    if (errorCode === ErrorCode.WORKTREE_NOT_FOUND) {
      return (
        <div className="flex flex-col items-center gap-2 p-4">
          <FolderX className="h-5 w-5 text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center">
            Worktree directory no longer exists
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-2 p-4">
        <XCircle className="h-5 w-5 text-text-error" />
        <p className="text-xs text-muted-foreground text-center">{error}</p>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-2">
        <p className="text-xs text-muted-foreground">No session selected</p>
      </div>
    );
  }

  const items = buildStatusItems(status, sendMessage);

  return (
    <div>
      {items.map((item) => (
        <GitStatusItem key={`${item.type}-${item.message}`} {...item} />
      ))}
    </div>
  );
}
