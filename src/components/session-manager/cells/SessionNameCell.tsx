'use client';

import type { WorktreeSession } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SessionNameCellProps {
  session: WorktreeSession;
}

export function SessionNameCell({ session }: SessionNameCellProps) {
  return (
    <span
      className={cn(
        'text-sm font-medium truncate',
        session.archived && 'text-muted-foreground'
      )}
    >
      {session.branch || session.name}
    </span>
  );
}
