'use client';

import { useMemo } from 'react';
import { useActiveSessions } from '@/stores/selectors';
import { SessionRow } from './SessionRow';
import type { WorktreeSession, Workspace } from '@/lib/types';

interface SessionsListProps {
  sessions: WorktreeSession[];
  workspaces: Workspace[];
  workspaceColors: Record<string, string>;
}

export function SessionsList({ sessions, workspaces, workspaceColors }: SessionsListProps) {
  const workspaceMap = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w])),
    [workspaces]
  );

  const activeSessions = useActiveSessions(sessions);

  const activeIds = useMemo(
    () => new Set(activeSessions.map((s) => s.id)),
    [activeSessions]
  );

  // Active sessions first, then idle sessions — both sorted by updatedAt
  const sortedSessions = useMemo(() => {
    const active = sessions.filter((s) => activeIds.has(s.id));
    const idle = sessions.filter((s) => !activeIds.has(s.id));
    return [...active, ...idle];
  }, [sessions, activeIds]);

  const activeCount = activeSessions.length;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Sessions
        </h2>
        {activeCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {activeCount} active
          </span>
        )}
      </div>

      {sortedSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground/50 py-6 text-center">
          Start your first session to see activity here
        </p>
      ) : (
        <div className="divide-y divide-border/20">
          {sortedSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              workspace={workspaceMap.get(session.workspaceId)}
              workspaceColors={workspaceColors}
              isActive={activeIds.has(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
