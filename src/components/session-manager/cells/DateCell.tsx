'use client';

import { cn } from '@/lib/utils';

interface DateCellProps {
  date: string;
  archived?: boolean;
}

export function DateCell({ date, archived }: DateCellProps) {
  return (
    <span className={cn(
      'text-xs text-muted-foreground',
      archived && 'opacity-50'
    )}>
      {formatRelativeDate(date)}
    </span>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
