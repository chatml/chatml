'use client';

import { useMemo } from 'react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useSettingsStore } from '@/stores/settingsStore';
import { isMacOS } from '@/lib/platform';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { QuickActions } from './smart-launcher/QuickActions';
import { RecentSessions } from './smart-launcher/RecentSessions';
import { PRSummary } from './smart-launcher/PRSummary';
import { LiveActivityStrip } from './smart-launcher/LiveActivityStrip';
import { getGreeting } from './smart-launcher/useGreeting';
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
  const greeting = getGreeting();

  const nonArchivedSessions = useMemo(
    () => sessions.filter((s) => !s.archived),
    [sessions]
  );

  const recentSessions = useMemo(
    () =>
      [...nonArchivedSessions]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [nonArchivedSessions]
  );

  const hasWorkspace = !!selectedWorkspaceId;
  const modKey = isMacOS() ? '⌘' : 'Ctrl+';

  return (
    <FullContentLayout
      title="Home"
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
    >
      <div className="h-full overflow-y-auto bg-content-background">
        <div className="max-w-2xl mx-auto px-6 pt-10 pb-16 stagger-children">
          {/* Greeting */}
          <div className="mb-8">
            <h2 className="font-display text-[1.75rem] leading-[1.25] tracking-display text-foreground">
              {greeting}
            </h2>
          </div>

          {/* Hero Action Grid */}
          <div className="mb-10">
            <QuickActions
              onOpenProject={onOpenProject}
              onCloneFromUrl={onCloneFromUrl}
              onNewSession={onNewSession}
              onCreateFromPR={onCreateFromPR}
              hasWorkspace={hasWorkspace}
            />
          </div>

          {/* Live Activity Strip */}
          <div className="mb-10">
            <LiveActivityStrip
              sessions={nonArchivedSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Recent Sessions */}
          <div className="mb-10">
            <RecentSessions
              sessions={recentSessions}
              workspaces={workspaces}
              workspaceColors={workspaceColors}
            />
          </div>

          {/* Pull Requests Summary */}
          <div className="mb-8">
            <PRSummary
              summary={prSummary.summary}
              loading={prSummary.loading}
              error={prSummary.error}
            />
          </div>

          {/* Cmd+K hint */}
          <p className="text-center text-xs text-muted-foreground/60 pt-4">
            Press{' '}
            <kbd className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs">
              {modKey}K
            </kbd>{' '}
            for commands
          </p>
        </div>
      </div>
    </FullContentLayout>
  );
}
