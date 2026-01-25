'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { TimeSeriesDataPoint } from './useChartData';

interface SessionsOverTimeChartProps {
  data: TimeSeriesDataPoint[];
}

export function SessionsOverTimeChart({ data }: SessionsOverTimeChartProps) {
  const maxSessions = Math.max(...data.map((d) => d.sessions), 1);
  const hasData = data.some((d) => d.sessions > 0);

  if (!hasData) {
    return (
      <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">
        No sessions in this period
      </div>
    );
  }

  return (
    <div className="h-[140px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
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
            allowDecimals={false}
            domain={[0, Math.max(maxSessions, 3)]}
            width={30}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as TimeSeriesDataPoint;
              return (
                <div className="bg-popover border rounded-md shadow-md px-3 py-2 text-sm">
                  <p className="font-medium">{d.date}</p>
                  <p className="text-muted-foreground">
                    {d.sessions} session{d.sessions !== 1 ? 's' : ''} created
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="sessions" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={entry.sessions > 0 ? 'var(--primary)' : 'var(--muted)'}
                opacity={entry.sessions > 0 ? 1 : 0.3}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
