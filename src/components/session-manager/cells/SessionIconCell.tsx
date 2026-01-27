'use client';

import { Terminal, MessageSquare, Archive } from 'lucide-react';
import type { WorktreeSession } from '@/lib/types';

interface SessionIconCellProps {
  session: WorktreeSession;
}

export function SessionIconCell({ session }: SessionIconCellProps) {
  if (session.archived) {
    return <Archive className="h-4 w-4 text-muted-foreground/50" />;
  }

  const isActive = session.status === 'active';

  return isActive ? (
    <Terminal className="h-4 w-4 text-text-success" />
  ) : (
    <MessageSquare className="h-4 w-4 text-muted-foreground" />
  );
}
