'use client';

import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { Button } from '@/components/ui/button';
import { RefreshCw, Layers, GitBranch, GitPullRequest, FolderGit2, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCallback, useState, useMemo } from 'react';

interface GlobalDashboardProps {
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
}

export function GlobalDashboard({
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar,
}: GlobalDashboardProps) {
  const [refreshing, setRefreshing] = useState(false);

  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const selectSession = useAppStore((s) => s.selectSession);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const setContentView = useSettingsStore((s) => s.setContentView);

  // Aggregate stats across all workspaces
  const stats = useMemo(() => {
    const activeSessions = sessions.filter((s) => s.status === 'active');
    const sessionsWithPRs = sessions.filter((s) => s.prStatus && s.prStatus !== 'none');
    const totalAdditions = sessions.reduce((sum, s) => sum + (s.stats?.additions || 0), 0);
    const totalDeletions = sessions.reduce((sum, s) => sum + (s.stats?.deletions || 0), 0);

    return {
      totalWorkspaces: workspaces.length,
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      openPRs: sessionsWithPRs.length,
      totalAdditions,
      totalDeletions,
    };
  }, [workspaces, sessions]);

  // Recent sessions across all workspaces
  const recentSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 10);
  }, [sessions]);

  const handleJumpToSession = useCallback(
    (sessionId: string, workspaceId: string) => {
      selectWorkspace(workspaceId);
      selectSession(sessionId);
      setContentView({ type: 'conversation' });
    },
    [selectWorkspace, selectSession, setContentView]
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const formatTimeAgo = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  };

  return (
    <FullContentLayout
      title="Dashboard"
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          <span className="sr-only">Refresh view</span>
        </Button>
      }
    >
      <div className="p-6 space-y-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-1 rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-blue-500/10">
                <FolderGit2 className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.totalWorkspaces}</div>
                <div className="text-xs text-muted-foreground">Repositories</div>
              </div>
            </div>
          </div>

          <div className="bg-surface-1 rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-green-500/10">
                <GitBranch className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.totalSessions}</div>
                <div className="text-xs text-muted-foreground">Sessions</div>
              </div>
            </div>
          </div>

          <div className="bg-surface-1 rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-purple-500/10">
                <GitPullRequest className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.openPRs}</div>
                <div className="text-xs text-muted-foreground">Open PRs</div>
              </div>
            </div>
          </div>

          <div className="bg-surface-1 rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-orange-500/10">
                <Activity className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.activeSessions}</div>
                <div className="text-xs text-muted-foreground">Active Now</div>
              </div>
            </div>
          </div>
        </div>

        {/* Code Changes Summary */}
        {(stats.totalAdditions > 0 || stats.totalDeletions > 0) && (
          <div className="bg-surface-1 rounded-lg p-4 border border-border/50">
            <h3 className="text-sm font-medium mb-3">Total Code Changes</h3>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold text-green-400">+{stats.totalAdditions.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">additions</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold text-red-400">-{stats.totalDeletions.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">deletions</span>
              </div>
            </div>
          </div>
        )}

        {/* Recent Activity */}
        {recentSessions.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Recent Activity
            </h2>
            <div className="space-y-2">
              {recentSessions.map((session) => {
                const workspace = workspaces.find((w) => w.id === session.workspaceId);
                return (
                  <div
                    key={session.id}
                    className="bg-surface-1 rounded-lg p-3 border border-border/50 hover:bg-surface-2 cursor-pointer transition-colors"
                    onClick={() => handleJumpToSession(session.id, session.workspaceId)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {session.prStatus && session.prStatus !== 'none' ? (
                          <GitPullRequest className="h-4 w-4 text-purple-400 shrink-0" />
                        ) : (
                          <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{session.branch || session.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {workspace?.name || 'Unknown'} {session.prNumber && `· PR #${session.prNumber}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {session.stats && (session.stats.additions > 0 || session.stats.deletions > 0) && (
                          <span className="text-xs font-mono">
                            <span className="text-green-400">+{session.stats.additions}</span>
                            {' '}
                            <span className="text-red-400">-{session.stats.deletions}</span>
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatTimeAgo(session.updatedAt || session.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-1">No activity yet</h3>
            <p className="text-sm text-muted-foreground">
              Create a session in one of your repositories to get started.
            </p>
          </div>
        )}
      </div>
    </FullContentLayout>
  );
}
