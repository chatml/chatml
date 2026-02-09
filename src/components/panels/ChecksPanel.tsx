'use client';

import { useState, useMemo } from 'react';
import { useSelectedIds } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { usePRStatus } from '@/hooks/usePRStatus';
import { useCIRuns } from '@/hooks/useCIRuns';
import { useGitStatus } from '@/hooks/useGitStatus';
import { getCheckStatusInfo, formatDuration } from '@/lib/check-utils';
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
import {
  X,
  AlertTriangle,
  Info,
  ExternalLink,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Loader2,
  RotateCcw,
  Sparkles,
  GitPullRequest,
  ShieldCheck,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChecksPanelProps {
  onSendMessage?: (content: string) => void;
}

interface BlockingItem {
  type: 'ci-failure' | 'conflict' | 'behind-base' | 'not-mergeable' | 'in-progress-op';
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
  if (pr.mergeableState === 'dirty' || pr.mergeableState === 'blocked') {
    // Avoid duplicating if we already have specific blockers
    const hasSpecificBlocker = blockers.some((b) => b.type === 'ci-failure' || b.type === 'conflict');
    if (!hasSpecificBlocker) {
      blockers.push({
        type: 'not-mergeable',
        label: pr.mergeableState === 'dirty' ? 'PR has conflicts' : 'PR is blocked',
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

export function ChecksPanel({ onSendMessage }: ChecksPanelProps) {
  const { selectedWorkspaceId, selectedSessionId } = useSelectedIds();

  // Get session's prStatus from store to pass to usePRStatus hook
  const session = useAppStore((s) => {
    if (!selectedSessionId) return null;
    return s.sessions.find((sess) => sess.id === selectedSessionId) ?? null;
  });
  const prStatus = session?.prStatus;

  // Data hooks
  const { prDetails, loading: prLoading, refetch: refetchPR } = usePRStatus(
    selectedWorkspaceId,
    selectedSessionId,
    prStatus
  );
  const {
    runs,
    loading: ciLoading,
    refetch: refetchCI,
    getJobs,
    rerunWorkflow,
    analyzeFailure,
  } = useCIRuns(selectedWorkspaceId, selectedSessionId);
  const { status: gitStatus, loading: gitLoading, refetch: refetchGit } = useGitStatus(
    selectedWorkspaceId,
    selectedSessionId
  );

  // Compute merge readiness
  const checkDetails = useMemo(() => prDetails?.checkDetails ?? [], [prDetails]);
  const readiness = useMemo(
    () => computeMergeReadiness(prDetails, gitStatus, checkDetails),
    [prDetails, gitStatus, checkDetails]
  );

  const isLoading = prLoading || ciLoading || gitLoading;

  const handleRefreshAll = () => {
    refetchPR();
    refetchCI();
    refetchGit();
  };

  if (!selectedWorkspaceId || !selectedSessionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No session selected</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col min-w-0">
        {/* Merge Readiness Banner */}
        <MergeReadinessBanner
          readiness={readiness}
          isLoading={isLoading}
          onRefresh={handleRefreshAll}
        />

        {/* PR Header */}
        <PRHeaderSection pr={prDetails} prStatus={prStatus} />

        {/* CI Checks */}
        <CIChecksSection
          checkDetails={checkDetails}
          runs={runs}
          workspaceId={selectedWorkspaceId}
          sessionId={selectedSessionId}
          hasNoPR={readiness.hasNoPR}
          onGetJobs={getJobs}
          onRerun={rerunWorkflow}
          onAnalyzeFailure={analyzeFailure}
        />

        {/* Git Status */}
        <div className="border-b">
          <div className="px-3 py-2">
            <span className="text-2xs font-medium text-foreground/60 uppercase tracking-wider">
              Git Status
            </span>
          </div>
          <div className="px-1.5 pb-2">
            <GitStatusSection onSendMessage={onSendMessage} />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// MergeReadinessBanner
// ---------------------------------------------------------------------------

function MergeReadinessBanner({
  readiness,
  isLoading,
  onRefresh,
}: {
  readiness: MergeReadiness;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  const { ready, blockers, pendingCount, hasNoPR } = readiness;

  let bgClass: string;
  let borderClass: string;
  let icon: React.ReactNode;
  let message: string;

  if (hasNoPR) {
    bgClass = 'bg-muted/50';
    borderClass = 'border-border';
    icon = <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    message = 'No pull request';
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
    <div className={cn('flex items-center gap-2 px-3 py-2 border-b min-w-0', bgClass, borderClass)}>
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
  if (!pr && prStatus !== 'open') {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 border-b min-w-0">
        <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground">No pull request yet</span>
      </div>
    );
  }

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
        className="h-5 w-5 shrink-0"
        onClick={() => window.open(pr.htmlUrl, '_blank')}
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
  const [runsExpanded, setRunsExpanded] = useState(false);
  const [analysisTarget, setAnalysisTarget] = useState<{
    runId: number;
    job: WorkflowJobDTO;
  } | null>(null);

  // Sort checks: failures first, running, then passed
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

  const passedCount = checkDetails.filter((c) => c.conclusion === 'success').length;
  const failedCount = checkDetails.filter(
    (c) => c.status === 'completed' && (c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')
  ).length;
  const totalCount = checkDetails.length;

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

  return (
    <div className="border-b">
      {/* CI Checks header */}
      <button
        onClick={() => setChecksExpanded(!checksExpanded)}
        className="flex items-center gap-1 px-3 py-2 w-full hover:bg-surface-2 transition-colors"
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

      {checksExpanded && (
        <div className="px-2 pb-2">
          {hasNoPR && totalCount === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">
              Push and create a PR to see CI checks
            </p>
          ) : totalCount === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">
              No CI checks found
            </p>
          ) : (
            <div className="space-y-0.5">
              {sortedChecks.map((check) => {
                const statusInfo = getCheckStatusInfo(check.status, check.conclusion);
                const StatusIcon = statusInfo.icon;

                return (
                  <div key={check.name} className="flex items-center gap-2 py-0.5 px-1 min-w-0">
                    <StatusIcon className={cn('h-3 w-3 shrink-0', statusInfo.color)} />
                    <span className="text-xs truncate flex-1" title={check.name}>{check.name}</span>
                    {check.durationSeconds !== undefined && (
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

          {/* Workflow Runs sub-section */}
          {runs.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setRunsExpanded(!runsExpanded)}
                className="flex items-center gap-1 px-1 py-1 w-full hover:bg-surface-2 rounded-sm transition-colors"
              >
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 text-muted-foreground transition-transform',
                    runsExpanded && 'rotate-90'
                  )}
                />
                <span className="text-2xs font-medium text-muted-foreground">
                  Workflow Runs
                </span>
                <span className="text-2xs text-muted-foreground ml-auto tabular-nums">
                  {runs.length}
                </span>
              </button>

              {runsExpanded && (
                <div className="mt-1 space-y-1.5">
                  {runs.map((run) => (
                    <WorkflowRunCard
                      key={run.id}
                      run={run}
                      onGetJobs={onGetJobs}
                      onRerun={onRerun}
                      onSelectJobForAnalysis={(job) =>
                        setAnalysisTarget({ runId: run.id, job })
                      }
                    />
                  ))}
                </div>
              )}
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

// ---------------------------------------------------------------------------
// WorkflowRunCard (adapted from CIPanel)
// ---------------------------------------------------------------------------

function WorkflowRunCard({
  run,
  onGetJobs,
  onRerun,
  onSelectJobForAnalysis,
}: {
  run: WorkflowRunDTO;
  onGetJobs: (runId: number) => Promise<WorkflowJobDTO[]>;
  onRerun: (runId: number, failedOnly?: boolean) => Promise<void>;
  onSelectJobForAnalysis: (job: WorkflowJobDTO) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [jobs, setJobs] = useState<WorkflowJobDTO[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobsError, setJobsError] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const statusInfo = getCheckStatusInfo(run.status, run.conclusion);
  const StatusIcon = statusInfo.icon;
  const hasFailures = run.conclusion === 'failure' || run.conclusion === 'timed_out';

  const handleExpand = async () => {
    if (!expanded && jobs.length === 0) {
      setLoadingJobs(true);
      setJobsError(false);
      try {
        const fetchedJobs = await onGetJobs(run.id);
        setJobs(fetchedJobs);
      } catch {
        setJobsError(true);
      } finally {
        setLoadingJobs(false);
      }
    }
    setExpanded(!expanded);
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await onRerun(run.id, hasFailures);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="rounded-md border bg-surface-1/50">
      <div className="flex items-center gap-2 px-2 py-1.5 min-w-0">
        <button
          className="p-0.5 hover:bg-surface-2 rounded shrink-0"
          onClick={handleExpand}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        <StatusIcon className={cn('h-3 w-3 shrink-0', statusInfo.color)} />
        <span className="text-xs truncate flex-1" title={run.name}>{run.name}</span>
        <span className={cn('text-2xs shrink-0', statusInfo.color)}>
          {statusInfo.label}
        </span>

        {run.status === 'completed' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
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
          className="h-5 w-5 shrink-0"
          onClick={() => window.open(run.htmlUrl, '_blank')}
          title="View on GitHub"
        >
          <ExternalLink className="h-2.5 w-2.5" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t px-2 py-1.5">
          {loadingJobs ? (
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
              {jobs.map((job) => {
                const jobStatus = getCheckStatusInfo(job.status, job.conclusion);
                const JobIcon = jobStatus.icon;
                const isFailed = job.conclusion === 'failure' || job.conclusion === 'timed_out';

                return (
                  <div key={job.id} className="flex items-center gap-2 py-0.5 min-w-0">
                    <JobIcon className={cn('h-2.5 w-2.5 shrink-0', jobStatus.color)} />
                    <span className="text-xs truncate flex-1" title={job.name}>{job.name}</span>
                    <span className={cn('text-2xs shrink-0', jobStatus.color)}>
                      {jobStatus.label}
                    </span>
                    {isFailed && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => onSelectJobForAnalysis(job)}
                        title="Analyze failure"
                      >
                        <Sparkles className="h-2.5 w-2.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => window.open(job.htmlUrl, '_blank')}
                      title="View on GitHub"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
