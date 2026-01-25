'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { StatusDataPoint } from './useChartData';

interface StatusDistributionChartProps {
  data: StatusDataPoint[];
  total: number;
}

export function StatusDistributionChart({ data, total }: StatusDistributionChartProps) {
  if (data.length === 0 || total === 0) {
    return (
      <div className="h-[140px] flex items-center justify-center text-sm text-muted-foreground">
        No sessions
      </div>
    );
  }

  return (
    <div className="h-[140px] flex items-center justify-center">
      <div className="relative w-[140px] h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={60}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as StatusDataPoint;
                const percentage = ((d.value / total) * 100).toFixed(0);
                return (
                  <div className="bg-popover border rounded-md shadow-md px-3 py-2 text-sm">
                    <p className="font-medium">{d.name}</p>
                    <p className="text-muted-foreground">
                      {d.value} ({percentage}%)
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-semibold">{total}</span>
          <span className="text-xs text-muted-foreground">total</span>
        </div>
      </div>

      {/* Legend */}
      <div className="ml-4 space-y-1.5">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-medium">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
