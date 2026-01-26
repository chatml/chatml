'use client';

import { useState } from 'react';
import { type PRDashboardItem } from '@/lib/api';
import { CheckList } from './CheckList';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  GitPullRequest,
  GitPullRequestDraft,
  Github,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Clock,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';

interface PRCardProps {
  pr: PRDashboardItem;
  onJumpToSession?: () => void;
}

export function PRCard({ pr, onJumpToSession }: PRCardProps) {
  const [expanded, setExpanded] = useState(false);

  const hasChecks = pr.checksTotal > 0;
  const hasFailures = pr.checksFailed > 0;
  // Compute pending from counts rather than relying on checkStatus string
  const pendingCount = pr.checksTotal - pr.checksPassed - pr.checksFailed;
  const hasPending = pendingCount > 0;
  const allPassed = hasChecks && !hasFailures && !hasPending;
  const hasConflicts = pr.mergeableState === 'dirty' || pr.mergeable === false;

  // Determine status icon and color
  // Note: Backend currently only returns open PRs
  const getStatusInfo = () => {
    if (pr.isDraft) {
      return {
        icon: GitPullRequestDraft,
        color: 'text-muted-foreground',
        label: 'Draft',
      };
    }
    return {
      icon: GitPullRequest,
      color: 'text-green-500',
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

  return (
    <div className="border rounded-lg bg-card hover:bg-surface-1 transition-colors">
      <div className="p-3">
        {/* First row: Status icon, title, PR number, session name */}
        <div className="flex items-start gap-2">
          <StatusIcon className={cn('h-4 w-4 mt-0.5 shrink-0', statusInfo.color)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{pr.title}</span>
              <span className="text-xs text-muted-foreground shrink-0">#{pr.number}</span>
              {pr.sessionName && (
                <span className="text-xs bg-surface-2 px-1.5 py-0.5 rounded shrink-0">
                  {pr.sessionName}
                </span>
              )}
            </div>

            {/* Second row: Branch info, conflicts indicator */}
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="truncate">
                {pr.branch} <ArrowRight className="h-3 w-3 inline" /> {pr.baseBranch}
              </span>
              {hasConflicts && (
                <span className="flex items-center gap-1 text-yellow-500 shrink-0">
                  <AlertTriangle className="h-3 w-3" />
                  Conflicts
                </span>
              )}
              {pr.workspaceName && (
                <span className="shrink-0">{pr.workspaceName}</span>
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open(pr.htmlUrl, '_blank')}
            >
              Open in
              <Github className="h-3 w-3 ml-1" />
            </Button>
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
