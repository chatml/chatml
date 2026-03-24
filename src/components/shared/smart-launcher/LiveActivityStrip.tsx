'use client';

import { useMemo } from 'react';
import { useActiveSessions } from '@/stores/selectors';
import { LiveActivityCard } from './LiveActivityCard';
import type { WorktreeSession, Workspace } from '@/lib/types';

interface LiveActivityStripProps {
  sessions: WorktreeSession[];
  workspaces: Workspace[];
  workspaceColors: Record<string, string>;
}

export function LiveActivityStrip({ sessions, workspaces, workspaceColors }: LiveActivityStripProps) {
  const workspaceMap = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w])),
    [workspaces]
  );

  const activeSessions = useActiveSessions(sessions);

  if (activeSessions.length === 0) return null;

  return (
    <div className="rounded-xl bg-surface-1/50 border border-border/30 p-4">
      {/* Section header with live dot */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Active Now
        </h2>
        <span className="text-xs text-muted-foreground/50">{activeSessions.length}</span>
      </div>

      {/* Horizontal scroll container */}
      <div className="flex gap-2.5 overflow-x-auto scrollbar-none snap-x snap-mandatory pb-0.5">
        {activeSessions.map((session) => (
          <LiveActivityCard
            key={session.id}
            session={session}
            workspace={workspaceMap.get(session.workspaceId)}
            workspaceColors={workspaceColors}
          />
        ))}
      </div>
    </div>
  );
}
