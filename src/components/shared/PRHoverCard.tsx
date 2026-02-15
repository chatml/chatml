'use client';

import { GitPullRequest, GitMerge, Check, X, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { PRNumberBadge } from '@/components/shared/PRNumberBadge';
import { usePRStatus } from '@/hooks/usePRStatus';
import { getCheckStatusInfo, formatDuration } from '@/lib/check-utils';
import type { PRDetails, CheckDetail } from '@/lib/api';

interface PRHoverCardProps {
  workspaceId: string;
  sessionId: string;
  prNumber: number;
  prStatus: 'open' | 'merged' | 'closed';
  prUrl?: string;
  size?: 'sm' | 'md';
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'text-text-success',
  merged: 'text-nav-icon-prs',
  closed: 'text-text-error',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  open: 'bg-emerald-500',
  merged: 'bg-purple-500',
  closed: 'bg-red-500',
};

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getMergeStateDisplay(mergeableState: string): { icon: typeof Check; color: string; label: string } {
  switch (mergeableState) {
    case 'clean':
      return { icon: Check, color: 'text-green-500', label: 'Ready to merge' };
    case 'dirty':
      return { icon: X, color: 'text-red-500', label: 'Has conflicts' };
    case 'blocked':
      return { icon: AlertTriangle, color: 'text-yellow-500', label: 'Blocked' };
    case 'unstable':
      return { icon: AlertTriangle, color: 'text-yellow-500', label: 'Unstable' };
    default:
      return { icon: Clock, color: 'text-muted-foreground', label: 'Checking...' };
  }
}

function getCheckCounts(checkDetails: CheckDetail[]) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const check of checkDetails) {
    if (check.status === 'completed') {
      if (check.conclusion === 'success') passed++;
      else if (check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'action_required') failed++;
    } else {
      pending++;
    }
  }
  return { passed, failed, pending, total: checkDetails.length };
}

function LoadingSkeleton() {
  return (
    <div className="p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="h-3 w-16 animate-pulse bg-muted rounded" />
        <div className="h-3 w-10 animate-pulse bg-muted rounded" />
      </div>
      <div className="h-4 w-full animate-pulse bg-muted rounded" />
      <div className="space-y-1.5">
        <div className="h-3 w-full animate-pulse bg-muted rounded" />
        <div className="h-3 w-3/4 animate-pulse bg-muted rounded" />
      </div>
      <div className="h-px bg-border/50" />
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 animate-pulse bg-muted rounded-full" />
        <div className="h-3 w-32 animate-pulse bg-muted rounded" />
      </div>
    </div>
  );
}

function PRHoverCardBody({ details, prStatus }: { details: PRDetails; prStatus: string }) {
  const strippedBody = details.body ? stripMarkdown(details.body) : '';
  const counts = getCheckCounts(details.checkDetails);
  const hasChecks = details.checkDetails.length > 0;
  const isOpen = prStatus === 'open';

  const mergeState = isOpen ? getMergeStateDisplay(details.mergeableState) : null;
  const StatusIcon = details.merged ? GitMerge : GitPullRequest;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={cn('w-2 h-2 rounded-full shrink-0', STATUS_DOT_COLORS[prStatus])} />
          <span className="text-xs font-medium text-foreground">PR #{details.number}</span>
          <span className="text-xs text-muted-foreground/60 mx-0.5">&middot;</span>
          <span className={cn('text-xs font-medium', STATUS_COLORS[prStatus])}>
            {STATUS_LABELS[prStatus] || prStatus}
          </span>
        </div>
        <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', STATUS_COLORS[prStatus])} />
      </div>

      {/* Title */}
      <div className="px-3 pt-2 pb-1">
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
          {details.title}
        </p>
      </div>

      {/* Body preview */}
      {strippedBody && (
        <div className="px-3 pb-2">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {strippedBody}
          </p>
        </div>
      )}

      {/* Info rows */}
      {(hasChecks || mergeState) && (
        <div className="border-t border-border/50">
          {hasChecks && (
            <div className="flex items-center gap-2 px-3 py-1.5">
              {(() => {
                const statusInfo = getCheckStatusInfo(
                  counts.failed > 0 ? 'completed' : counts.pending > 0 ? 'in_progress' : 'completed',
                  counts.failed > 0 ? 'failure' : 'success',
                );
                const Icon = statusInfo.icon;
                return <Icon className={cn('h-3.5 w-3.5 shrink-0', statusInfo.color)} />;
              })()}
              <span className="text-xs text-muted-foreground">
                {counts.passed} passed
                {counts.failed > 0 && <span className="text-red-500">, {counts.failed} failed</span>}
                {counts.pending > 0 && `, ${counts.pending} pending`}
              </span>
            </div>
          )}

          {mergeState && (
            <div className="flex items-center gap-2 px-3 py-1.5">
              <mergeState.icon className={cn('h-3.5 w-3.5 shrink-0', mergeState.color)} />
              <span className="text-xs text-muted-foreground">{mergeState.label}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function PRHoverCard({
  workspaceId,
  sessionId,
  prNumber,
  prStatus,
  prUrl,
  size,
}: PRHoverCardProps) {
  const { prDetails, loading, error } = usePRStatus(workspaceId, sessionId, prStatus);

  // If there's an error fetching details, just render the badge without hover
  if (error) {
    return (
      <PRNumberBadge
        prNumber={prNumber}
        prStatus={prStatus}
        prUrl={prUrl}
        size={size}
      />
    );
  }

  return (
    <HoverCard openDelay={500} closeDelay={150}>
      <HoverCardTrigger asChild>
        <span>
          <PRNumberBadge
            prNumber={prNumber}
            prStatus={prStatus}
            prUrl={prUrl}
            size={size}
          />
        </span>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0">
        {loading || !prDetails ? (
          <LoadingSkeleton />
        ) : (
          <PRHoverCardBody details={prDetails} prStatus={prStatus} />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
