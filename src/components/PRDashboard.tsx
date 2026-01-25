'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/FullContentLayout';
import { PRCard } from '@/components/pr-dashboard/PRCard';
import { getPRs, type PRDashboardItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RefreshCw, Loader2, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PRDashboardProps {
  initialWorkspaceId?: string;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
}

export function PRDashboard({
  initialWorkspaceId,
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar,
}: PRDashboardProps) {
  const [prs, setPRs] = useState<PRDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(
    initialWorkspaceId || 'all'
  );

  const workspaces = useAppStore((s) => s.workspaces);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const selectSession = useAppStore((s) => s.selectSession);
  const setContentView = useSettingsStore((s) => s.setContentView);

  // Track if this is the first render to avoid duplicate fetches
  const isFirstRender = useRef(true);

  const fetchPRs = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const workspaceId = workspaceFilter === 'all' ? undefined : workspaceFilter;
      const data = await getPRs(workspaceId);
      setPRs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PRs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceFilter]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchPRs();

    // Auto-refresh every 60 seconds
    const interval = setInterval(() => {
      fetchPRs(true);
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchPRs]);

  // Refresh when filter changes (skip initial render since useEffect above handles it)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    fetchPRs();
  }, [workspaceFilter, fetchPRs]);

  const handleRefresh = () => {
    fetchPRs(true);
  };

  const handleJumpToSession = (workspaceId: string, sessionId: string) => {
    // Navigate to the session's conversation view
    selectWorkspace(workspaceId);
    selectSession(sessionId);
    setContentView({ type: 'conversation' });
  };

  // Group PRs by status
  const openPRs = prs.filter((pr) => pr.state === 'open' && !pr.isDraft);
  const draftPRs = prs.filter((pr) => pr.isDraft);

  return (
    <FullContentLayout
      title="Pull Requests"
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filter:</span>
            <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
              <SelectTrigger className="w-[180px] h-8">
                <SelectValue placeholder="All Repos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Repos</SelectItem>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Open ({openPRs.length})</span>
            <span>Draft ({draftPRs.length})</span>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">
            <p>{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchPRs()}>
              Try Again
            </Button>
          </div>
        ) : prs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <GitPullRequest className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No pull requests</p>
            <p className="text-sm mt-1">
              {workspaceFilter === 'all'
                ? 'No open pull requests found across your workspaces.'
                : 'No open pull requests found for this workspace.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {prs.map((pr) => (
              <PRCard
                key={`${pr.workspaceId}-${pr.number}`}
                pr={pr}
                onJumpToSession={
                  pr.sessionId
                    ? () => handleJumpToSession(pr.workspaceId, pr.sessionId!)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </FullContentLayout>
  );
}
