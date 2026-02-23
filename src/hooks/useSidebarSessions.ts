import { useMemo } from 'react';
import type { Workspace, WorktreeSession, SessionTaskStatus } from '@/lib/types';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SidebarGroupBy, SidebarSortBy } from '@/stores/settingsStore';

export interface SidebarGroup {
  key: string;
  label: string;
  type: 'project' | 'status';
  count: number;
  defaultCollapsed: boolean;
  workspaceId?: string;
  statusValue?: SessionTaskStatus;
  color?: string;
  sessions: WorktreeSession[];
  subGroups?: SidebarGroup[];
}

// Status display order and weights
const STATUS_ORDER: SessionTaskStatus[] = ['in_progress', 'in_review', 'backlog', 'done', 'cancelled'];
const STATUS_WEIGHT: Record<SessionTaskStatus, number> = {
  in_progress: 0,
  in_review: 1,
  backlog: 2,
  done: 3,
  cancelled: 4,
};

const STATUS_LABELS: Record<SessionTaskStatus, string> = {
  in_progress: 'In Progress',
  in_review: 'In Review',
  backlog: 'Backlog',
  done: 'Done',
  cancelled: 'Cancelled',
};

// Statuses that are collapsed by default
const DEFAULT_COLLAPSED_STATUSES = new Set<SessionTaskStatus>(['done', 'cancelled']);

function sortSessions(sessions: WorktreeSession[], sortBy: SidebarSortBy): WorktreeSession[] {
  return [...sessions].sort((a, b) => {
    switch (sortBy) {
      case 'recent':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

      case 'status': {
        const sw = STATUS_WEIGHT[a.taskStatus] - STATUS_WEIGHT[b.taskStatus];
        if (sw !== 0) return sw;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }

      case 'priority': {
        // priority 1=urgent first, 0=none last
        const ap = a.priority === 0 ? 999 : a.priority;
        const bp = b.priority === 0 ? 999 : b.priority;
        if (ap !== bp) return ap - bp;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }

      case 'name': {
        const aName = (a.branch || a.name).toLowerCase();
        const bName = (b.branch || b.name).toLowerCase();
        return aName.localeCompare(bName);
      }

      default:
        return 0;
    }
  });
}

interface FilterOptions {
  searchTerm: string;
}

function filterSessions(sessions: WorktreeSession[], filters: FilterOptions): WorktreeSession[] {
  return sessions.filter((s) => {
    if (s.archived) return false;
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      return (
        s.name.toLowerCase().includes(term) ||
        s.branch?.toLowerCase().includes(term) ||
        s.task?.toLowerCase().includes(term)
      );
    }
    return true;
  });
}

function buildStatusGroups(
  sessions: WorktreeSession[],
  sortBy: SidebarSortBy,
  keyPrefix: string = '',
): SidebarGroup[] {
  const byStatus = new Map<SessionTaskStatus, WorktreeSession[]>();
  for (const s of sessions) {
    const list = byStatus.get(s.taskStatus) || [];
    list.push(s);
    byStatus.set(s.taskStatus, list);
  }

  const groups: SidebarGroup[] = [];
  for (const status of STATUS_ORDER) {
    const statusSessions = byStatus.get(status);
    if (!statusSessions || statusSessions.length === 0) continue;

    const key = keyPrefix ? `${keyPrefix}:status:${status}` : `status:${status}`;
    groups.push({
      key,
      label: STATUS_LABELS[status],
      type: 'status',
      count: statusSessions.length,
      defaultCollapsed: DEFAULT_COLLAPSED_STATUSES.has(status),
      statusValue: status,
      sessions: sortSessions(statusSessions, sortBy),
    });
  }
  return groups;
}

interface UseSidebarSessionsOptions {
  sessions: WorktreeSession[];
  workspaces: Workspace[];
  groupBy: SidebarGroupBy;
  sortBy: SidebarSortBy;
  filters: FilterOptions;
  workspaceColors: Record<string, string>;
  getWorkspaceColor: (id: string) => string;
}

