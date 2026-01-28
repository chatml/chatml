'use client';

import { useState } from 'react';
import type { WorktreeSession } from '@/lib/types';
import { useChartData } from './useChartData';
import { SessionsOverTimeChart } from './SessionsOverTimeChart';
import { CodeChangesChart } from './CodeChangesChart';
import { StatusDistributionChart } from './StatusDistributionChart';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DashboardChartsProps {
  sessions: WorktreeSession[];
}

type TimeRange = 7 | 14 | 30;

export function DashboardCharts({ sessions }: DashboardChartsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(14);
  const chartData = useChartData(sessions, timeRange);

  return (
    <div className="space-y-4">
      {/* Time range selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Activity
        </h2>
        <div className="flex items-center gap-1 bg-surface-1 rounded-md p-0.5">
          {([7, 14, 30] as TimeRange[]).map((days) => (
            <Button
              key={days}
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 text-xs',
                timeRange === days && 'bg-background shadow-sm'
              )}
              onClick={() => setTimeRange(days)}
            >
              {days}d
            </Button>
          ))}
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sessions over time */}
        <div className="bg-surface-1 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Sessions Created</h3>
          <SessionsOverTimeChart data={chartData.timeSeries} />
        </div>

        {/* Code changes */}
        <div className="bg-surface-1 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Code Changes</h3>
          <CodeChangesChart data={chartData.timeSeries} />
        </div>

        {/* Status distribution */}
        <div className="bg-surface-1 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Session Status</h3>
          <StatusDistributionChart
            data={chartData.statusDistribution}
            total={chartData.totals.sessions}
          />
        </div>
      </div>
    </div>
  );
}
