'use client';

import { useSettingsStore } from '@/stores/settingsStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { PRDashboard } from '@/components/dashboards/PRDashboard';
import { BranchesDashboard } from '@/components/dashboards/BranchesDashboard';
import { RepositoriesDashboard } from '@/components/dashboards/RepositoriesDashboard';
import { MissionControlDashboard } from '@/components/dashboards/MissionControlDashboard';
import { SessionManager } from '@/components/session-manager';
import { SkillsStore } from '@/components/skills/SkillsStore';
import { ScheduledTasksDashboard } from '@/components/scheduled/ScheduledTasksDashboard';
import { ScheduledTaskDetailView } from '@/components/scheduled/ScheduledTaskDetailView';

interface ContentRouterProps {
  selectedSessionId: string | null;
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onGitHubRepos: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenWorkspaceSettings: (workspaceId: string) => void;
}

/**
 * Routes to the appropriate full-content view based on contentView.type.
 * Handles: PR dashboard, branches, repositories, session manager, skills store,
 * and the empty welcome view when no session is selected.
 */
export function ContentRouter({
  selectedSessionId,
  onOpenProject,
  onCloneFromUrl,
  onGitHubRepos,
  onOpenSettings,
  onOpenShortcuts,
  onOpenWorkspaceSettings,
}: ContentRouterProps) {
  const contentView = useSettingsStore((s) => s.contentView);

  return (
    <ErrorBoundary section="FullContent">
      {contentView.type === 'dashboard' && (
        <MissionControlDashboard />
      )}
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
      {contentView.type === 'history' && (
        <SessionManager />
      )}
      {contentView.type === 'skills-store' && (
        <SkillsStore />
      )}
      {contentView.type === 'scheduled-tasks' && (
        <ScheduledTasksDashboard />
      )}
      {contentView.type === 'scheduled-task-detail' && (
        <ScheduledTaskDetailView taskId={contentView.taskId} />
      )}
      {!selectedSessionId && contentView.type === 'conversation' && (
        <MissionControlDashboard />
      )}
    </ErrorBoundary>
  );
}
