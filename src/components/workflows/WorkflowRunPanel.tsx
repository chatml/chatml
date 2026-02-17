'use client';

import { useEffect, useCallback } from 'react';
import { useWorkflowStore, type NodeExecutionStatus } from '@/stores/workflowStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  RefreshCw,
} from 'lucide-react';
import type { WorkflowRun } from '@/lib/types';

const STATUS_CONFIG: Record<NodeExecutionStatus | 'pending', {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
}> = {
  pending: { icon: Clock, color: 'text-muted-foreground', label: 'Pending' },
  running: { icon: Loader2, color: 'text-blue-500', label: 'Running' },
  completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'Failed' },
  skipped: { icon: SkipForward, color: 'text-muted-foreground', label: 'Skipped' },
};

interface WorkflowRunPanelProps {
  workflowId: string;
}

export function WorkflowRunPanel({ workflowId }: WorkflowRunPanelProps) {
  const {
    runs,
    activeRunId,
    nodeStatuses,
    fetchRuns,
    triggerRun,
    cancelRun,
  } = useWorkflowStore();

  const workflowRuns = runs[workflowId] || [];

  useEffect(() => {
    fetchRuns(workflowId);
  }, [workflowId, fetchRuns]);

  const handleRun = useCallback(async () => {
    try {
      await triggerRun(workflowId);
    } catch {
      // Error handled by store
    }
  }, [workflowId, triggerRun]);

  const handleCancel = useCallback(async () => {
    if (!activeRunId) return;
    try {
      await cancelRun(workflowId, activeRunId);
    } catch {
      // Error handled by store
    }
  }, [workflowId, activeRunId, cancelRun]);

  return (
    <div className="border-t border-border bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Runs</span>
          {activeRunId && (
            <span className="flex items-center gap-1 text-xs text-blue-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => fetchRuns(workflowId)}
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          {activeRunId ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs gap-1 text-destructive"
              onClick={handleCancel}
            >
              <Square className="h-3 w-3" /> Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs gap-1"
              onClick={handleRun}
            >
              <Play className="h-3 w-3" /> Run
            </Button>
          )}
        </div>
      </div>

      {/* Node status bar (during active run) */}
      {activeRunId && Object.keys(nodeStatuses).length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border overflow-x-auto">
          {Object.entries(nodeStatuses).map(([nodeId, status]) => {
            const config = STATUS_CONFIG[status.status];
            const Icon = config.icon;
            return (
              <div
                key={nodeId}
                className={cn(
                  'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border',
                  status.status === 'running' && 'border-blue-500/30 bg-blue-500/10',
                  status.status === 'completed' && 'border-green-500/30 bg-green-500/10',
                  status.status === 'failed' && 'border-destructive/30 bg-destructive/10',
                  status.status === 'pending' && 'border-border',
                  status.status === 'skipped' && 'border-border',
                )}
                title={status.error || `${config.label}${status.durationMs ? ` (${status.durationMs}ms)` : ''}`}
              >
                <Icon className={cn('h-2.5 w-2.5', config.color, status.status === 'running' && 'animate-spin')} />
                <span className="truncate max-w-[80px]">{nodeId.split('-').slice(0, 2).join('-')}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Run history */}
      <div className="max-h-[120px] overflow-y-auto">
        {workflowRuns.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-3">
            No runs yet
          </div>
        ) : (
          <div className="divide-y divide-border">
            {workflowRuns.slice(0, 10).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  const statusColor = {
    pending: 'text-muted-foreground',
    running: 'text-blue-500',
    completed: 'text-green-500',
    failed: 'text-destructive',
    cancelled: 'text-muted-foreground',
  }[run.status] || 'text-muted-foreground';

  const StatusIcon = {
    pending: Clock,
    running: Loader2,
    completed: CheckCircle2,
    failed: XCircle,
    cancelled: Square,
  }[run.status] || Clock;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <StatusIcon className={cn('h-3 w-3 shrink-0', statusColor, run.status === 'running' && 'animate-spin')} />
      <span className="font-mono text-[10px] text-muted-foreground truncate">{run.id.slice(0, 8)}</span>
      <span className={cn('capitalize', statusColor)}>{run.status}</span>
      <span className="text-muted-foreground ml-auto">
        {run.triggerType}
      </span>
      {run.createdAt && (
        <span className="text-muted-foreground">
          {new Date(run.createdAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
