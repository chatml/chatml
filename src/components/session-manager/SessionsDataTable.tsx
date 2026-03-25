'use client';

import { useMemo, useCallback } from 'react';
import { Layers, Archive, ExternalLink, Copy, FolderOpen, Eye, Pin, PinOff, CircleDot } from 'lucide-react';
import type { WorktreeSession, Workspace, SessionTaskStatus } from '@/lib/types';
import { DataTable, type Column, type ContextMenuItem, type DisplayOptionsConfig } from '@/components/data-table';
import {
  SessionNameCell,
  WorkspaceCell,
  DiffStatsCell,
  DateCell,
  ActionsCell,
} from './cells';
import { TaskStatusSelector } from '@/components/shared/TaskStatusSelector';
import { getTaskStatusOption, TASK_STATUS_OPTIONS } from '@/lib/session-fields';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';
import { useAppStore } from '@/stores/appStore';
import { updateSession as apiUpdateSession } from '@/lib/api';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';

// Row type for the data table
interface SessionTableRow {
  session: WorktreeSession;
  workspace: Workspace;
  workspaceName: string;
  dateGroup: string;
  statusGroup: string;
  archivedGroup: string;
  taskStatusGroup: string;
}

interface SessionsDataTableProps {
  workspaces: Workspace[];
  sessions: WorktreeSession[];
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onUnarchiveSession: (sessionId: string) => void;
  onPreviewSession?: (sessionId: string) => void;
}

