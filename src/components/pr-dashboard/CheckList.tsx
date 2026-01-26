'use client';

import { type CheckDetail } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Clock, CircleDot, CircleMinus } from 'lucide-react';

interface CheckListProps {
  checks: CheckDetail[];
}

export function CheckList({ checks }: CheckListProps) {
  // Sort: failures first, then pending, then passed
  const sortedChecks = [...checks].sort((a, b) => {
    const getOrder = (check: CheckDetail) => {
      if (check.status !== 'completed') return 1; // pending
      if (check.conclusion === 'failure' || check.conclusion === 'timed_out') return 0; // failed
      return 2; // passed
    };
    return getOrder(a) - getOrder(b);
  });

  return (
    <div className="space-y-1">
      {sortedChecks.map((check, index) => (
        <CheckItem key={`${check.name}-${index}`} check={check} />
      ))}
    </div>
  );
}

interface CheckItemProps {
  check: CheckDetail;
}

function formatDuration(seconds: number): string {
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

function CheckItem({ check }: CheckItemProps) {
  const getStatusInfo = () => {
    if (check.status !== 'completed') {
      if (check.status === 'in_progress') {
        return {
          icon: CircleDot,
          color: 'text-yellow-500',
          label: 'Running',
        };
      }
      return {
        icon: Clock,
        color: 'text-muted-foreground',
        label: 'Queued',
      };
    }

    switch (check.conclusion) {
      case 'success':
        return {
          icon: CheckCircle2,
          color: 'text-muted-foreground',
          label: 'Passed',
        };
      case 'failure':
      case 'timed_out':
      case 'action_required':
        return {
          icon: XCircle,
          color: 'text-red-500',
          label: 'Failed',
        };
      case 'cancelled':
        return {
          icon: XCircle,
          color: 'text-muted-foreground',
          label: 'Cancelled',
        };
      case 'skipped':
        return {
          icon: CircleMinus,
          color: 'text-muted-foreground',
          label: 'Skipped',
        };
      case 'neutral':
        return {
          icon: CircleMinus,
          color: 'text-muted-foreground',
          label: 'Neutral',
        };
      default:
        return {
          icon: Clock,
          color: 'text-muted-foreground',
          label: check.conclusion || 'Unknown',
        };
    }
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <StatusIcon className={cn('h-3 w-3 shrink-0', statusInfo.color)} />
      <span className="truncate">{check.name}</span>
      {check.durationSeconds !== undefined && (
        <span className="text-muted-foreground shrink-0">{formatDuration(check.durationSeconds)}</span>
      )}
      <span className="flex-1" />
      <span className={cn('shrink-0', statusInfo.color)}>{statusInfo.label}</span>
    </div>
  );
}
