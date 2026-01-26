'use client';

import { useState } from 'react';
import { type PRDashboardItem } from '@/lib/api';
import { CheckList } from './CheckList';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  GitPullRequest,
  GitPullRequestDraft,
  GitBranch,
  Github,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Clock,
  AlertTriangle,
  ArrowRight,
  GitMerge,
  Wrench,
  Loader2,
} from 'lucide-react';

function BranchBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-xs font-mono text-purple-300/70">
      <GitBranch className="h-3 w-3" />
      <span className="truncate max-w-[300px]">{name}</span>
    </span>
  );
}

async function openInBrowser(url: string) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank');
  }
}

interface PRCardProps {
  pr: PRDashboardItem;
  onJumpToSession?: () => void;
  onSendMessage?: (message: string) => void;
  isSendingMessage?: boolean;
}

export function PRCard({ pr, onJumpToSession, onSendMessage, isSendingMessage }: PRCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasChecks = pr.checksTotal > 0;
  const hasFailures = pr.checksFailed > 0;
  // Compute pending from counts rather than relying on checkStatus string
  const pendingCount = pr.checksTotal - pr.checksPassed - pr.checksFailed;
  const hasPending = pendingCount > 0;
  const allPassed = hasChecks && !hasFailures && !hasPending;
  const hasConflicts = pr.mergeableState === 'dirty' || pr.mergeable === false;

  // Determine status icon and color based on check status and conflicts
  const getStatusInfo = () => {
    if (pr.isDraft) {
      return {
        icon: GitPullRequestDraft,
        color: 'text-muted-foreground',
        label: 'Draft',
      };
    }
    // Conflicts take priority - show warning triangle
    if (hasConflicts) {
      return {
        icon: AlertTriangle,
        color: 'text-yellow-500',
        label: 'Conflicts',
      };
    }
    // Color based on check status
    let color = 'text-green-500'; // Default: all passed or no checks
    if (hasFailures) {
      color = 'text-red-500';
    } else if (hasPending) {
      color = 'text-yellow-500';
    }
    return {
      icon: GitPullRequest,
      color,
      label: 'Open',
    };
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  // Check status summary
  const getCheckSummary = () => {
    if (!hasChecks) {
      return { icon: null, text: 'No checks', color: 'text-muted-foreground' };
    }
    if (hasFailures) {
      return {
        icon: X,
        text: `${pr.checksPassed}/${pr.checksTotal} checks passed`,
        color: 'text-red-500',
      };
    }
    if (hasPending) {
      return {
        icon: Clock,
        text: `${pr.checksPassed}/${pr.checksTotal} checks pending`,
        color: 'text-yellow-500',
      };
    }
    return {
      icon: Check,
      text: `${pr.checksTotal}/${pr.checksTotal} checks passed`,
      color: 'text-green-500',
    };
  };

  const checkSummary = getCheckSummary();
  const CheckIcon = checkSummary.icon;

  // Determine primary action based on PR state
  const getPrimaryAction = () => {
    // Draft PRs - no action for now
    if (pr.isDraft) {
      return null;
    }
    // Conflicts take priority
    if (hasConflicts) {
      return {
        label: 'Resolve Conflicts',
        message: 'Please resolve the merge conflicts in this PR.',
        icon: AlertTriangle,
        variant: 'warning' as const,
      };
    }
    // Failed checks
    if (hasFailures) {
      return {
        label: 'Fix Failures',
        message: 'Please fix the failing CI checks in this PR.',
        icon: Wrench,
        variant: 'warning' as const,
      };
    }
    // Pending checks - no action, just wait
    if (hasPending) {
      return null;
    }
    // All passed, no conflicts - ready to merge
    if (allPassed || !hasChecks) {
      return {
        label: 'Merge PR',
        message: 'Please merge this PR.',
        icon: GitMerge,
        variant: 'success' as const,
      };
    }
    return null;
  };

  const primaryAction = getPrimaryAction();

  const handleActionClick = () => {
    if (!primaryAction) return;

    if (onSendMessage) {
      // Has a session - send message to agent
      onSendMessage(primaryAction.message);
    } else {
      // No session - open GitHub
      openInBrowser(pr.htmlUrl);
    }
  };

  return (
    <div className="border rounded-lg bg-card hover:bg-surface-1 transition-colors">
      <div className="p-3">
        {/* First row: Status icon, title, PR number, session name */}
        <div className="flex items-start gap-2">
          <StatusIcon className={cn('h-4 w-4 mt-0.5 shrink-0', statusInfo.color)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-base truncate">{pr.title}</span>
              <span className="text-sm text-muted-foreground shrink-0">#{pr.number}</span>
              {pr.sessionName && (
                <span className="text-xs bg-surface-2 px-1.5 py-0.5 rounded shrink-0">
                  {pr.sessionName}
                </span>
              )}
            </div>

            {/* Second row: Branch info, conflicts indicator */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
              <BranchBadge name={pr.branch} />
              <ArrowRight className="h-3 w-3 shrink-0" />
              <BranchBadge name={pr.baseBranch} />
              {hasConflicts && (
                <span className="flex items-center gap-1 text-yellow-500 shrink-0">
                  <AlertTriangle className="h-3 w-3" />
                  Conflicts
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {onJumpToSession && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onJumpToSession}
              >
                Go to Session
              </Button>
            )}
            {primaryAction && (
              <Button
                variant={primaryAction.variant}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleActionClick}
                disabled={isSendingMessage}
              >
                {isSendingMessage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <primaryAction.icon className="h-3.5 w-3.5" />
                )}
                {primaryAction.label}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs !bg-surface-2 hover:!bg-surface-3 active:!bg-surface-4 active:scale-95 transition-all"
                  onClick={() => openInBrowser(pr.htmlUrl)}
                >
                  <Github className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in GitHub</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Third row: Check status (expandable) */}
        {hasChecks && (
          <div className="mt-2">
            <button
              className="flex items-center gap-2 text-xs hover:bg-surface-1 rounded px-1 py-0.5 -ml-1"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
              {CheckIcon && <CheckIcon className={cn('h-3 w-3', checkSummary.color)} />}
              <span className={checkSummary.color}>{checkSummary.text}</span>
            </button>
          </div>
        )}
      </div>

      {/* Expanded check list */}
      {expanded && hasChecks && (
        <div className="border-t px-3 py-2">
          <CheckList checks={pr.checkDetails} />
        </div>
      )}
    </div>
  );
}
