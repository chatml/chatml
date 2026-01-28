'use client';

import type { DashboardStats } from './useDashboardData';
import { cn } from '@/lib/utils';
import {
  Layers,
  Play,
  GitPullRequest,
  Plus,
  Minus,
} from 'lucide-react';

interface StatsOverviewProps {
  stats: DashboardStats;
}

interface StatItemProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  className?: string;
  iconClassName?: string;
}

function StatItem({ icon: Icon, label, value, className, iconClassName }: StatItemProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Icon className={cn('h-4 w-4 text-muted-foreground', iconClassName)} />
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

export function StatsOverview({ stats }: StatsOverviewProps) {
  const hasChanges = stats.additions > 0 || stats.deletions > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3 px-4 bg-surface-1 rounded-lg">
      <StatItem
        icon={Layers}
        label="sessions"
        value={stats.total}
      />

      {stats.active > 0 && (
        <StatItem
          icon={Play}
          label="active"
          value={stats.active}
          iconClassName="text-green-500"
        />
      )}

      {hasChanges && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Plus className="h-4 w-4 text-green-500" />
            <span className="text-lg font-semibold tabular-nums text-green-500">
              {stats.additions}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Minus className="h-4 w-4 text-red-500" />
            <span className="text-lg font-semibold tabular-nums text-red-500">
              {stats.deletions}
            </span>
          </div>
        </div>
      )}

      {stats.openPRs > 0 && (
        <StatItem
          icon={GitPullRequest}
          label="open PRs"
          value={stats.openPRs}
          iconClassName="text-violet-400"
        />
      )}
    </div>
  );
}
