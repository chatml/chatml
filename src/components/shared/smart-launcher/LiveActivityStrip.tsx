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
    <div>
      {/* Section header with live dot */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Active Now
        </h2>
      </div>

      {/* Horizontal scroll container */}
      <div className="flex gap-3 overflow-x-auto scrollbar-none snap-x snap-mandatory pb-1">
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
