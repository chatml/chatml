import {
  Check,
  X,
  XCircle,
  Clock,
  CircleDot,
  CircleMinus,
  Play,
  type LucideIcon,
} from 'lucide-react';
import type { CIFailureContextDTO } from '@/lib/api';

export interface StatusInfo {
  icon: LucideIcon;
  color: string;
  label: string;
}

/**
 * Get status icon, color, and label for a CI check/job based on status + conclusion.
 */
export function getCheckStatusInfo(status: string, conclusion: string): StatusInfo {
  if (status === 'in_progress') {
    return { icon: CircleDot, color: 'text-yellow-500', label: 'Running' };
  }
  if (status === 'queued' || status === 'waiting' || status === 'pending') {
    return { icon: Clock, color: 'text-muted-foreground', label: 'Queued' };
  }
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return { icon: Check, color: 'text-green-500', label: 'Passed' };
      case 'failure':
        return { icon: X, color: 'text-red-500', label: 'Failed' };
      case 'timed_out':
        return { icon: Clock, color: 'text-red-500', label: 'Timed out' };
      case 'cancelled':
        return { icon: X, color: 'text-muted-foreground', label: 'Cancelled' };
      case 'skipped':
        return { icon: CircleMinus, color: 'text-muted-foreground', label: 'Skipped' };
      case 'neutral':
        return { icon: CircleMinus, color: 'text-muted-foreground', label: 'Neutral' };
      case 'action_required':
        return { icon: XCircle, color: 'text-red-500', label: 'Action required' };
      default:
        return { icon: Check, color: 'text-muted-foreground', label: conclusion || 'Done' };
    }
  }
  return { icon: Play, color: 'text-muted-foreground', label: status };
}

/**
 * Format a duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format CI failure context into a structured message for the AI agent.
 */
export function formatCIFailureMessage(context: CIFailureContextDTO): string {
  const parts: string[] = [
    'Fix the failing CI checks. Here is the failure context:',
    '',
  ];

  for (const run of context.failedRuns) {
    parts.push(`## Workflow: "${run.runName}"`);
    parts.push('');

    for (const job of run.failedJobs) {
      parts.push(`### Job: "${job.jobName}" - FAILED`);

      if (job.failedSteps && job.failedSteps.length > 0) {
        parts.push(`Failed steps: ${job.failedSteps.join(', ')}`);
      }

      if (job.logs && job.logs !== '(logs unavailable)') {
        if (job.truncated) {
          parts.push(`(log truncated, showing tail of ${job.logLines} total lines)`);
        }
        parts.push('');
        parts.push('<logs>');
        parts.push(job.logs);
        parts.push('</logs>');
      } else {
        parts.push('(logs unavailable)');
      }

      parts.push('');
    }
  }

  if (context.truncated) {
    parts.push(`Note: ${context.totalFailed} total jobs failed. Only the first 5 are shown above.`);
    parts.push('');
  }

  return parts.join('\n');
}
