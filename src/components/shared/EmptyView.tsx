'use client';

import { useMemo } from 'react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { QuickActions } from './smart-launcher/QuickActions';
import { RecentSessions } from './smart-launcher/RecentSessions';
import { PRSummary } from './smart-launcher/PRSummary';
import { ShortcutsGrid } from './smart-launcher/ShortcutsGrid';
import { useLauncherPRSummary } from './smart-launcher/useLauncherPRSummary';

interface EmptyViewProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onNewSession: () => void;
  onCreateFromPR: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
}

export function EmptyView({
  onOpenProject,
  onCloneFromUrl,
  onNewSession,
  onCreateFromPR,
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar = true,
}: EmptyViewProps) {
  const { workspaces, sessions, selectedWorkspaceId } = useWorkspaceSelection();
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);
  const prSummary = useLauncherPRSummary();

  const recentSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => !s.archived)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [sessions]);

  const hasWorkspace = !!selectedWorkspaceId;

  return (
    <FullContentLayout
      title="Welcome"
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
    >
      <div className="h-full overflow-y-auto bg-content-background">
        <div className="max-w-2xl mx-auto px-6 py-12 stagger-children">
          {/* Quick Actions */}
          <div>
            <QuickActions
              onOpenProject={onOpenProject}
              onCloneFromUrl={onCloneFromUrl}
              onNewSession={onNewSession}
              onCreateFromPR={onCreateFromPR}
              hasWorkspace={hasWorkspace}
            />
          </div>

          {/* Recent Sessions */}
          <div className="mt-10">
            <RecentSessions
              sessions={recentSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Pull Requests Summary */}
          <div className="mt-10">
            <PRSummary
              summary={prSummary.summary}
              loading={prSummary.loading}
              error={prSummary.error}
            />
          </div>

          {/* Keyboard Shortcuts */}
          <div className="mt-10">
            <ShortcutsGrid onOpenShortcuts={onOpenShortcuts} />
          </div>
        </div>
      </div>
    </FullContentLayout>
  );
}
