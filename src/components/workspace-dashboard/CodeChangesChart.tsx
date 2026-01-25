'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { TimeSeriesDataPoint } from './useChartData';

interface CodeChangesChartProps {
  data: TimeSeriesDataPoint[];
}

export function CodeChangesChart({ data }: CodeChangesChartProps) {
  const hasData = data.some((d) => d.additions > 0 || d.deletions > 0);

  if (!hasData) {
    return (
      <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">
        No code changes in this period
      </div>
    );
  }

  // Transform data: make deletions negative for visual effect
  const chartData = data.map((d) => ({
    ...d,
    deletionsNeg: -d.deletions,
  }));

  return (
    <div className="h-[140px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="additionsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="deletionsGradient" x1="0" y1="1" x2="0" y2="0">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => Math.abs(v).toString()}
            width={30}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as TimeSeriesDataPoint;
              return (
                <div className="bg-popover border rounded-md shadow-md px-3 py-2 text-sm">
                  <p className="font-medium">{d.date}</p>
                  <p className="text-green-500">+{d.additions} additions</p>
                  <p className="text-red-500">-{d.deletions} deletions</p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="additions"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#additionsGradient)"
          />
          <Area
            type="monotone"
            dataKey="deletionsNeg"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#deletionsGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
