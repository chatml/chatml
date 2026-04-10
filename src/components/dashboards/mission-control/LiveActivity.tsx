'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';
import { navigate } from '@/lib/navigation';
import { Circle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/format';

function formatDuration(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '<1m';
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatCountdown(dateStr: string): string {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs < 0) return 'overdue';
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `in ${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  return `in ${hours}h`;
}

export function LiveActivity() {
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const tasks = useScheduledTaskStore((s) => s.tasks);

  const wsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) m.set(w.id, w.name);
    return m;
  }, [workspaces]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => (s.status === 'active' || s.status === 'idle') && !s.archived)
      .sort((a, b) => {
        // Active before idle
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 8),
    [sessions],
  );

  const recentlyCompleted = useMemo(
    () => sessions
      .filter((s) => s.status === 'done' || s.status === 'error')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5),
    [sessions],
  );

  const upcomingTasks = useMemo(
    () => tasks
      .filter((t) => t.enabled && t.nextRunAt)
      .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
      .slice(0, 3),
    [tasks],
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      {/* Active Sessions - takes 3 cols */}
      <div className="md:col-span-3 space-y-1.5">
        <h2 className="text-sm font-semibold text-foreground mb-2">
          Active Sessions
          {activeSessions.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              {activeSessions.filter((s) => s.status === 'active').length} running
            </span>
          )}
        </h2>
        {activeSessions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No active sessions</p>
        ) : (
          activeSessions.map((session) => (
            <button
              key={session.id}
              className="w-full flex items-center gap-3 rounded-lg border border-border/50 bg-surface-1/50 px-3 py-2 hover:bg-surface-2/50 transition-colors text-left"
              onClick={() => navigate({
                workspaceId: session.workspaceId,
                sessionId: session.id,
                contentView: { type: 'conversation' },
              })}
            >
              <Circle
                className={cn(
                  'w-2.5 h-2.5 shrink-0',
                  session.status === 'active'
                    ? 'fill-green-500 text-green-500 animate-pulse'
                    : 'fill-yellow-500/50 text-yellow-500/50',
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {session.name || session.branch}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {wsMap.get(session.workspaceId) ?? ''}
                  </span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {session.status === 'active' ? formatDuration(session.createdAt ?? session.updatedAt) : `Idle ${formatTimeAgo(session.updatedAt)}`}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Right column - Recently Completed + Scheduled */}
      <div className="md:col-span-2 space-y-4">
        {/* Recently Completed */}
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold text-foreground mb-2">Recently Completed</h2>
          {recentlyCompleted.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No recent completions</p>
          ) : (
            recentlyCompleted.map((session) => (
              <button
                key={session.id}
                className="w-full flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-1/50 px-3 py-2 hover:bg-surface-2/50 transition-colors text-left"
                onClick={() => navigate({
                  workspaceId: session.workspaceId,
                  sessionId: session.id,
                  contentView: { type: 'conversation' },
                })}
              >
                {session.status === 'done' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                )}
                <span className="text-sm text-foreground truncate flex-1">
                  {session.name || session.branch}
                </span>
                {session.stats && (session.stats.additions > 0 || session.stats.deletions > 0) && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    <span className="text-green-500">+{session.stats.additions}</span>
                    {' '}
                    <span className="text-red-500">-{session.stats.deletions}</span>
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatTimeAgo(session.updatedAt)}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Upcoming Scheduled */}
        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold text-foreground mb-2">Scheduled</h2>
          {upcomingTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No scheduled tasks</p>
          ) : (
            upcomingTasks.map((task) => (
              <button
                key={task.id}
                className="w-full flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-1/50 px-3 py-2 hover:bg-surface-2/50 transition-colors text-left"
                onClick={() => navigate({ contentView: { type: 'scheduled-task-detail', taskId: task.id } })}
              >
                <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">{task.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {task.nextRunAt ? formatCountdown(task.nextRunAt) : '—'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
