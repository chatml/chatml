import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import type { WorktreeSession } from '@/lib/types';

export type AlertType = 'merge_conflict' | 'check_failure' | 'error';
export type AlertSeverity = 'error' | 'warning';

export interface DashboardAlert {
  type: AlertType;
  sessionId: string;
  sessionName: string;
  branch: string;
  message: string;
  severity: AlertSeverity;
}

export interface DashboardStats {
  total: number;
  active: number;
  idle: number;
  done: number;
  error: number;
  additions: number;
  deletions: number;
  openPRs: number;
}

export interface DashboardData {
  sessions: WorktreeSession[];
  alerts: DashboardAlert[];
  stats: DashboardStats;
}

function computeAlerts(sessions: WorktreeSession[]): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  for (const session of sessions) {
    // Session errors (highest priority)
    if (session.status === 'error') {
      alerts.push({
        type: 'error',
        sessionId: session.id,
        sessionName: session.name,
        branch: session.branch,
        message: `Session error in ${session.branch}`,
        severity: 'error',
      });
    }

    // Merge conflicts
    if (session.hasMergeConflict) {
      alerts.push({
        type: 'merge_conflict',
        sessionId: session.id,
        sessionName: session.name,
        branch: session.branch,
        message: `Merge conflict in ${session.branch}`,
        severity: 'warning',
      });
    }

    // Check failures
    if (session.hasCheckFailures) {
      alerts.push({
        type: 'check_failure',
        sessionId: session.id,
        sessionName: session.name,
        branch: session.branch,
        message: `CI checks failing in ${session.branch}`,
        severity: 'error',
      });
    }
  }

  // Sort by severity (errors first) then by type
  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === 'error' ? -1 : 1;
    }
    return a.type.localeCompare(b.type);
  });
}

function computeStats(sessions: WorktreeSession[]): DashboardStats {
  return {
    total: sessions.length,
    active: sessions.filter((s) => s.status === 'active').length,
    idle: sessions.filter((s) => s.status === 'idle').length,
    done: sessions.filter((s) => s.status === 'done').length,
    error: sessions.filter((s) => s.status === 'error').length,
    additions: sessions.reduce((sum, s) => sum + (s.stats?.additions || 0), 0),
    deletions: sessions.reduce((sum, s) => sum + (s.stats?.deletions || 0), 0),
    openPRs: sessions.filter((s) => s.prStatus === 'open').length,
  };
}

export function useDashboardData(workspaceId: string): DashboardData {
  const allSessions = useAppStore((s) => s.sessions);

  return useMemo(() => {
    // Filter to non-archived sessions for this workspace
    const sessions = allSessions.filter(
      (s) => s.workspaceId === workspaceId && !s.archived
    );

    // Sort: pinned first, then by status (active > idle > done > error), then by updatedAt
    const sortedSessions = [...sessions].sort((a, b) => {
      // Pinned sessions first
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }

      // Then by status priority
      const statusOrder: Record<string, number> = { active: 0, idle: 1, done: 2, error: 3 };
      const statusDiff = (statusOrder[a.status] ?? 999) - (statusOrder[b.status] ?? 999);
      if (statusDiff !== 0) return statusDiff;

      // Then by most recently updated
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return {
      sessions: sortedSessions,
      alerts: computeAlerts(sessions),
      stats: computeStats(sessions),
    };
  }, [allSessions, workspaceId]);
}
