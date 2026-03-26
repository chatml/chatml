'use client';

import type { WorktreeSession } from '@/lib/types';
import { cn } from '@/lib/utils';

interface DiffStatsCellProps {
  session: WorktreeSession;
}

export function DiffStatsCell({ session }: DiffStatsCellProps) {
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);

  if (!hasStats) {
    return null;
  }

  return (
    <span className={cn(
      'text-2xs px-1 py-px rounded border font-mono tabular-nums',
      session.archived
        ? 'border-border/50 text-muted-foreground/60'
        : 'border-text-success/40'
    )}>
      <span className={session.archived ? '' : 'text-text-success'}>+{session.stats!.additions}</span>
      <span className={cn('ml-1', session.archived ? '' : 'text-text-error')}>-{session.stats!.deletions}</span>
    </span>
  );
}
