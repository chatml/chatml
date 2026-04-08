import type { ScheduledTask, ScheduledTaskRun } from '@/lib/types';

export function formatSchedule(task: ScheduledTask): string {
  const time = `${String(task.scheduleHour).padStart(2, '0')}:${String(task.scheduleMinute).padStart(2, '0')}`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  switch (task.frequency) {
    case 'hourly':
      return `Every hour at :${String(task.scheduleMinute).padStart(2, '0')}`;
    case 'daily':
      return `Every day at ${time}`;
    case 'weekly':
      return `Every ${days[task.scheduleDayOfWeek]} at ${time}`;
    case 'monthly':
      return `Monthly on the ${task.scheduleDayOfMonth}${ordinalSuffix(task.scheduleDayOfMonth)} at ${time}`;
    default:
      return `Every day at ${time}`;
  }
}

export function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function formatNextRun(nextRunAt?: string): string {
  if (!nextRunAt) return 'Not scheduled';

  const next = new Date(nextRunAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const timeStr = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (next >= today && next < tomorrow) {
    return `Today at ${timeStr}`;
  }
  if (next >= tomorrow && next < dayAfterTomorrow) {
    return `Tomorrow at ${timeStr}`;
  }

  const dateStr = next.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr} at ${timeStr}`;
}

export function getRunStatusDisplay(status: ScheduledTaskRun['status']): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'running':
      return { label: 'Running', className: 'text-blue-500' };
    case 'completed':
      return { label: 'Completed', className: 'text-green-500' };
    case 'failed':
      return { label: 'Failed', className: 'text-red-500' };
    case 'skipped':
      return { label: 'Skipped', className: 'text-orange-500' };
    case 'pending':
      return { label: 'Pending', className: 'text-yellow-500' };
    default:
      return { label: status, className: 'text-muted-foreground' };
  }
}

export function formatRunTimestamp(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Unknown';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (d >= today) {
    return `Today at ${timeStr}`;
  }
  if (d >= yesterday) {
    return `Yesterday at ${timeStr}`;
  }

  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateStr} at ${timeStr}`;
}
