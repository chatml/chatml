'use client';

import { useState, useMemo, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { useSelectedIds } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { usePRStatus } from '@/hooks/usePRStatus';
import { useCIRuns } from '@/hooks/useCIRuns';
import { useGitStatus } from '@/hooks/useGitStatus';
import { getCheckStatusInfo, formatDuration, computeJobDuration } from '@/lib/check-utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { CIFailureAnalysis } from '@/components/ci/CIFailureAnalysis';
import { GitStatusSection } from '@/components/panels/GitStatusSection';
import {
  type CheckDetail,
  type PRDetails,
  type GitStatusDTO,
  type WorkflowRunDTO,
  type WorkflowJobDTO,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { openUrlInBrowser } from '@/lib/tauri';
import {
  X,
  AlertTriangle,
  Info,
  ExternalLink,
  RefreshCw,
  ChevronRight,
  CircleDot,
  Loader2,
  RotateCcw,
  Sparkles,
  GitBranch,
  GitPullRequest,
  GitMerge,
  ShieldCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChecksPanelProps {
  onSendMessage?: (content: string) => void;
  onPrUrlChange?: (url: string | null) => void;
  active?: boolean;
}

export interface ChecksPanelHandle {
  refreshAll: () => void;
}

interface BlockingItem {
  type: 'ci-failure' | 'conflict' | 'behind-base' | 'not-mergeable' | 'in-progress-op' | 'review-required' | 'changes-requested';
  label: string;
  severity: 'error' | 'warning';
}

interface MergeReadiness {
  ready: boolean;
  blockers: BlockingItem[];
  pendingCount: number;
  hasNoPR: boolean;
}

// ---------------------------------------------------------------------------
// Merge readiness computation
// ---------------------------------------------------------------------------

function computeMergeReadiness(
  pr: PRDetails | null,
  gitStatus: GitStatusDTO | null,
  checkDetails: CheckDetail[],
): MergeReadiness {
  const blockers: BlockingItem[] = [];
  let pendingCount = 0;

  // No PR
  if (!pr) {
    return { ready: false, blockers: [], pendingCount: 0, hasNoPR: true };
  }

  // CI failures
  const failedChecks = checkDetails.filter(
    (c) => c.status === 'completed' && (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')
  );
  if (failedChecks.length > 0) {
    blockers.push({
      type: 'ci-failure',
      label: `${failedChecks.length} CI check${failedChecks.length !== 1 ? 's' : ''} failing`,
      severity: 'error',
    });
  }

  // Pending CI
  pendingCount = checkDetails.filter(
    (c) => c.status === 'in_progress' || c.status === 'queued' || c.status === 'pending'
  ).length;

  // Merge conflicts
  if (gitStatus?.conflicts.hasConflicts) {
    blockers.push({
      type: 'conflict',
      label: `${gitStatus.conflicts.count} merge conflict${gitStatus.conflicts.count !== 1 ? 's' : ''}`,
      severity: 'error',
    });
  }

  // In-progress git operation
  if (gitStatus?.inProgress.type !== 'none' && gitStatus?.inProgress.type) {
    blockers.push({
      type: 'in-progress-op',
      label: `${gitStatus.inProgress.type} in progress`,
      severity: 'warning',
    });
  }

  // Behind base branch
  if (gitStatus?.sync.behindBy && gitStatus.sync.behindBy > 0) {
    blockers.push({
      type: 'behind-base',
      label: `${gitStatus.sync.behindBy} commit${gitStatus.sync.behindBy !== 1 ? 's' : ''} behind ${gitStatus.sync.baseBranch}`,
      severity: 'warning',
    });
  }

  // GitHub says not mergeable
  if (pr.mergeableState === 'dirty') {
    if (!blockers.some((b) => b.type === 'conflict')) {
      blockers.push({ type: 'conflict', label: 'PR has conflicts', severity: 'error' });
    }
  } else if (pr.mergeableState === 'blocked') {
    // Show specific reasons for the block
    if (pr.reviewDecision === 'changes_requested') {
      blockers.push({
        type: 'changes-requested',
        label: 'Changes requested by reviewer',
        severity: 'error',
      });
    } else if (pr.reviewDecision === 'review_required' || (pr.reviewDecision === 'none' && pr.requestedReviewers > 0)) {
      blockers.push({
        type: 'review-required',
        label: pr.requestedReviewers > 0
          ? `Review required (${pr.requestedReviewers} pending)`
          : 'Review required',
        severity: 'error',
      });
    }
    // Fallback: if blocked but no specific reason identified
    if (!blockers.some((b) =>
      b.type === 'ci-failure' || b.type === 'conflict' ||
      b.type === 'review-required' || b.type === 'changes-requested'
    )) {
      blockers.push({
        type: 'not-mergeable',
        label: 'Blocked by branch protection',
        severity: 'error',
      });
    }
  }

  const ready = blockers.length === 0 && pendingCount === 0;

  return { ready, blockers, pendingCount, hasNoPR: false };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ChecksPanel = forwardRef<ChecksPanelHandle, ChecksPanelProps>(function ChecksPanel({ onSendMessage, onPrUrlChange, active = true }, ref) {
  const { selectedWorkspaceId, selectedSessionId } = useSelectedIds();

  // Get session's prStatus from store to pass to usePRStatus hook
  const session = useAppStore((s) => {
    if (!selectedSessionId) return null;
    return s.sessions.find((sess) => sess.id === selectedSessionId) ?? null;
  });
  const prStatus = session?.prStatus;
  const updateSession = useAppStore((s) => s.updateSession);

  // Data hooks
  const { prDetails, loading: prLoading, refetch: refetchPR } = usePRStatus(
    selectedWorkspaceId,
    selectedSessionId,
    prStatus,
    active
  );
  const {
    runs,
    loading: ciLoading,
    refetch: refetchCI,
    getJobs,
    rerunWorkflow,
    analyzeFailure,
  } = useCIRuns(selectedWorkspaceId, selectedSessionId, active);
  const { status: gitStatus, loading: gitLoading, error: gitError, errorCode: gitErrorCode, refetch: refetchGit } = useGitStatus(
    selectedWorkspaceId,
    selectedSessionId,
    active
  );

  // Compute merge readiness
  const checkDetails = useMemo(() => prDetails?.checkDetails ?? [], [prDetails]);
  const readiness = useMemo(
    () => computeMergeReadiness(prDetails, gitStatus, checkDetails),
    [prDetails, gitStatus, checkDetails]
  );

  const isLoading = prLoading || ciLoading || gitLoading;

  const handleRefreshAll = useCallback(() => {
    refetchPR();
    refetchCI();
    refetchGit();
  }, [refetchPR, refetchCI, refetchGit]);

  useImperativeHandle(ref, () => ({
    refreshAll: handleRefreshAll,
  }), [handleRefreshAll]);

  // Notify parent of PR URL changes
  useEffect(() => {
    onPrUrlChange?.(prDetails?.htmlUrl ?? null);
  }, [prDetails?.htmlUrl, onPrUrlChange]);

  // Sync fresh PR/check data back to the session store so sidebar/toolbar
  // badges reflect the latest state without waiting for WebSocket polling.
  useEffect(() => {
    if (!selectedSessionId || !session || !prDetails) return;
    if (!session.prNumber || prDetails.number !== session.prNumber) return;

    const updates: Record<string, unknown> = {};

    // Sync prStatus (merged/closed)
    if (prDetails.merged && session.prStatus !== 'merged') {
      updates.prStatus = 'merged';
    } else if (prDetails.state === 'closed' && !prDetails.merged && session.prStatus !== 'closed') {
      updates.prStatus = 'closed';
    }

    // Sync checkStatus
    if (prDetails.checkStatus && prDetails.checkStatus !== session.checkStatus) {
      updates.checkStatus = prDetails.checkStatus;
    }

    // Sync hasCheckFailures from detailed check data
    const hasFailures = checkDetails.some(
      (c) => c.status === 'completed' && (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')
    );
    if (session.hasCheckFailures !== hasFailures) {
      updates.hasCheckFailures = hasFailures;
    }

    // Sync hasMergeConflict from PR mergeable state (GitHub API), not local git status.
    // prDetails.mergeable === false means GitHub considers the PR to have conflicts.
    // null means GitHub hasn't computed it yet — don't update in that case.
    if (prDetails.mergeable !== null) {
      const hasMergeConflict = !prDetails.mergeable;
      if (session.hasMergeConflict !== hasMergeConflict) {
        updates.hasMergeConflict = hasMergeConflict;
      }
    }

    if (Object.keys(updates).length > 0) {
      updateSession(selectedSessionId, updates);
    }
  }, [selectedSessionId, session, prDetails, checkDetails, updateSession]);

  if (!selectedWorkspaceId || !selectedSessionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No session selected</p>
      </div>
    );
  }

  const branchName = session?.branch;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col min-w-0">
        {/* Merge Readiness Banner - only when PR exists */}
        {!readiness.hasNoPR && (
          <MergeReadinessBanner
            readiness={readiness}
            prStatus={prStatus}
            isLoading={isLoading}
            onRefresh={handleRefreshAll}
          />
        )}

        {/* PR Header - only when PR exists */}
        {(prDetails || prStatus === 'open') && (
          <PRHeaderSection pr={prDetails} prStatus={prStatus} />
        )}

        {/* Git Status - first section */}
        <div className="border-b">
          <div className="flex items-center px-3 py-2">
            <span className="text-2xs font-medium text-foreground/60 uppercase tracking-wider flex-1">
              Git Status
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={refetchGit}
              disabled={gitLoading}
            >
              <RefreshCw className={cn('h-3 w-3', gitLoading && 'animate-spin')} />
            </Button>
          </div>
          <div className="px-1.5 pb-2">
            {/* Branch name */}
            {branchName && (
              <div className="flex items-center gap-2 py-1 px-2 min-w-0">
                <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs truncate flex-1">{branchName}</span>
              </div>
            )}
            {/* "No pull request" line item with Create PR action */}
            {readiness.hasNoPR && !prLoading && (
              <div className="flex items-center gap-2 py-1 px-2 min-w-0">
                <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs flex-1 text-muted-foreground">No pull request</span>
                {onSendMessage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => onSendMessage('Create a pull request')}
                  >
                    Create PR
                  </Button>
                )}
              </div>
            )}
            <GitStatusSection
              onSendMessage={onSendMessage}
              status={gitStatus}
              loading={gitLoading}
              error={gitError}
              errorCode={gitErrorCode}
              onRefresh={refetchGit}
              hasMergeConflict={session?.hasMergeConflict}
            />
          </div>
        </div>

        {/* CI Checks - second section */}
        <CIChecksSection
          checkDetails={checkDetails}
          runs={runs}
          workspaceId={selectedWorkspaceId}
          sessionId={selectedSessionId}
          hasNoPR={readiness.hasNoPR && !prLoading}
          onGetJobs={getJobs}
          onRerun={rerunWorkflow}
          onAnalyzeFailure={analyzeFailure}
        />
      </div>
    </ScrollArea>
  );
});

// ---------------------------------------------------------------------------
// MergeReadinessBanner
// ---------------------------------------------------------------------------

function MergeReadinessBanner({
  readiness,
  prStatus,
  isLoading,
  onRefresh,
}: {
  readiness: MergeReadiness;
  prStatus: string | undefined;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const { ready, blockers, pendingCount } = readiness;

  let bgClass: string;
  let borderClass: string;
  let icon: React.ReactNode;
  let message: string;

  if (prStatus === 'merged') {
    bgClass = 'bg-violet-500/8';
    borderClass = 'border-violet-500/20';
    icon = <GitMerge className="h-3.5 w-3.5 text-violet-500 shrink-0" />;
    message = 'Merged';
  } else if (prStatus === 'closed') {
    bgClass = 'bg-muted/50';
    borderClass = 'border-border';
    icon = <GitPullRequest className="h-3.5 w-3.5 text-red-400 shrink-0" />;
    message = 'PR closed';
  } else if (blockers.some((b) => b.severity === 'error')) {
    const errorCount = blockers.filter((b) => b.severity === 'error').length;
    bgClass = 'bg-red-500/8';
    borderClass = 'border-red-500/20';
    icon = <X className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    message = `${errorCount} item${errorCount !== 1 ? 's' : ''} blocking merge`;
  } else if (pendingCount > 0) {
    bgClass = 'bg-yellow-500/8';
    borderClass = 'border-yellow-500/20';
    icon = <CircleDot className="h-3.5 w-3.5 text-yellow-500 animate-pulse shrink-0" />;
    message = `${pendingCount} check${pendingCount !== 1 ? 's' : ''} running`;
  } else if (blockers.some((b) => b.severity === 'warning')) {
    bgClass = 'bg-yellow-500/8';
    borderClass = 'border-yellow-500/20';
    icon = <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />;
    const warnCount = blockers.length;
    message = `${warnCount} warning${warnCount !== 1 ? 's' : ''}`;
  } else if (ready) {
    bgClass = 'bg-emerald-500/8';
    borderClass = 'border-emerald-500/20';
    icon = <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    message = 'Ready to merge';
  } else {
    bgClass = 'bg-muted/50';
    borderClass = 'border-border';
    icon = <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    message = 'Checking status...';
  }

  return (
    <div className={cn('px-3 py-2 border-b', bgClass, borderClass)}>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-xs font-medium flex-1 truncate" title={message}>{message}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={onRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-3 w-3', isLoading && 'animate-spin')} />
        </Button>
      </div>
      {blockers.length > 0 && (
        <div className="mt-1 space-y-0.5 pl-5">
          {blockers.map((b) => (
            <div key={b.type} className="flex items-center gap-1.5">
              <span className={cn('text-2xs', b.severity === 'error' ? 'text-red-400' : 'text-yellow-400')}>•</span>
              <span className="text-2xs text-muted-foreground">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRHeaderSection
// ---------------------------------------------------------------------------

function PRHeaderSection({
  pr,
  prStatus,
}: {
  pr: PRDetails | null;
  prStatus: string | undefined;
}) {
  if (!pr) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 border-b min-w-0">
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 animate-spin" />
        <span className="text-xs text-muted-foreground">Loading PR...</span>
      </div>
    );
  }

  const stateColor = pr.state === 'open' ? 'text-green-500' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b min-w-0">
      <GitPullRequest className={cn('h-3.5 w-3.5 shrink-0', stateColor)} />
      <span className="text-xs font-medium text-muted-foreground shrink-0">
        #{pr.number}
      </span>
      <span className="text-xs truncate flex-1" title={pr.title}>{pr.title}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
        onClick={() => openUrlInBrowser(pr.htmlUrl)}
        title="View on GitHub"
      >
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CIChecksSection
// ---------------------------------------------------------------------------

function CIChecksSection({
  checkDetails,
  runs,
  workspaceId,
  sessionId,
  hasNoPR,
  onGetJobs,
  onRerun,
  onAnalyzeFailure,
}: {
  checkDetails: CheckDetail[];
  runs: WorkflowRunDTO[];
  workspaceId: string;
  sessionId: string;
  hasNoPR: boolean;
  onGetJobs: (runId: number) => Promise<WorkflowJobDTO[]>;
  onRerun: (runId: number, failedOnly?: boolean) => Promise<void>;
  onAnalyzeFailure: (runId: number, jobId: number) => Promise<unknown>;
}) {
  const [checksExpanded, setChecksExpanded] = useState(true);
  const [analysisTarget, setAnalysisTarget] = useState<{
    runId: number;
    job: WorkflowJobDTO;
  } | null>(null);

  // Latest workflow run
  const latestRun = runs.length > 0 ? runs[0] : null;

  // Eagerly fetch jobs for the latest run
  const [jobs, setJobs] = useState<WorkflowJobDTO[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  // Ref to avoid re-triggering the effect when onGetJobs identity changes
  const onGetJobsRef = useRef(onGetJobs);
  onGetJobsRef.current = onGetJobs;

  useEffect(() => {
    if (!latestRun) {
      setJobs([]);
      return;
    }

    let cancelled = false;
    setLoadingJobs(true);
    setJobsError(false);

    onGetJobsRef.current(latestRun.id)
      .then((fetched) => {
        if (!cancelled) setJobs(fetched);
      })
      .catch(() => {
        if (!cancelled) setJobsError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingJobs(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when run ID changes
  }, [latestRun?.id]);

  // Sort jobs: failures first, running, queued, then passed/skipped
  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const order = (j: WorkflowJobDTO) => {
        if (j.status === 'completed' && (j.conclusion === 'failure' || j.conclusion === 'timed_out' || j.conclusion === 'action_required')) return 0;
        if (j.status === 'in_progress') return 1;
        if (j.status !== 'completed') return 2;
        if (j.conclusion === 'success') return 4;
        return 3;
      };
      return order(a) - order(b);
    });
  }, [jobs]);

  // Fallback: sort checkDetails when no workflow data
  const sortedChecks = useMemo(() => {
    return [...checkDetails].sort((a, b) => {
      const order = (c: CheckDetail) => {
        if (c.status === 'completed' && (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')) return 0;
        if (c.status === 'in_progress') return 1;
        if (c.status !== 'completed') return 2;
        if (c.conclusion === 'success') return 4;
        return 3;
      };
      return order(a) - order(b);
    });
  }, [checkDetails]);

  // Derive summary counts from jobs when available, falling back to checkDetails
  const { passedCount, failedCount, totalCount } = useMemo(() => {
    if (latestRun && jobs.length > 0) {
      return {
        passedCount: jobs.filter(
          (j) => j.conclusion === 'success' || j.conclusion === 'skipped' || j.conclusion === 'neutral'
        ).length,
        failedCount: jobs.filter(
          (j) => j.status === 'completed' && (j.conclusion === 'failure' || j.conclusion === 'timed_out' || j.conclusion === 'action_required')
        ).length,
        totalCount: jobs.length,
      };
    }
    return {
      passedCount: checkDetails.filter(
        (c) => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral'
      ).length,
      failedCount: checkDetails.filter(
        (c) => c.status === 'completed' && (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')
      ).length,
      totalCount: checkDetails.length,
    };
  }, [latestRun, jobs, checkDetails]);

  // Summary label
  let summaryLabel: string;
  let summaryColor: string;
  if (totalCount === 0) {
    summaryLabel = 'No checks';
    summaryColor = 'text-muted-foreground';
  } else if (failedCount > 0) {
    summaryLabel = `${failedCount} failed`;
    summaryColor = 'text-red-500';
  } else if (passedCount === totalCount) {
    summaryLabel = `${passedCount} passed`;
    summaryColor = 'text-green-500';
  } else {
    summaryLabel = `${passedCount}/${totalCount} passed`;
    summaryColor = 'text-yellow-500';
  }

  const hasFailures = latestRun?.conclusion === 'failure' || latestRun?.conclusion === 'timed_out';

  const handleRerun = async () => {
    if (!latestRun) return;
    setRerunning(true);
    try {
      await onRerun(latestRun.id, hasFailures);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="border-b">
      {/* CI Checks header */}
      <div className="flex items-center gap-1 px-3 py-2 w-full">
        <button
          onClick={() => setChecksExpanded(!checksExpanded)}
          className="flex items-center gap-1 flex-1 min-w-0 hover:bg-surface-2 transition-colors rounded-sm py-0.5 -ml-1 pl-1"
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              checksExpanded && 'rotate-90'
            )}
          />
          <span className="text-2xs font-medium text-foreground/60 uppercase tracking-wider">
            CI Checks
          </span>
          <span className={cn('text-2xs ml-auto tabular-nums', summaryColor)}>
            {summaryLabel}
          </span>
        </button>

        {/* Header actions for latest run */}
        {latestRun && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            {latestRun.status === 'completed' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={handleRerun}
                disabled={rerunning}
                title={hasFailures ? 'Rerun failed' : 'Rerun all'}
              >
                {rerunning ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-2.5 w-2.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 text-muted-foreground/50 hover:text-muted-foreground"
              onClick={() => openUrlInBrowser(latestRun.htmlUrl)}
              title="View on GitHub"
            >
              <ExternalLink className="h-2 w-2" />
            </Button>
          </div>
        )}
      </div>

      {checksExpanded && (
        <div className="px-2 pb-2">
          {latestRun ? (
            // Primary: flat list of jobs from latest workflow run
            loadingJobs ? (
              <div className="flex items-center justify-center py-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin mr-2" />
                <span className="text-xs">Loading jobs...</span>
              </div>
            ) : jobsError ? (
              <div className="flex items-center justify-center py-2 text-muted-foreground">
                <span className="text-xs">Failed to load jobs</span>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedJobs.map((job) => {
                  const jobStatus = getCheckStatusInfo(job.status, job.conclusion);
                  const JobIcon = jobStatus.icon;
                  const isFailed = job.conclusion === 'failure' || job.conclusion === 'timed_out';
                  const isSkippedOrCancelled = job.conclusion === 'skipped' || job.conclusion === 'cancelled';
                  const duration = !isSkippedOrCancelled && job.startedAt && job.completedAt
                    ? computeJobDuration(job)
                    : undefined;

                  return (
                    <div key={job.id} className="flex items-center gap-2 py-0.5 px-1 min-w-0">
                      <JobIcon className={cn('h-3 w-3 shrink-0', jobStatus.color)} />
                      <span className="text-xs truncate flex-1">{job.name}</span>
                      {duration !== undefined && (
                        <span className="text-2xs text-muted-foreground shrink-0 tabular-nums">
                          {formatDuration(duration)}
                        </span>
                      )}
                      <span className={cn('text-2xs shrink-0', jobStatus.color)}>
                        {jobStatus.label}
                      </span>
                      {isFailed && latestRun && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0"
                          onClick={() => setAnalysisTarget({ runId: latestRun.id, job })}
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                        onClick={() => openUrlInBrowser(job.htmlUrl)}
                      >
                        <ExternalLink className="h-2 w-2" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )
          ) : hasNoPR && totalCount === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">
              Push and create a PR to see CI checks
            </p>
          ) : totalCount === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">
              No CI checks found
            </p>
          ) : (
            // Fallback: flat list from checkDetails (no workflow data available)
            <div className="space-y-0.5">
              {sortedChecks.map((check) => {
                const statusInfo = getCheckStatusInfo(check.status, check.conclusion);
                const StatusIcon = statusInfo.icon;

                return (
                  <div key={check.name} className="flex items-center gap-2 py-0.5 px-1 min-w-0">
                    <StatusIcon className={cn('h-3 w-3 shrink-0', statusInfo.color)} />
                    <span className="text-xs truncate flex-1">{check.name}</span>
                    {check.durationSeconds !== undefined && check.conclusion !== 'skipped' && check.conclusion !== 'cancelled' && (
                      <span className="text-2xs text-muted-foreground shrink-0 tabular-nums">
                        {formatDuration(check.durationSeconds)}
                      </span>
                    )}
                    <span className={cn('text-2xs shrink-0', statusInfo.color)}>
                      {statusInfo.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Failure analysis modal */}
      {analysisTarget && (
        <CIFailureAnalysis
          workspaceId={workspaceId}
          sessionId={sessionId}
          runId={analysisTarget.runId}
          job={analysisTarget.job}
          onClose={() => setAnalysisTarget(null)}
          onAnalyze={onAnalyzeFailure}
        />
      )}
    </div>
  );
}
