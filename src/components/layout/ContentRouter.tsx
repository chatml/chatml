'use client';

import { useSettingsStore } from '@/stores/settingsStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { PRDashboard } from '@/components/dashboards/PRDashboard';
import { BranchesDashboard } from '@/components/dashboards/BranchesDashboard';
import { RepositoriesDashboard } from '@/components/dashboards/RepositoriesDashboard';
import { SessionManager } from '@/components/session-manager';
import { SkillsStore } from '@/components/skills/SkillsStore';
import { ScheduledTasksDashboard } from '@/components/scheduled/ScheduledTasksDashboard';
import { EmptyView } from '@/components/shared/EmptyView';

interface ContentRouterProps {
  selectedSessionId: string | null;
  showLeftSidebar: boolean;
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onGitHubRepos: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenWorkspaceSettings: (workspaceId: string) => void;
  onNewSession: () => void;
  onCreateSession: () => void;
}

/**
 * Routes to the appropriate full-content view based on contentView.type.
 * Handles: PR dashboard, branches, repositories, session manager, skills store,
 * and the empty welcome view when no session is selected.
 */
export function ContentRouter({
  selectedSessionId,
  showLeftSidebar,
  onOpenProject,
  onCloneFromUrl,
  onGitHubRepos,
  onOpenSettings,
  onOpenShortcuts,
  onOpenWorkspaceSettings,
  onNewSession,
  onCreateSession,
}: ContentRouterProps) {
  const contentView = useSettingsStore((s) => s.contentView);

  return (
    <ErrorBoundary section="FullContent">
      {contentView.type === 'pr-dashboard' && (
        <PRDashboard
          initialWorkspaceId={contentView.workspaceId}
        />
      )}
      {contentView.type === 'branches' && (
        <BranchesDashboard
          workspaceId={contentView.workspaceId}
        />
      )}
      {contentView.type === 'repositories' && (
        <RepositoriesDashboard
          onOpenProject={onOpenProject}
          onCloneFromUrl={onCloneFromUrl}
          onGitHubRepos={onGitHubRepos}
          onOpenSettings={onOpenSettings}
          onOpenShortcuts={onOpenShortcuts}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          showLeftSidebar={showLeftSidebar}
        />
      )}
      {contentView.type === 'session-manager' && (
        <SessionManager />
      )}
      {contentView.type === 'skills-store' && (
        <SkillsStore />
      )}
      {contentView.type === 'scheduled-tasks' && (
        <ScheduledTasksDashboard />
      )}
      {!selectedSessionId && contentView.type === 'conversation' && (
        <EmptyView
          onOpenProject={onOpenProject}
          onCloneFromUrl={onCloneFromUrl}
          onNewSession={onNewSession}
          onCreateSession={onCreateSession}
          onOpenSettings={onOpenSettings}
          onOpenShortcuts={onOpenShortcuts}
          showLeftSidebar={showLeftSidebar}
        />
      )}
    </ErrorBoundary>
  );
}