// Helper to get date group label
function getDateGroup(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Sort order for date groups (most recent first)
const DATE_GROUP_ORDER = ['Today', 'Yesterday'];

export function SessionsDataTable({
  workspaces,
  sessions,
  onSelectSession,
  onArchiveSession,
  onUnarchiveSession,
  onPreviewSession,
}: SessionsDataTableProps) {
  // Transform sessions into table rows
  const tableData = sessions
    .map((session) => {
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      if (!workspace) return null;

      return {
        session,
        workspace,
        workspaceName: workspace.name,
        dateGroup: getDateGroup(session.updatedAt),
        statusGroup: session.status as string,
        archivedGroup: session.archived ? 'Archived' : 'Active',
        taskStatusGroup: getTaskStatusOption(session.taskStatus).label,
      };
    })
    .filter((row): row is SessionTableRow => row !== null)
    .sort((a, b) =>
      new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime()
    );

  const storeUpdateSession = useAppStore((s) => s.updateSession);
  const toast = useToast();
  const showError = toast.error;

  const handleTaskStatusChange = useCallback((session: WorktreeSession, value: SessionTaskStatus) => {
    const prev = session.taskStatus;
    storeUpdateSession(session.id, { taskStatus: value });
    apiUpdateSession(session.workspaceId, session.id, { taskStatus: value }).catch(() => {
      storeUpdateSession(session.id, { taskStatus: prev });
      showError('Failed to update task status');
    });
  }, [storeUpdateSession, showError]);

  // Define columns
  const columns = useMemo<Column<SessionTableRow>[]>(
    () => [
      {
        id: 'workspace',
        header: 'Workspace',
        width: '140px',
        sortable: true,
        accessorKey: 'workspaceName',
        cell: (row) => <WorkspaceCell workspaceId={row.workspace.id} workspaceName={row.workspaceName} archived={row.session.archived} />,
      },
      {
        id: 'name',
        header: 'Branch',
        sortable: true,
        accessorKey: (row) => row.session.branch || row.session.name,
        cell: (row) => <SessionNameCell session={row.session} />,
      },
      {
        id: 'taskStatus',
        header: 'Status',
        width: '50px',
        sortable: true,
        accessorKey: (row) => row.session.taskStatus,
        cell: (row) => (
          <TaskStatusSelector
            value={row.session.taskStatus}
            onChange={(val) => handleTaskStatusChange(row.session, val)}
            size="sm"
          />
        ),
      },
      {
        id: 'stats',
        header: 'Changes',
        width: '100px',
        cell: (row) => <DiffStatsCell session={row.session} />,
      },
      {
        id: 'updated',
        header: 'Updated',
        width: '90px',
        sortable: true,
        accessorKey: (row) => new Date(row.session.updatedAt).getTime(),
        cell: (row) => <DateCell date={row.session.updatedAt} archived={row.session.archived} />,
      },
      {
        id: 'actions',
        header: '',
        width: '56px',
        align: 'right',
        cell: (row) => (
          <ActionsCell
            session={row.session}
            onPreview={row.session.archived && onPreviewSession ? () => onPreviewSession(row.session.id) : undefined}
          />
        ),
      },
    ],
    [onPreviewSession, handleTaskStatusChange]
  );

  // Row ID getter
  const getRowId = useCallback((row: SessionTableRow) => row.session.id, []);

  // Row click handler
  const handleRowClick = useCallback(
    (row: SessionTableRow) => {
      onSelectSession(row.workspace.id, row.session.id);
    },
    [onSelectSession]
  );

  // Context menu generator
  const handleContextMenu = useCallback(
    (row: SessionTableRow): ContextMenuItem[] => {
      // Archived sessions: reduced menu
      if (row.session.archived) {
        const items: ContextMenuItem[] = [];
        if (onPreviewSession) {
          items.push(
            {
              label: 'Preview',
              icon: <Eye className="h-4 w-4" />,
              shortcut: '↩',
              onClick: () => onPreviewSession(row.session.id),
            },
            { label: '', separator: true },
          );
        }
        items.push(
          {
            label: 'Restore',
            icon: <Archive className="h-4 w-4" />,
            onClick: () => onUnarchiveSession(row.session.id),
          },
          {
            label: 'Copy branch name',
            icon: <Copy className="h-4 w-4" />,
            shortcut: 'C',
            onClick: async () => {
              const success = await copyToClipboard(row.session.branch);
              if (!success) showError('Failed to copy to clipboard');
            },
          },
        );
        return items;
      }

      // Active sessions: full menu
      const items: ContextMenuItem[] = [
        {
          label: 'Open session',
          icon: <FolderOpen className="h-4 w-4" />,
          shortcut: '↩',
          onClick: () => onSelectSession(row.workspace.id, row.session.id),
        },
      ];

      if (row.session.prUrl) {
        items.push({
          label: 'View PR on GitHub',
          icon: <ExternalLink className="h-4 w-4" />,
          onClick: () => window.open(row.session.prUrl, '_blank'),
        });
      }

      items.push(
        { label: '', separator: true },
        {
          label: 'Set status',
          icon: <CircleDot className="h-4 w-4" />,
          children: TASK_STATUS_OPTIONS.map((option) => ({
            label: option.label,
            icon: <TaskStatusIcon status={option.value} className="h-4 w-4" />,
            checked: row.session.taskStatus === option.value,
            onClick: () => {
              const prev = row.session.taskStatus;
              storeUpdateSession(row.session.id, { taskStatus: option.value });
              apiUpdateSession(row.workspace.id, row.session.id, { taskStatus: option.value }).catch(() => {
                storeUpdateSession(row.session.id, { taskStatus: prev });
                showError('Failed to update status');
              });
            },
          })),
        },
      );

      // Pin/unpin only available for non-base sessions (base sessions have their own sidebar treatment)
      if (row.session.sessionType !== 'base') {
        items.push({
          label: row.session.pinned ? 'Unpin' : 'Pin',
          icon: row.session.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
          shortcut: 'P',
          onClick: () => {
            const newPinned = !row.session.pinned;
            storeUpdateSession(row.session.id, { pinned: newPinned });
            apiUpdateSession(row.workspace.id, row.session.id, { pinned: newPinned }).catch(() => {
              storeUpdateSession(row.session.id, { pinned: !newPinned });
              showError('Failed to update pin status');
            });
          },
        });
      }

      items.push(
        {
          label: 'Copy branch name',
          icon: <Copy className="h-4 w-4" />,
          shortcut: 'C',
          onClick: async () => {
            const success = await copyToClipboard(row.session.branch);
            if (!success) showError('Failed to copy to clipboard');
          },
        },
        { label: '', separator: true },
        {
          label: 'Archive',
          icon: <Archive className="h-4 w-4" />,
          shortcut: '⌘⇧A',
          onClick: () => onArchiveSession(row.session.id),
          variant: 'destructive',
        },
      );

      return items;
    },
    [onSelectSession, onArchiveSession, onUnarchiveSession, onPreviewSession, showError, storeUpdateSession]
  );

  // Display options configuration
  const displayOptionsConfig = useMemo<DisplayOptionsConfig>(
    () => ({
      groupingOptions: [
        { value: 'dateGroup', label: 'Date' },
        { value: 'workspaceName', label: 'Workspace' },
        { value: 'statusGroup', label: 'Status' },
        { value: 'archivedGroup', label: 'Active/Archived' },
        { value: 'taskStatusGroup', label: 'Task Status' },
      ],
      sortingOptions: [
        { value: 'updated', label: 'Updated' },
        { value: 'name', label: 'Branch name' },
        { value: 'workspace', label: 'Workspace' },
        { value: 'taskStatus', label: 'Task Status' },
      ],
      toggleableColumns: [
        { id: 'workspace', label: 'Workspace' },
        { id: 'taskStatus', label: 'Task Status' },
        { id: 'stats', label: 'Changes' },
        { id: 'updated', label: 'Updated' },
      ],
    }),
    []
  );

  // Empty state
  const emptyState = (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
        <Layers className="w-8 h-8 text-muted-foreground/40" />
      </div>
      <p className="text-base font-medium text-muted-foreground mb-1">No sessions yet</p>
      <p className="text-sm text-muted-foreground/60 max-w-sm">
        Create a new session from the sidebar to start working on a task in an isolated worktree
      </p>
    </div>
  );

  return (
    <div className="h-full">
      <DataTable
        data={tableData}
        columns={columns}
        getRowId={getRowId}
        groupBy={{
          key: 'dateGroup',
          getLabel: (key) => key,
          sortOrder: DATE_GROUP_ORDER,
          defaultCollapsed: ['Archived'],
        }}
        sortBy={{ column: 'updated', direction: 'desc' }}
        onRowClick={handleRowClick}
        onRowContextMenu={handleContextMenu}
        emptyState={emptyState}
        searchPlaceholder="Filter sessions by branch, workspace, or task..."
        displayOptionsConfig={displayOptionsConfig}
      />
    </div>
  );
}
