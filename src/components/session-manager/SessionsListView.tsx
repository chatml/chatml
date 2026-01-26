'use client';

import { useMemo } from 'react';
import type { WorktreeSession, Workspace } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SessionRow } from './SessionRow';
import { Search, Layers } from 'lucide-react';

interface SessionsListViewProps {
  workspaces: Workspace[];
  sessions: WorktreeSession[];
  filter: string;
  onFilterChange: (value: string) => void;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onUnarchiveSession: (sessionId: string) => void;
}

interface GroupedSessions {
  [dateKey: string]: Array<{
    session: WorktreeSession;
    workspace: Workspace;
  }>;
}

export function SessionsListView({
  workspaces,
  sessions,
  filter,
  onFilterChange,
  onSelectSession,
  onUnarchiveSession,
}: SessionsListViewProps) {
  // Format date group label
  const formatDateGroup = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get date key for sorting
  const getDateKey = (date: string) => {
    const d = new Date(date);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  };

  // Filter and group sessions by date
  const { activeSessions, archivedSessions } = useMemo(() => {
    const filterLower = filter.toLowerCase();

    // Filter sessions
    const filtered = sessions.filter((session) => {
      if (!filter) return true;
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      return (
        session.name.toLowerCase().includes(filterLower) ||
        session.branch?.toLowerCase().includes(filterLower) ||
        session.task?.toLowerCase().includes(filterLower) ||
        workspace?.name.toLowerCase().includes(filterLower)
      );
    });

    // Separate active and archived
    const active = filtered.filter((s) => !s.archived);
    const archived = filtered.filter((s) => s.archived);

    // Group active sessions by date
    const grouped: GroupedSessions = {};
    active.forEach((session) => {
      const dateKey = getDateKey(session.updatedAt);
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      if (!workspace) return;

      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push({ session, workspace });
    });

    // Sort sessions within each group by updatedAt (most recent first)
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) =>
        new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime()
      );
    });

    // Get archived with workspace info
    const archivedWithWorkspace = archived.map((session) => ({
      session,
      workspace: workspaces.find((w) => w.id === session.workspaceId)!,
    })).filter((item) => item.workspace);

    return { activeSessions: grouped, archivedSessions: archivedWithWorkspace };
  }, [sessions, workspaces, filter]);

  // Get sorted date keys (most recent first)
  const sortedDateKeys = useMemo(() => {
    return Object.keys(activeSessions).sort((a, b) => b.localeCompare(a));
  }, [activeSessions]);

  // Total counts
  const totalActive = sortedDateKeys.reduce(
    (sum, key) => sum + activeSessions[key].length,
    0
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filter input */}
      <div className="p-3 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Filter workspaces..."
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm bg-surface-1 border border-border rounded-md placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Sessions list */}
      <ScrollArea className="flex-1">
        {totalActive === 0 && archivedSessions.length === 0 ? (
          <div className="px-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Layers className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">
              {filter ? 'No matching sessions' : 'No sessions yet'}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {filter ? 'Try adjusting your filter' : 'Add a workspace to get started'}
            </p>
          </div>
        ) : (
          <div className="py-2">
            {/* Active sessions grouped by date */}
            {sortedDateKeys.map((dateKey) => {
              const items = activeSessions[dateKey];
              const dateLabel = formatDateGroup(items[0].session.updatedAt);

              return (
                <div key={dateKey}>
                  {/* Date group header */}
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                    <span>{dateLabel}</span>
                    <span className="text-muted-foreground/50">{items.length}</span>
                  </div>

                  {/* Sessions in this group */}
                  {items.map(({ session, workspace }) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      workspace={workspace}
                      onSelect={() => onSelectSession(workspace.id, session.id)}
                    />
                  ))}
                </div>
              );
            })}

            {/* Archived sessions section */}
            {archivedSessions.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <span>Archived</span>
                  <span className="text-muted-foreground/50">{archivedSessions.length}</span>
                </div>

                {archivedSessions.map(({ session, workspace }) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    workspace={workspace}
                    onSelect={() => onSelectSession(workspace.id, session.id)}
                    onUnarchive={() => onUnarchiveSession(session.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
