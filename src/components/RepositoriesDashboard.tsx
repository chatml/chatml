'use client';

import { useMemo, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/FullContentLayout';
import { DataTable, type Column, type ContextMenuItem, type FilterOption, type DisplayOptionsConfig } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import {
  FolderPlus,
  Folder,
  Globe,
  SquarePlus,
  Copy,
  Terminal,
  FolderOpen,
  Trash2,
  Settings2,
  GitBranch,
} from 'lucide-react';
import type { Workspace } from '@/lib/types';

// Linear-style color palette for workspace indicators
const WORKSPACE_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

// Get consistent color for a workspace based on its ID
function getWorkspaceColor(workspaceId: string): string {
  let hash = 0;
  for (let i = 0; i < workspaceId.length; i++) {
    hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i);
    hash |= 0;
  }
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
}

interface RepositoriesDashboardProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onQuickStart: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  showLeftSidebar?: boolean;
}

// Format time ago helper
function formatTimeAgo(dateStr: string): string {
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
}

// Icon cell component
function IconCell({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex items-center justify-center">
      <div
        className="w-3 h-3 rounded-full"
        style={{ backgroundColor: getWorkspaceColor(workspace.id) }}
      />
    </div>
  );
}

// Name cell component
function NameCell({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-medium text-sm truncate min-w-0" title={workspace.name}>
        {workspace.name}
      </span>
    </div>
  );
}

// Path cell component
function PathCell({ workspace }: { workspace: Workspace }) {
  // Shorten path by replacing home directory
  const shortenedPath = workspace.path.replace(/^\/Users\/[^/]+/, '~');

  return (
    <span className="text-sm text-muted-foreground truncate" title={workspace.path}>
      {shortenedPath}
    </span>
  );
}

// Sessions count cell
function SessionsCell({ workspace, sessionCount }: { workspace: Workspace; sessionCount: number }) {
  if (sessionCount === 0) return <span className="text-sm text-muted-foreground">-</span>;

  return (
    <span className="text-sm text-muted-foreground">
      {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
    </span>
  );
}

// Added time cell
function AddedCell({ workspace }: { workspace: Workspace }) {
  if (!workspace.createdAt) return null;
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap">
      {formatTimeAgo(workspace.createdAt)}
    </span>
  );
}