export function useSidebarSessions({
  sessions,
  workspaces,
  groupBy,
  sortBy,
  filters,
  workspaceColors,
  getWorkspaceColor: getDefaultColor,
}: UseSidebarSessionsOptions): { groups: SidebarGroup[]; flatSessions: WorktreeSession[] } {
  return useMemo(() => {
    const filtered = filterSessions(sessions, filters);

    if (groupBy === 'none') {
      return {
        groups: [],
        flatSessions: sortSessions(filtered, sortBy),
      };
    }

    if (groupBy === 'status') {
      return {
        groups: buildStatusGroups(filtered, sortBy),
        flatSessions: [],
      };
    }

    if (groupBy === 'project') {
      const groups: SidebarGroup[] = [];
      for (const ws of workspaces) {
        const wsSessions = filtered.filter((s) => s.workspaceId === ws.id);
        if (wsSessions.length === 0 && filters.searchTerm) continue;
        const color = workspaceColors[ws.id] || getDefaultColor(ws.id);
        groups.push({
          key: `project:${ws.id}`,
          label: ws.name,
          type: 'project',
          count: wsSessions.length,
          defaultCollapsed: false,
          workspaceId: ws.id,
          color,
          sessions: sortSessions(wsSessions, sortBy),
        });
      }
      return { groups, flatSessions: [] };
    }

    // project-status
    if (groupBy === 'project-status') {
      const groups: SidebarGroup[] = [];
      for (const ws of workspaces) {
        const wsSessions = filtered.filter((s) => s.workspaceId === ws.id);
        if (wsSessions.length === 0 && filters.searchTerm) continue;
        const color = workspaceColors[ws.id] || getDefaultColor(ws.id);
        const subGroups = buildStatusGroups(wsSessions, sortBy, `project:${ws.id}`);
        groups.push({
          key: `project:${ws.id}`,
          label: ws.name,
          type: 'project',
          count: wsSessions.length,
          defaultCollapsed: false,
          workspaceId: ws.id,
          color,
          sessions: [], // sessions are in subGroups
          subGroups,
        });
      }
      return { groups, flatSessions: [] };
    }

    return { groups: [], flatSessions: [] };
  }, [sessions, workspaces, groupBy, sortBy, filters, workspaceColors, getDefaultColor]);
}

/**
 * Determine if a sidebar group is expanded.
 * Uses toggle-from-default pattern: Done/Cancelled are collapsed by default.
 * Presence in collapsedSidebarGroups means "toggled from default."
 */
export function isSidebarGroupExpanded(
  key: string,
  defaultCollapsed: boolean,
  collapsedSidebarGroups: string[],
): boolean {
  const isToggled = collapsedSidebarGroups.includes(key);
  // If default is collapsed and toggled, it's now expanded (and vice versa)
  return defaultCollapsed ? isToggled : !isToggled;
}

/**
 * Expand any collapsed sidebar groups that contain the given session.
 * Call this after auto-selecting a session (e.g. after archiving) so
 * the user can see the newly selected session in the sidebar.
 */
export function expandGroupsForSession(session: WorktreeSession): void {
  const {
    sidebarGroupBy,
    ensureSidebarGroupExpanded,
    expandWorkspace,
  } = useSettingsStore.getState();

  if (sidebarGroupBy === 'none') return;

  if (sidebarGroupBy === 'status') {
    const key = `status:${session.taskStatus}`;
    const defaultCollapsed = DEFAULT_COLLAPSED_STATUSES.has(session.taskStatus);
    ensureSidebarGroupExpanded(key, defaultCollapsed);
    return;
  }

  if (sidebarGroupBy === 'project') {
    expandWorkspace(session.workspaceId);
    return;
  }

  if (sidebarGroupBy === 'project-status') {
    expandWorkspace(session.workspaceId);
    const subKey = `project:${session.workspaceId}:status:${session.taskStatus}`;
    const defaultCollapsed = DEFAULT_COLLAPSED_STATUSES.has(session.taskStatus);
    ensureSidebarGroupExpanded(subKey, defaultCollapsed);
  }
}
