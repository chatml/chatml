'use client';

import type { WorktreeSession } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SessionNameCellProps {
  session: WorktreeSession;
}

export function SessionNameCell({ session }: SessionNameCellProps) {
  const showPrTitle = session.prTitle && (session.prStatus === 'open' || session.prStatus === 'merged');

  return (
    <span
      className={cn(
        'text-sm truncate flex items-center min-w-0',
        session.archived && 'text-muted-foreground'
      )}
    >
      <span className="font-medium truncate shrink-0">
        {session.branch || session.name}
      </span>
      {showPrTitle && (
        <>
          <span className="mx-1.5 text-muted-foreground/40 shrink-0">&middot;</span>
          <span className="text-muted-foreground truncate">{session.prTitle}</span>
        </>
      )}
    </span>
  );
}