export function RepositoriesDashboard({
  onOpenProject,
  onCloneFromUrl,
  onQuickStart,
  onOpenSettings,
  onOpenShortcuts,
  onOpenWorkspaceSettings,
  showLeftSidebar,
}: RepositoriesDashboardProps) {
  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const removeWorkspace = useAppStore((s) => s.removeWorkspace);
  const setContentView = useSettingsStore((s) => s.setContentView);

  // Get session count for each workspace
  const getSessionCount = useCallback((workspaceId: string) => {
    return sessions.filter(s => s.workspaceId === workspaceId && !s.archived).length;
  }, [sessions]);

  // Workspaces with computed session count
  const workspacesWithStats = useMemo(() => {
    return workspaces.map(w => ({
      ...w,
      sessionCount: getSessionCount(w.id),
    }));
  }, [workspaces, getSessionCount]);

  // Handle row click - go to workspace dashboard
  const handleRowClick = useCallback((workspace: Workspace) => {
    selectWorkspace(workspace.id);
    setContentView({ type: 'workspace-dashboard', workspaceId: workspace.id });
  }, [selectWorkspace, setContentView]);

  // Context menu actions for a workspace
  const getWorkspaceContextMenu = useCallback((workspace: Workspace): ContextMenuItem[] => {
    return [
      {
        label: 'Open Dashboard',
        icon: <Folder className="h-4 w-4" />,
        onClick: () => {
          selectWorkspace(workspace.id);
          setContentView({ type: 'workspace-dashboard', workspaceId: workspace.id });
        },
      },
      {
        label: 'View Branches',
        icon: <GitBranch className="h-4 w-4" />,
        onClick: () => {
          selectWorkspace(workspace.id);
          setContentView({ type: 'branches', workspaceId: workspace.id });
        },
      },
      { label: '', onClick: () => {}, separator: true },
      {
        label: 'Workspace Settings',
        icon: <Settings2 className="h-4 w-4" />,
        onClick: () => onOpenWorkspaceSettings?.(workspace.id),
      },
      { label: '', onClick: () => {}, separator: true },
      {
        label: 'Open in Finder',
        icon: <FolderOpen className="h-4 w-4" />,
        onClick: () => {
          // TODO: Implement open in finder
        },
      },
      {
        label: 'Open in Terminal',
        icon: <Terminal className="h-4 w-4" />,
        onClick: () => {
          // TODO: Implement open in terminal
        },
      },
      {
        label: 'Copy Path',
        icon: <Copy className="h-4 w-4" />,
        onClick: () => navigator.clipboard.writeText(workspace.path),
      },
      { label: '', onClick: () => {}, separator: true },
      {
        label: 'Remove',
        icon: <Trash2 className="h-4 w-4" />,
        variant: 'destructive' as const,
        onClick: () => {
          // TODO: Show confirmation dialog
          removeWorkspace(workspace.id);
        },
      },
    ];
  }, [selectWorkspace, setContentView, onOpenWorkspaceSettings, removeWorkspace]);

  // Define columns for the data table
  const columns: Column<Workspace & { sessionCount: number }>[] = useMemo(() => [
    {
      id: 'icon',
      header: '',
      cell: (workspace) => <IconCell workspace={workspace} />,
      width: '40px',
    },
    {
      id: 'name',
      header: 'Repository',
      accessorKey: 'name',
      cell: (workspace) => <NameCell workspace={workspace} />,
      sortable: true,
    },
    {
      id: 'path',
      header: 'Path',
      accessorKey: 'path',
      cell: (workspace) => <PathCell workspace={workspace} />,
    },
    {
      id: 'sessions',
      header: 'Sessions',
      accessorKey: (w) => w.sessionCount,
      cell: (workspace) => <SessionsCell workspace={workspace} sessionCount={workspace.sessionCount} />,
      sortable: true,
      width: '100px',
    },
    {
      id: 'added',
      header: 'Added',
      accessorKey: 'createdAt',
      cell: (workspace) => <AddedCell workspace={workspace} />,
      sortable: true,
      width: '100px',
    },
  ], []);

  // Filter options
  const filterOptions: FilterOption[] = useMemo(() => [
    { column: 'name', label: 'Name', type: 'text' },
    { column: 'path', label: 'Path', type: 'text' },
  ], []);

  // Display options configuration
  const displayOptionsConfig: DisplayOptionsConfig = useMemo(() => ({
    groupingOptions: [],
    sortingOptions: [
      { value: 'name', label: 'Name' },
      { value: 'createdAt', label: 'Date added' },
      { value: 'sessionCount', label: 'Sessions' },
    ],
    toggleableColumns: [
      { id: 'path', label: 'Path' },
      { id: 'sessions', label: 'Sessions' },
      { id: 'added', label: 'Added' },
    ],
  }), []);

  return (
    <FullContentLayout
      title={
        <span className="flex items-center gap-2">
          Repositories
          <span className="text-sm font-normal text-muted-foreground">
            {workspaces.length} {workspaces.length === 1 ? 'repository' : 'repositories'}
          </span>
        </span>
      }
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
      headerActions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={onOpenProject}
          >
            <Folder className="h-3.5 w-3.5" />
            Open
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={onCloneFromUrl}
          >
            <Globe className="h-3.5 w-3.5" />
            Clone
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={onQuickStart}
          >
            <SquarePlus className="h-3.5 w-3.5" />
            Quick Start
          </Button>
        </div>
      }
    >
      <div className="pt-2 pb-4">
        {workspaces.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FolderPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No repositories</p>
            <p className="text-sm mt-1">Add a repository to get started.</p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={onOpenProject}>
                <Folder className="h-4 w-4" />
                Open Project
              </Button>
              <Button variant="outline" size="sm" onClick={onCloneFromUrl}>
                <Globe className="h-4 w-4" />
                Clone from URL
              </Button>
            </div>
          </div>
        ) : (
          <DataTable
            data={workspacesWithStats}
            columns={columns}
            getRowId={(workspace) => workspace.id}
            sortBy={{ column: 'name', direction: 'asc' }}
            onRowClick={handleRowClick}
            onRowContextMenu={getWorkspaceContextMenu}
            filterOptions={filterOptions}
            displayOptionsConfig={displayOptionsConfig}
            searchPlaceholder="Search repositories..."
            selectable
            emptyState={
              <div className="text-center py-12 text-muted-foreground">
                <FolderPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No repositories found</p>
                <p className="text-sm mt-1">Try adjusting your search or filters.</p>
              </div>
            }
          />
        )}
      </div>
    </FullContentLayout>
  );
}
