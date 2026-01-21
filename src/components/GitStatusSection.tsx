'use client';

import { useGitStatus } from '@/hooks/useGitStatus';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Check,
  Circle,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GitStatusDTO } from '@/lib/api';

interface GitStatusItemProps {
  type: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

function GitStatusItem({ type, message, action, secondaryAction }: GitStatusItemProps) {
  const Icon = {
    success: Check,
    warning: AlertTriangle,
    error: XCircle,
    info: Circle,
    neutral: Circle,
  }[type];

  const iconColor = {
    success: 'text-green-500',
    warning: 'text-orange-500',
    error: 'text-red-500',
    info: 'text-blue-500',
    neutral: 'text-muted-foreground',
  }[type];

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 group">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', iconColor)} />
      <span className="text-xs flex-1 min-w-0 truncate">{message}</span>
      {action && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
      {secondaryAction && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={secondaryAction.onClick}
        >
          {secondaryAction.label}
        </Button>
      )}
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
      secondaryAction: {
        label: 'Abort',
        onClick: () => sendMessage(`Abort the ${status.inProgress.type}`),
      },
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
    });
  } else if (behindBy > 0) {
    items.push({
      type: 'neutral',
      message: `${behindBy} commit${behindBy !== 1 ? 's' : ''} behind ${baseBranch}`,
      action: {
        label: 'Rebase',
        onClick: () => sendMessage(`Rebase my branch on ${baseBranch}`),
      },
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

  // Priority 4: Stash
  if (status.stash.count > 0) {
    items.push({
      type: 'neutral',
      message: `${status.stash.count} stashed change${status.stash.count !== 1 ? 's' : ''}`,
      action: {
        label: 'Apply',
        onClick: () => sendMessage('Apply the latest stash'),
      },
      secondaryAction: {
        label: 'Pop',
        onClick: () => sendMessage('Pop the latest stash'),
      },
    });
  }

  return items;
}

interface GitStatusSectionProps {
  onSendMessage?: (content: string) => void;
}

export function GitStatusSection({ onSendMessage }: GitStatusSectionProps) {
  const { selectedWorkspaceId, selectedSessionId } = useAppStore();
  const { status, loading, error, refetch } = useGitStatus(selectedWorkspaceId, selectedSessionId);

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
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-4">
        <XCircle className="h-5 w-5 text-red-500" />
        <p className="text-xs text-muted-foreground text-center">{error}</p>
        <Button variant="ghost" size="sm" onClick={refetch}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No session selected</p>
      </div>
    );
  }

  const items = buildStatusItems(status, sendMessage);

  return (
    <ScrollArea className="h-full">
      <div>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-medium text-purple-500">Git status</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={refetch}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
        {items.map((item) => (
          <GitStatusItem key={`${item.type}-${item.message}`} {...item} />
        ))}
      </div>
    </ScrollArea>
  );
}
