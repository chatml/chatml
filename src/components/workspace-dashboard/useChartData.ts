import { useMemo } from 'react';
import type { WorktreeSession } from '@/lib/types';

export interface TimeSeriesDataPoint {
  date: string; // YYYY-MM-DD
  label: string; // Display label (e.g., "Mon", "Jan 15")
  sessions: number;
  additions: number;
  deletions: number;
}

export interface StatusDataPoint {
  name: string;
  value: number;
  color: string;
}

export interface ChartData {
  timeSeries: TimeSeriesDataPoint[];
  statusDistribution: StatusDataPoint[];
  totals: {
    sessions: number;
    additions: number;
    deletions: number;
  };
}

// Generate array of dates for the last N days using immutable operations
function getLastNDays(n: number): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(todayMidnight.getTime() - i * 24 * 60 * 60 * 1000);
    dates.push(date);
  }
  return dates;
}

// Format date for display
function formatDateLabel(date: Date, includeMonth: boolean): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (includeMonth) {
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }
  return days[date.getDay()];
}

// Format date as YYYY-MM-DD for comparison (using local timezone)
function toDateKey(date: Date): string {
  // Use Intl.DateTimeFormat to get YYYY-MM-DD in local timezone
  // 'en-CA' locale produces the ISO-like format we need
  return new Intl.DateTimeFormat('en-CA').format(date);
}

export function useChartData(sessions: WorktreeSession[], days: number = 14): ChartData {
  return useMemo(() => {
    const dates = getLastNDays(days);
    const includeMonth = days > 7;

    // Initialize time series data
    const timeSeriesMap = new Map<string, TimeSeriesDataPoint>();
    for (const date of dates) {
      const key = toDateKey(date);
      timeSeriesMap.set(key, {
        date: key,
        label: formatDateLabel(date, includeMonth),
        sessions: 0,
        additions: 0,
        deletions: 0,
      });
    }

    // Aggregate session data
    for (const session of sessions) {
      const createdDate = toDateKey(new Date(session.createdAt));
      const point = timeSeriesMap.get(createdDate);
      if (point) {
        point.sessions += 1;
        point.additions += session.stats?.additions || 0;
        point.deletions += session.stats?.deletions || 0;
      }
    }

    // Calculate status distribution
    const statusCounts: Record<string, number> = {
      active: 0,
      idle: 0,
      done: 0,
      error: 0,
    };

    for (const session of sessions) {
      statusCounts[session.status] = (statusCounts[session.status] || 0) + 1;
    }

    const statusColors: Record<string, string> = {
      active: '#22c55e', // green-500
      idle: '#eab308', // yellow-500
      done: '#6b7280', // gray-500
      error: '#ef4444', // red-500
    };

    const statusLabels: Record<string, string> = {
      active: 'Active',
      idle: 'Idle',
      done: 'Done',
      error: 'Error',
    };

    const statusDistribution: StatusDataPoint[] = Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({
        name: statusLabels[status] || status,
        value: count,
        color: statusColors[status] || '#6b7280',
      }));

    // Calculate totals
    const totals = {
      sessions: sessions.length,
      additions: sessions.reduce((sum, s) => sum + (s.stats?.additions || 0), 0),
      deletions: sessions.reduce((sum, s) => sum + (s.stats?.deletions || 0), 0),
    };

    return {
      timeSeries: Array.from(timeSeriesMap.values()),
      statusDistribution,
      totals,
    };
  }, [sessions, days]);
}
