'use client';

import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/FullContentLayout';
import { useDashboardData } from './useDashboardData';
import { AlertsSection } from './AlertsSection';
import { StatsOverview } from './StatsOverview';
import { SessionCard } from './SessionCard';
import { DashboardCharts } from './DashboardCharts';
import { Button } from '@/components/ui/button';
import { RefreshCw, Layers, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCallback, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BlockErrorFallback, CardErrorFallback } from '@/components/ErrorFallbacks';

interface WorkspaceDashboardProps {
  workspaceId: string;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
  onCreateSession?: () => void;
}

export function WorkspaceDashboard({
  workspaceId,
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar,
  onCreateSession,
}: WorkspaceDashboardProps) {
  const [refreshing, setRefreshing] = useState(false);

  const selectSession = useAppStore((s) => s.selectSession);
  const setContentView = useSettingsStore((s) => s.setContentView);
  const workspace = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId));

  const { sessions, alerts, stats } = useDashboardData(workspaceId);

  const handleJumpToSession = useCallback(
    (sessionId: string) => {
      selectSession(sessionId);
      setContentView({ type: 'conversation' });
    },
    [selectSession, setContentView]
  );

  const handleRefresh = useCallback(() => {
    // Data is kept fresh via WebSocket - this button provides visual feedback
    // confirming the view is current. The spinning animation reassures users
    // without requiring an actual network call.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

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
          <span className="sr-only">Refresh view (data synced automatically)</span>
        </Button>
      }
    >
      <div className="p-4 space-y-6">
        {/* Workspace name header */}
        {workspace && (
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{workspace.name}</h2>
            {onCreateSession && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={onCreateSession}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Session
              </Button>
            )}
          </div>
        )}

        {/* Alerts section - only shown when there are alerts */}
        <AlertsSection alerts={alerts} onAlertClick={handleJumpToSession} />

        {/* Stats overview */}
        {stats.total > 0 && <StatsOverview stats={stats} />}

        {/* Charts section */}
        {sessions.length > 0 && (
          <ErrorBoundary
            section="DashboardCharts"
            fallback={<BlockErrorFallback title="Unable to load charts" className="h-[200px]" />}
          >
            <DashboardCharts sessions={sessions} />
          </ErrorBoundary>
        )}

        {/* Sessions list */}
        {sessions.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Sessions
            </h2>
            <div className="space-y-2">
              {sessions.map((session) => (
                <ErrorBoundary
                  key={session.id}
                  section="SessionCard"
                  fallback={<CardErrorFallback message="Error loading session" />}
                >
                  <SessionCard
                    session={session}
                    onJumpToSession={() => handleJumpToSession(session.id)}
                  />
                </ErrorBoundary>
              ))}
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-1">No sessions yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create a session to start working with AI in an isolated git worktree.
            </p>
            {onCreateSession && (
              <Button onClick={onCreateSession}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Session
              </Button>
            )}
          </div>
        )}
      </div>
    </FullContentLayout>
  );
}
