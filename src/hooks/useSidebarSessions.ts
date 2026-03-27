import { useMemo } from 'react';
import type { Workspace, WorktreeSession, SessionTaskStatus, SprintPhase } from '@/lib/types';
import { SPRINT_PHASES } from '@/lib/types';
import { useSettingsStore, applyStatusGroupOrder } from '@/stores/settingsStore';
import type { SidebarGroupBy, SidebarSortBy } from '@/stores/settingsStore';

export interface SidebarGroup {
  key: string;
  label: string;
  type: 'project' | 'status' | 'sprint';
  count: number;
  defaultCollapsed: boolean;
  workspaceId?: string;
  statusValue?: SessionTaskStatus;
  sprintPhaseValue?: SprintPhase | null;
  color?: string;
  baseSessions?: WorktreeSession[];
  sessions: WorktreeSession[];
  subGroups?: SidebarGroup[];
}

/** Returns true for sessions that operate on the main repo directory (not a worktree). */
function isMainRepoSession(s: WorktreeSession): boolean {
  return s.sessionType === 'base';
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

// Sprint phase display order: "Not Started" first, then canonical phase order
const SPRINT_PHASE_ORDER: (SprintPhase | 'not_started')[] = ['not_started', ...SPRINT_PHASES];

const SPRINT_PHASE_LABELS: Record<SprintPhase | 'not_started', string> = {
  not_started: 'Not Started',
  think: 'Think',
  plan: 'Plan',
  build: 'Build',
  review: 'Review',
  test: 'Test',
  ship: 'Ship',
  reflect: 'Reflect',
};

const DEFAULT_COLLAPSED_SPRINT_PHASES = new Set<SprintPhase | 'not_started'>(['reflect']);

function buildSprintPhaseGroups(
  sessions: WorktreeSession[],
  sortBy: SidebarSortBy,
  keyPrefix: string = '',
): SidebarGroup[] {
  const byPhase = new Map<string, WorktreeSession[]>();
  for (const s of sessions) {
    const phase = s.sprintPhase ?? 'not_started';
    const list = byPhase.get(phase) || [];
    list.push(s);
    byPhase.set(phase, list);
  }

  const groups: SidebarGroup[] = [];
  for (const phase of SPRINT_PHASE_ORDER) {
    const phaseSessions = byPhase.get(phase);
    if (!phaseSessions || phaseSessions.length === 0) continue;

    const key = keyPrefix ? `${keyPrefix}:sprint:${phase}` : `sprint:${phase}`;
    groups.push({
      key,
      label: SPRINT_PHASE_LABELS[phase],
      type: 'sprint',
      count: phaseSessions.length,
      defaultCollapsed: DEFAULT_COLLAPSED_SPRINT_PHASES.has(phase),
      sprintPhaseValue: phase === 'not_started' ? null : phase as SprintPhase,
      sessions: sortSessions(phaseSessions, sortBy),
    });
  }
  return groups;
}

/** When filtering to a single project, project-level grouping is redundant. */
function downgradeGroupBy(groupBy: SidebarGroupBy): SidebarGroupBy {
  if (groupBy === 'project') return 'none';
  if (groupBy === 'project-status') return 'status';
  if (groupBy === 'project-sprint') return 'sprint';
  return groupBy;
}

interface UseSidebarSessionsOptions {
  sessions: WorktreeSession[];
  workspaces: Workspace[];
  groupBy: SidebarGroupBy;
  sortBy: SidebarSortBy;
  filters: FilterOptions;
  projectFilter: string | null;
  workspaceColors: Record<string, string>;
  getWorkspaceColor: (id: string) => string;
  statusGroupOrder: SessionTaskStatus[];
}

export function useSidebarSessions({
  sessions,
  workspaces,
  groupBy,
  sortBy,
  filters,
  projectFilter,
  workspaceColors,
  getWorkspaceColor: getDefaultColor,
  statusGroupOrder,
}: UseSidebarSessionsOptions): { groups: SidebarGroup[]; flatSessions: WorktreeSession[]; baseSessions: WorktreeSession[]; pinnedSessions: WorktreeSession[]; effectiveGroupBy: SidebarGroupBy } {
  return useMemo(() => {
    // When filtering to a single project, pre-filter sessions and downgrade groupBy
    const effectiveSessions = projectFilter
      ? sessions.filter((s) => s.workspaceId === projectFilter)
      : sessions;
    const effectiveGroupBy: SidebarGroupBy = projectFilter
      ? downgradeGroupBy(groupBy)
      : groupBy;

    const filtered = filterSessions(effectiveSessions, filters);

    // Partition pinned sessions. Base sessions are excluded from pinning — they have
    // their own sidebar treatment. The pin menu item is hidden for base sessions in
    // SessionsDataTable. Note: pinned sessions honour the search filter since they
    // are derived from `filtered` (which applies searchTerm).
    const pinned = filtered.filter(s => s.pinned && !isMainRepoSession(s));
    const unpinned = filtered.filter(s => !s.pinned || isMainRepoSession(s));
    const pinnedSessions = sortSessions(pinned, sortBy);

    if (effectiveGroupBy === 'none') {
      const base = sortSessions(unpinned.filter(isMainRepoSession), sortBy);
      const regular = unpinned.filter(s => !isMainRepoSession(s));
      return {
        groups: [],
        flatSessions: sortSessions(regular, sortBy),
        baseSessions: base,
        pinnedSessions,
        effectiveGroupBy,
      };
    }

    if (effectiveGroupBy === 'status') {
      const base = sortSessions(unpinned.filter(isMainRepoSession), sortBy);
      const regular = unpinned.filter(s => !isMainRepoSession(s));
      return {
        groups: applyStatusGroupOrder(buildStatusGroups(regular, sortBy), statusGroupOrder),
        flatSessions: [],
        baseSessions: base,
        pinnedSessions,
        effectiveGroupBy,
      };
    }

    if (effectiveGroupBy === 'sprint') {
      const base = sortSessions(unpinned.filter(isMainRepoSession), sortBy);
      const regular = unpinned.filter(s => !isMainRepoSession(s));
      return {
        groups: buildSprintPhaseGroups(regular, sortBy),
        flatSessions: [],
        baseSessions: base,
        pinnedSessions,
        effectiveGroupBy,
      };
    }

    // For project-based grouping, bucket sessions by workspace
    const byWorkspace = new Map<string, WorktreeSession[]>();
    for (const s of unpinned) {
      const list = byWorkspace.get(s.workspaceId);
      if (list) list.push(s);
      else byWorkspace.set(s.workspaceId, [s]);
    }

    if (effectiveGroupBy === 'project') {
      const groups: SidebarGroup[] = [];
      for (const ws of workspaces) {
        const wsSessions = byWorkspace.get(ws.id) ?? [];
        if (wsSessions.length === 0 && filters.searchTerm) continue;
        const color = workspaceColors[ws.id] || getDefaultColor(ws.id);
        const base = wsSessions.filter(isMainRepoSession);
        const regular = wsSessions.filter(s => !isMainRepoSession(s));
        groups.push({
          key: `project:${ws.id}`,
          label: ws.name,
          type: 'project',
          count: wsSessions.length,
          defaultCollapsed: false,
          workspaceId: ws.id,
          color,
          baseSessions: base,
          sessions: sortSessions(regular, sortBy),
        });
      }
      return { groups, flatSessions: [], baseSessions: [], pinnedSessions, effectiveGroupBy };
    }

    // project-status
    if (effectiveGroupBy === 'project-status') {
      const groups: SidebarGroup[] = [];
      for (const ws of workspaces) {
        const wsSessions = byWorkspace.get(ws.id) ?? [];
        if (wsSessions.length === 0 && filters.searchTerm) continue;
        const color = workspaceColors[ws.id] || getDefaultColor(ws.id);
        const base = wsSessions.filter(isMainRepoSession);
        const regular = wsSessions.filter(s => !isMainRepoSession(s));
        const subGroups = applyStatusGroupOrder(buildStatusGroups(regular, sortBy, `project:${ws.id}`), statusGroupOrder);
        groups.push({
          key: `project:${ws.id}`,
          label: ws.name,
          type: 'project',
          count: wsSessions.length,
          defaultCollapsed: false,
          workspaceId: ws.id,
          color,
          baseSessions: base,
          sessions: [], // sessions are in subGroups
          subGroups,
        });
      }
      return { groups, flatSessions: [], baseSessions: [], pinnedSessions, effectiveGroupBy };
    }

    // project-sprint
    if (effectiveGroupBy === 'project-sprint') {
      const groups: SidebarGroup[] = [];
      for (const ws of workspaces) {
        const wsSessions = byWorkspace.get(ws.id) ?? [];
        if (wsSessions.length === 0 && filters.searchTerm) continue;
        const color = workspaceColors[ws.id] || getDefaultColor(ws.id);
        const base = wsSessions.filter(isMainRepoSession);
        const regular = wsSessions.filter(s => !isMainRepoSession(s));
        const subGroups = buildSprintPhaseGroups(regular, sortBy, `project:${ws.id}`);
        groups.push({
          key: `project:${ws.id}`,
          label: ws.name,
          type: 'project',
          count: wsSessions.length,
          defaultCollapsed: false,
          workspaceId: ws.id,
          color,
          baseSessions: base,
          sessions: [],
          subGroups,
        });
      }
      return { groups, flatSessions: [], baseSessions: [], pinnedSessions, effectiveGroupBy };
    }

    return { groups: [], flatSessions: [], baseSessions: [], pinnedSessions, effectiveGroupBy };
  }, [sessions, workspaces, groupBy, sortBy, filters, projectFilter, workspaceColors, getDefaultColor, statusGroupOrder]);
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

  // Base sessions live outside status/sprint groups in the sidebar.
  // For project-based grouping they sit at the project level, so only expand the workspace.
  if (isMainRepoSession(session)) {
    if (sidebarGroupBy === 'project' || sidebarGroupBy === 'project-status' || sidebarGroupBy === 'project-sprint') {
      expandWorkspace(session.workspaceId);
    }
    return;
  }

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
    return;
  }

  if (sidebarGroupBy === 'sprint') {
    const phaseKey = session.sprintPhase ?? 'not_started';
    const key = `sprint:${phaseKey}`;
    const defaultCollapsed = DEFAULT_COLLAPSED_SPRINT_PHASES.has(phaseKey);
    ensureSidebarGroupExpanded(key, defaultCollapsed);
    return;
  }

  if (sidebarGroupBy === 'project-sprint') {
    expandWorkspace(session.workspaceId);
    const phaseKey = session.sprintPhase ?? 'not_started';
    const subKey = `project:${session.workspaceId}:sprint:${phaseKey}`;
    const defaultCollapsed = DEFAULT_COLLAPSED_SPRINT_PHASES.has(phaseKey);
    ensureSidebarGroupExpanded(subKey, defaultCollapsed);
    return;
  }
}
