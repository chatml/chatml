'use client';

import { RecentSessionItem } from './RecentSessionItem';
import type { WorktreeSession, Workspace } from '@/lib/types';

interface RecentSessionsProps {
  sessions: WorktreeSession[];
  workspaces: Workspace[];
  workspaceColors: Record<string, string>;
}

export function RecentSessions({ sessions, workspaces, workspaceColors }: RecentSessionsProps) {
  const workspaceMap = new Map(workspaces.map((w) => [w.id, w]));

  return (
    <div>
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Recent
      </h2>

      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No sessions yet</p>
      ) : (
        <div className="divide-y divide-border/30">
          {sessions.map((session) => (
            <RecentSessionItem
              key={session.id}
              session={session}
              workspace={workspaceMap.get(session.workspaceId)}
              workspaceColors={workspaceColors}
            />
          ))}
        </div>
      )}
    </div>
  );
}
