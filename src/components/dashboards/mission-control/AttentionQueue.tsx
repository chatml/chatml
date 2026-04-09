'use client';

import { useMemo, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useScheduledTaskStore } from '@/stores/scheduledTaskStore';
import { navigate } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  X,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/format';

type AttentionSeverity = 'p0' | 'p1' | 'p2-green' | 'p2-blue';

interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  type: string;
  label: string;
  sessionId?: string;
  workspaceId: string;
  workspaceName: string;
  branch: string;
  description: string;
  timestamp: string;
  primaryAction: { label: string; handler: () => void };
}

const DISMISS_STORAGE_KEY = 'dashboard-dismissed-attention';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return new Set();
    const entries: { id: string; at: number }[] = JSON.parse(raw);
    const now = Date.now();
    const valid = entries.filter((e) => now - e.at < DISMISS_TTL_MS);
    // Clean up expired
    if (valid.length !== entries.length) {
      localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(valid));
    }
    return new Set(valid.map((e) => e.id));
  } catch {
    return new Set();
  }
}

function dismissItem(id: string) {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    const entries: { id: string; at: number }[] = raw ? JSON.parse(raw) : [];
    entries.push({ id, at: Date.now() });
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore
  }
}

const severityConfig: Record<AttentionSeverity, { icon: typeof AlertCircle; color: string; bg: string }> = {
  'p0': { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  'p1': { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  'p2-green': { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
  'p2-blue': { icon: Clock, color: 'text-blue-400', bg: 'bg-blue-400/10' },
};

export function AttentionQueue() {
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const taskRuns = useScheduledTaskStore((s) => s.runs);
  const [dismissed, setDismissed] = useState(() => getDismissedIds());

  const wsMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces) m.set(w.id, w.name);
    return m;
  }, [workspaces]);

  const items = useMemo<AttentionItem[]>(() => {
    const result: AttentionItem[] = [];
    const TWO_HOURS = 2 * 60 * 60 * 1000;

    for (const s of sessions) {
      if (s.archived) continue;
      const wsName = wsMap.get(s.workspaceId) ?? 'Unknown';

      // P0: Session errors
      if (s.status === 'error') {
        result.push({
          id: `error-${s.id}`,
          severity: 'p0',
          type: 'Session Error',
          label: 'Session Error',
          sessionId: s.id,
          workspaceId: s.workspaceId,
          workspaceName: wsName,
          branch: s.branch,
          description: 'Agent encountered an error',
          timestamp: s.updatedAt,
          primaryAction: {
            label: 'Go to Session',
            handler: () => navigate({ workspaceId: s.workspaceId, sessionId: s.id, contentView: { type: 'conversation' } }),
          },
        });
      }

      // P0: CI failures
      if (s.checkStatus === 'failure' && s.prStatus === 'open') {
        result.push({
          id: `ci-${s.id}`,
          severity: 'p0',
          type: 'CI Failed',
          label: 'CI Failed',
          sessionId: s.id,
          workspaceId: s.workspaceId,
          workspaceName: wsName,
          branch: s.branch,
          description: s.prTitle || 'CI checks are failing',
          timestamp: s.updatedAt,
          primaryAction: {
            label: 'Go to PR',
            handler: () => {
              if (s.prUrl) window.open(s.prUrl, '_blank');
              else navigate({ workspaceId: s.workspaceId, sessionId: s.id, contentView: { type: 'conversation' } });
            },
          },
        });
      }

      // P1: Merge conflicts
      if (s.hasMergeConflict) {
        result.push({
          id: `conflict-${s.id}`,
          severity: 'p1',
          type: 'Merge Conflict',
          label: 'Merge Conflict',
          sessionId: s.id,
          workspaceId: s.workspaceId,
          workspaceName: wsName,
          branch: s.branch,
          description: 'Branch has conflicts with target',
          timestamp: s.updatedAt,
          primaryAction: {
            label: 'Go to Session',
            handler: () => navigate({ workspaceId: s.workspaceId, sessionId: s.id, contentView: { type: 'conversation' } }),
          },
        });
      }

      // P2-green: Ready to merge
      if (s.checkStatus === 'success' && s.prStatus === 'open' && !s.hasMergeConflict) {
        result.push({
          id: `merge-${s.id}`,
          severity: 'p2-green',
          type: 'Ready to Merge',
          label: 'Ready to Merge',
          sessionId: s.id,
          workspaceId: s.workspaceId,
          workspaceName: wsName,
          branch: s.branch,
          description: s.prTitle || 'All checks passed',
          timestamp: s.updatedAt,
          primaryAction: {
            label: 'Merge PR',
            handler: () => {
              if (s.prUrl) window.open(s.prUrl, '_blank');
              else navigate({ workspaceId: s.workspaceId, sessionId: s.id, contentView: { type: 'conversation' } });
            },
          },
        });
      }

      // P2-blue: Stale sessions
      if (
        s.status === 'idle' &&
        !['done', 'cancelled'].includes(s.taskStatus) &&
        Date.now() - new Date(s.updatedAt).getTime() > TWO_HOURS
      ) {
        result.push({
          id: `stale-${s.id}`,
          severity: 'p2-blue',
          type: 'Stale Session',
          label: 'Stale Session',
          sessionId: s.id,
          workspaceId: s.workspaceId,
          workspaceName: wsName,
          branch: s.branch,
          description: `Idle for ${formatTimeAgo(s.updatedAt)}`,
          timestamp: s.updatedAt,
          primaryAction: {
            label: 'Resume',
            handler: () => navigate({ workspaceId: s.workspaceId, sessionId: s.id, contentView: { type: 'conversation' } }),
          },
        });
      }
    }

    // P1: Scheduled task failures (recent 24h)
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const runs of Object.values(taskRuns)) {
      for (const run of runs) {
        if (
          (run.status === 'failed' || run.status === 'skipped') &&
          new Date(run.triggeredAt).getTime() > dayAgo
        ) {
          result.push({
            id: `task-${run.id}`,
            severity: 'p1',
            type: run.status === 'failed' ? 'Task Failed' : 'Task Skipped',
            label: run.status === 'failed' ? 'Task Failed' : 'Task Skipped',
            workspaceId: '',
            workspaceName: '',
            branch: '',
            description: run.errorMessage || `Task ${run.status}`,
            timestamp: run.triggeredAt,
            primaryAction: {
              label: 'View Tasks',
              handler: () => navigate({ contentView: { type: 'scheduled-tasks' } }),
            },
          });
        }
      }
    }

    // Sort by severity
    const severityOrder: Record<AttentionSeverity, number> = { 'p0': 0, 'p1': 1, 'p2-green': 2, 'p2-blue': 3 };
    result.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return result;
  }, [sessions, wsMap, taskRuns]);

  const visibleItems = useMemo(
    () => items.filter((item) => !dismissed.has(item.id)),
    [items, dismissed],
  );

  const handleDismiss = useCallback((id: string) => {
    dismissItem(id);
    setDismissed((prev) => new Set([...prev, id]));
  }, []);

  if (visibleItems.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-surface-1/50 p-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/10">
            <Check className="w-4 h-4 text-green-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">All clear</p>
            <p className="text-xs text-muted-foreground">No items need your attention right now</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 mb-2">
        <AlertCircle className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Needs Attention</h2>
        <span className="text-xs text-muted-foreground bg-surface-2 px-1.5 py-0.5 rounded-full">
          {visibleItems.length}
        </span>
      </div>
      {visibleItems.map((item) => {
        const config = severityConfig[item.severity];
        const Icon = config.icon;
        return (
          <div
            key={item.id}
            className="group flex items-center gap-3 rounded-lg border border-border/50 bg-surface-1/50 px-3 py-2.5 hover:bg-surface-2/50 transition-colors"
          >
            <div className={cn('flex items-center justify-center w-7 h-7 rounded-full shrink-0', config.bg)}>
              <Icon className={cn('w-3.5 h-3.5', config.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
                {item.branch && (
                  <>
                    <span className="text-xs text-muted-foreground/50">·</span>
                    <span className="text-xs text-muted-foreground truncate">{item.branch}</span>
                  </>
                )}
                {item.workspaceName && (
                  <>
                    <span className="text-xs text-muted-foreground/50">·</span>
                    <span className="text-xs text-muted-foreground truncate">{item.workspaceName}</span>
                  </>
                )}
              </div>
              <p className="text-sm text-foreground truncate">{item.description}</p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{formatTimeAgo(item.timestamp)}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={item.primaryAction.handler}
            >
              {item.primaryAction.label}
            </Button>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-3 transition-opacity shrink-0"
              onClick={() => handleDismiss(item.id)}
              title="Dismiss for 24h"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
