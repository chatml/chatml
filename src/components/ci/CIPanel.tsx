'use client';

import { useState } from 'react';
import { useCIRuns } from '@/hooks/useCIRuns';
import { type WorkflowRunDTO, type WorkflowJobDTO } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Clock,
  CircleDot,
  ExternalLink,
  Play,
  RotateCcw,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { CIFailureAnalysis } from './CIFailureAnalysis';

interface CIPanelProps {
  workspaceId: string;
  sessionId: string;
}

export function CIPanel({ workspaceId, sessionId }: CIPanelProps) {
  const {
    runs,
    loading,
    error,
    refetch,
    getJobs,
    rerunWorkflow,
    analyzeFailure,
  } = useCIRuns(workspaceId, sessionId);

  if (loading && runs.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading CI runs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        <p>Failed to load CI runs: {error}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={refetch}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
        <p className="text-sm">No CI runs found for this branch.</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={refetch}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">CI Runs</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={refetch}
          disabled={loading}
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="space-y-2 p-2">
          {runs.map((run) => (
            <WorkflowRunCard
              key={run.id}
              run={run}
              workspaceId={workspaceId}
              sessionId={sessionId}
              onGetJobs={getJobs}
              onRerun={rerunWorkflow}
              onAnalyzeFailure={analyzeFailure}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface WorkflowRunCardProps {
  run: WorkflowRunDTO;
  workspaceId: string;
  sessionId: string;
  onGetJobs: (runId: number) => Promise<WorkflowJobDTO[]>;
  onRerun: (runId: number, failedOnly?: boolean) => Promise<void>;
  onAnalyzeFailure: (runId: number, jobId: number) => Promise<unknown>;
}

function WorkflowRunCard({
  run,
  workspaceId,
  sessionId,
  onGetJobs,
  onRerun,
  onAnalyzeFailure,
}: WorkflowRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [jobs, setJobs] = useState<WorkflowJobDTO[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [selectedJob, setSelectedJob] = useState<WorkflowJobDTO | null>(null);

  const statusInfo = getRunStatusInfo(run);
  const StatusIcon = statusInfo.icon;

  const handleExpand = async () => {
    if (!expanded && jobs.length === 0) {
      setLoadingJobs(true);
      try {
        const fetchedJobs = await onGetJobs(run.id);
        setJobs(fetchedJobs);
      } catch (err) {
        console.error('Failed to fetch jobs:', err);
      } finally {
        setLoadingJobs(false);
      }
    }
    setExpanded(!expanded);
  };

  const handleRerun = async (failedOnly: boolean = false) => {
    setRerunning(true);
    try {
      await onRerun(run.id, failedOnly);
    } finally {
      setRerunning(false);
    }
  };

  const runHasFailures = run.conclusion === 'failure' || run.conclusion === 'timed_out';

  return (
    <div className="border rounded-lg bg-card">
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2">
          <button
            className="p-0.5 hover:bg-surface-1 rounded"
            onClick={handleExpand}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <StatusIcon className={cn('h-4 w-4 mt-0.5 shrink-0', statusInfo.color)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{run.name}</span>
              <span className={cn('text-xs', statusInfo.color)}>
                {statusInfo.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span className="truncate">{run.headSha.substring(0, 7)}</span>
              <span>on {run.headBranch}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            {run.status === 'completed' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleRerun(runHasFailures)}
                disabled={rerunning}
              >
                {rerunning ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    {runHasFailures ? 'Rerun Failed' : 'Rerun'}
                  </>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => window.open(run.htmlUrl, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Expanded jobs list */}
      {expanded && (
        <div className="border-t px-3 py-2">
          {loadingJobs ? (
            <div className="flex items-center justify-center py-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin mr-2" />
              Loading jobs...
            </div>
          ) : (
            <div className="space-y-1">
              {jobs.map((job) => (
                <JobItem
                  key={job.id}
                  job={job}
                  onAnalyze={() => setSelectedJob(job)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Failure analysis modal */}
      {selectedJob && (
        <CIFailureAnalysis
          workspaceId={workspaceId}
          sessionId={sessionId}
          runId={run.id}
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onAnalyze={onAnalyzeFailure}
        />
      )}
    </div>
  );
}

interface JobItemProps {
  job: WorkflowJobDTO;
  onAnalyze: () => void;
}

function JobItem({ job, onAnalyze }: JobItemProps) {
  const [expanded, setExpanded] = useState(false);
  const statusInfo = getJobStatusInfo(job);
  const StatusIcon = statusInfo.icon;
  const isFailed = job.conclusion === 'failure' || job.conclusion === 'timed_out';

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 py-1">
        <button
          className="p-0.5 hover:bg-surface-1 rounded"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        <StatusIcon className={cn('h-3 w-3 shrink-0', statusInfo.color)} />
        <span className="truncate flex-1">{job.name}</span>
        <span className={cn('shrink-0', statusInfo.color)}>{statusInfo.label}</span>
        {isFailed && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-xs"
            onClick={onAnalyze}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Analyze
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1"
          onClick={() => window.open(job.htmlUrl, '_blank')}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>

      {/* Steps */}
      {expanded && job.steps.length > 0 && (
        <div className="ml-6 pl-2 border-l space-y-0.5">
          {job.steps.map((step) => {
            const stepStatus = getStepStatusInfo(step);
            const StepIcon = stepStatus.icon;
            return (
              <div key={step.number} className="flex items-center gap-2 py-0.5">
                <StepIcon className={cn('h-2.5 w-2.5 shrink-0', stepStatus.color)} />
                <span className="truncate flex-1">{step.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Status helper functions
function getRunStatusInfo(run: WorkflowRunDTO) {
  if (run.status === 'in_progress') {
    return { icon: CircleDot, color: 'text-yellow-500', label: 'Running' };
  }
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') {
    return { icon: Clock, color: 'text-muted-foreground', label: 'Queued' };
  }
  if (run.status === 'completed') {
    switch (run.conclusion) {
      case 'success':
        return { icon: Check, color: 'text-green-500', label: 'Success' };
      case 'failure':
        return { icon: X, color: 'text-red-500', label: 'Failed' };
      case 'cancelled':
        return { icon: X, color: 'text-muted-foreground', label: 'Cancelled' };
      case 'timed_out':
        return { icon: Clock, color: 'text-red-500', label: 'Timed out' };
      default:
        return { icon: Check, color: 'text-muted-foreground', label: run.conclusion || 'Completed' };
    }
  }
  return { icon: Play, color: 'text-muted-foreground', label: run.status };
}

function getJobStatusInfo(job: WorkflowJobDTO) {
  if (job.status === 'in_progress') {
    return { icon: CircleDot, color: 'text-yellow-500', label: 'Running' };
  }
  if (job.status === 'queued' || job.status === 'waiting' || job.status === 'pending') {
    return { icon: Clock, color: 'text-muted-foreground', label: 'Queued' };
  }
  if (job.status === 'completed') {
    switch (job.conclusion) {
      case 'success':
        return { icon: Check, color: 'text-green-500', label: 'Passed' };
      case 'failure':
        return { icon: X, color: 'text-red-500', label: 'Failed' };
      case 'cancelled':
        return { icon: X, color: 'text-muted-foreground', label: 'Cancelled' };
      case 'timed_out':
        return { icon: Clock, color: 'text-red-500', label: 'Timed out' };
      case 'skipped':
        return { icon: Check, color: 'text-muted-foreground', label: 'Skipped' };
      default:
        return { icon: Check, color: 'text-muted-foreground', label: job.conclusion || 'Done' };
    }
  }
  return { icon: Clock, color: 'text-muted-foreground', label: job.status };
}

function getStepStatusInfo(step: { status: string; conclusion: string }) {
  if (step.status === 'in_progress') {
    return { icon: CircleDot, color: 'text-yellow-500' };
  }
  if (step.status !== 'completed') {
    return { icon: Clock, color: 'text-muted-foreground' };
  }
  switch (step.conclusion) {
    case 'success':
      return { icon: Check, color: 'text-green-500' };
    case 'failure':
      return { icon: X, color: 'text-red-500' };
    case 'skipped':
      return { icon: Check, color: 'text-muted-foreground' };
    default:
      return { icon: Check, color: 'text-muted-foreground' };
  }
}
