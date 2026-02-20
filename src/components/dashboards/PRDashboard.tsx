'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { DataTable, type Column, type ContextMenuItem, type FilterOption, type DisplayOptionsConfig } from '@/components/data-table';
import { getPRs, sendSessionMessage, type PRDashboardItem } from '@/lib/api';
import { computePRStatus, STATUS_ORDER, STATUS_LABELS, type PRWithStatus, type PRStatusCategory } from '@/lib/pr-utils';
import { Button } from '@/components/ui/button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isTauri, copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { getLabelStyles } from '@/lib/label-colors';
import { useTheme } from 'next-themes';
import {
  RefreshCw,
  Loader2,
  GitPullRequest,
  GitPullRequestDraft,
  ChevronRight,
  Check,
  CheckCircle,
  X,
  Clock,
  AlertTriangle,
  ExternalLink,
  Copy,
  ArrowRight,
  GitMerge,
  Wrench,
  GitBranch,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';
import { PRNumberBadge } from '@/components/shared/PRNumberBadge';

interface PRDashboardProps {
  initialWorkspaceId?: string;
}

// Helper to open URLs in browser
async function openInBrowser(url: string) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
  } else {
    window.open(url, '_blank');
  }
}

// Title cell component
function TitleCell({ pr }: { pr: PRWithStatus }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-base truncate" title={pr.title}>
        {pr.title}
      </span>
      {pr.labels?.map((label) => {
        const labelStyles = getLabelStyles(label.color, isDark);
        return (
          <span
            key={label.name}
            className="text-sm px-1.5 py-0.5 rounded shrink-0 font-medium whitespace-nowrap"
            style={{
              backgroundColor: labelStyles.backgroundColor,
              color: labelStyles.color,
              border: `1px solid ${labelStyles.borderColor}`,
            }}
          >
            {label.name}
          </span>
        );
      })}
    </div>
  );
}

// Branch cell component
function BranchCell({ pr }: { pr: PRWithStatus }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-700 dark:text-purple-300/70 font-mono truncate" title={pr.branch}>
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        {pr.branch}
      </span>
    </div>
  );
}

// Format duration for display
function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

// Get check status icon and color
function getCheckStatusDisplay(status: string, conclusion: string) {
  if (status === 'in_progress' || status === 'queued') {
    return { Icon: Clock, color: 'text-yellow-500' };
  }
  switch (conclusion) {
    case 'success':
      return { Icon: Check, color: 'text-green-500' };
    case 'failure':
    case 'timed_out':
    case 'cancelled':
      return { Icon: X, color: 'text-red-500' };
    case 'skipped':
    case 'neutral':
      return { Icon: Check, color: 'text-muted-foreground' };
    default:
      return { Icon: Clock, color: 'text-yellow-500' };
  }
}

// Checks cell component with hover popover
function ChecksCell({ pr }: { pr: PRWithStatus }) {
  if (pr.checksTotal === 0) {
    return <span className="text-sm text-muted-foreground">No checks</span>;
  }

  const hasFailures = pr.checksFailed > 0;
  const hasPending = pr.pendingCount > 0;

  let Icon = Check;
  let color = 'text-green-500';
  let text = `${pr.checksTotal}/${pr.checksTotal}`;

  if (hasFailures) {
    Icon = X;
    color = 'text-red-500';
    text = `${pr.checksPassed}/${pr.checksTotal}`;
  } else if (hasPending) {
    Icon = Clock;
    color = 'text-yellow-500';
    text = `${pr.checksPassed}/${pr.checksTotal}`;
  }

  // Sort checks: failures first, then pending, then success
  const sortedChecks = [...pr.checkDetails].sort((a, b) => {
    const getOrder = (check: typeof a) => {
      if (check.conclusion === 'failure' || check.conclusion === 'timed_out') return 0;
      if (check.status === 'in_progress' || check.status === 'queued') return 1;
      if (check.conclusion === 'success') return 2;
      return 3;
    };
    return getOrder(a) - getOrder(b);
  });

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn('flex items-center gap-1.5 text-sm cursor-pointer hover:underline underline-offset-2', color)}
        >
          <Icon className="h-4 w-4" />
          {text}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0">
        <div className="px-3 py-2 border-b border-border/50">
          <div className="text-xs font-medium text-foreground">
            CI Checks
          </div>
          <div className="text-xs text-muted-foreground">
            {pr.checksPassed} passed, {pr.checksFailed} failed
            {pr.pendingCount > 0 && `, ${pr.pendingCount} pending`}
          </div>
        </div>
        <div className="max-h-[200px] overflow-y-auto">
          {sortedChecks.map((check) => {
            const { Icon: StatusIcon, color: statusColor } = getCheckStatusDisplay(check.status, check.conclusion);
            return (
              <div
                key={check.name}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-1"
              >
                <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', statusColor)} />
                <span className="text-xs truncate flex-1" title={check.name}>
                  {check.name}
                </span>
                {check.durationSeconds && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDuration(check.durationSeconds)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

// Session cell component
function SessionCell({ pr }: { pr: PRWithStatus }) {
  if (!pr.sessionName) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <span className="text-xs bg-surface-2 px-1.5 py-0.5 rounded truncate max-w-[100px]" title={pr.sessionName}>
      {pr.sessionName}
    </span>
  );
}

// Repository cell component
function RepositoryCell({ pr }: { pr: PRWithStatus }) {
  return (
    <span className="text-xs text-muted-foreground truncate" title={`${pr.repoOwner}/${pr.repoName}`}>
      {pr.repoName}
    </span>
  );
}

export function PRDashboard({
  initialWorkspaceId,
}: PRDashboardProps) {
  const toast = useToast();
  const [prs, setPRs] = useState<PRDashboardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const workspaces = useAppStore((s) => s.workspaces);
  const { setLastRepoDashboardWorkspaceId, workspaceColors } = useSettingsStore();

  // Get workspace name for the title
  const workspace = workspaces.find((w) => w.id === initialWorkspaceId);

  const handleWorkspaceChange = useCallback((newWorkspaceId: string) => {
    setLastRepoDashboardWorkspaceId(newWorkspaceId);
    navigate({ contentView: { type: 'pr-dashboard', workspaceId: newWorkspaceId } });
  }, [setLastRepoDashboardWorkspaceId]);

  const fetchPRsRef = useRef<(isRefresh?: boolean) => void>(() => {});

  const fetchPRs = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await getPRs(initialWorkspaceId);
      setPRs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PRs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [initialWorkspaceId]);
  fetchPRsRef.current = fetchPRs;

  // Initial fetch + WebSocket-driven refresh + slow fallback poll
  useEffect(() => {
    fetchPRs();

    // Listen for WebSocket invalidation events from PRWatcher
    const handlePRUpdate = () => fetchPRsRef.current(true);
    window.addEventListener('pr_dashboard_update', handlePRUpdate);

    // Slow fallback poll (5 minutes) as a safety net
    const interval = setInterval(() => {
      fetchPRs(true);
    }, 300000);

    return () => {
      window.removeEventListener('pr_dashboard_update', handlePRUpdate);
      clearInterval(interval);
    };
  }, [fetchPRs]);

  const handleJumpToSession = useCallback((workspaceId: string, sessionId: string) => {
    navigate({
      workspaceId,
      sessionId,
      contentView: { type: 'conversation' },
    });
  }, []); // navigate is a stable module-level function — no deps needed

  const handleSendMessage = useCallback(async (pr: PRWithStatus, message: string) => {
    if (!pr.sessionId) return;

    try {
      await sendSessionMessage(pr.workspaceId, pr.sessionId, message);
      handleJumpToSession(pr.workspaceId, pr.sessionId);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [handleJumpToSession]);

  // Compute PRs with status
  const prsWithStatus = useMemo(() => {
    return prs.map(computePRStatus);
  }, [prs]);

  // Context menu actions for a PR
  const getPRContextMenu = useCallback((pr: PRWithStatus): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    // Primary actions based on status
    if (pr.statusCategory === 'ready' && pr.sessionId) {
      items.push({
        label: 'Merge PR',
        icon: <GitMerge className="h-4 w-4" />,
        onClick: () => handleSendMessage(pr, 'Please merge this PR.'),
      });
    }

    if (pr.statusCategory === 'failures' && pr.sessionId) {
      items.push({
        label: 'Fix Failures',
        icon: <Wrench className="h-4 w-4" />,
        onClick: () => handleSendMessage(pr, 'Please fix the failing CI checks in this PR.'),
      });
    }

    if (pr.statusCategory === 'conflicts' && pr.sessionId) {
      items.push({
        label: 'Resolve Conflicts',
        icon: <AlertTriangle className="h-4 w-4" />,
        onClick: () => handleSendMessage(pr, 'Please resolve the merge conflicts in this PR.'),
      });
    }

    // Session actions
    if (pr.sessionId) {
      if (items.length > 0) {
        items.push({ label: '', onClick: () => {}, separator: true });
      }
      items.push({
        label: 'Go to Session',
        icon: <ArrowRight className="h-4 w-4" />,
        shortcut: 'Enter',
        onClick: () => handleJumpToSession(pr.workspaceId, pr.sessionId!),
      });
    }

    // GitHub actions
    if (items.length > 0) {
      items.push({ label: '', onClick: () => {}, separator: true });
    }

    items.push({
      label: 'Open in GitHub',
      icon: <ExternalLink className="h-4 w-4" />,
      shortcut: '⌘O',
      onClick: () => openInBrowser(pr.htmlUrl),
    });

    items.push({ label: '', onClick: () => {}, separator: true });

    // Copy actions
    const handleCopy = async (text: string) => {
      const success = await copyToClipboard(text);
      if (!success) toast.error('Failed to copy to clipboard');
    };

    items.push({
      label: 'Copy PR URL',
      icon: <Copy className="h-4 w-4" />,
      onClick: () => handleCopy(pr.htmlUrl),
    });

    items.push({
      label: 'Copy PR Number',
      icon: <Copy className="h-4 w-4" />,
      onClick: () => handleCopy(`#${pr.number}`),
    });

    items.push({
      label: 'Copy Branch Name',
      icon: <GitBranch className="h-4 w-4" />,
      onClick: () => handleCopy(pr.branch),
    });

    return items;
  }, [handleJumpToSession, handleSendMessage, toast]);

  // Define columns for the data table
  const columns: Column<PRWithStatus>[] = useMemo(() => [
    {
      id: 'number',
      header: '#',
      accessorKey: 'number',
      cell: (pr) => (
        <ErrorBoundary section="PRCell" fallback={<InlineErrorFallback message="Error" />}>
          <PRNumberBadge
            prNumber={pr.number}
            prStatus={pr.state as 'open' | 'merged' | 'closed'}
            checkStatus={pr.checkStatus as 'none' | 'pending' | 'success' | 'failure' | undefined}
            hasMergeConflict={pr.hasConflicts}
            isDraft={pr.isDraft}
            prUrl={pr.htmlUrl}
            size="md"
          />
        </ErrorBoundary>
      ),
      sortable: true,
      width: '80px',
    },
    {
      id: 'title',
      header: 'Title',
      accessorKey: 'title',
      cell: (pr) => (
        <ErrorBoundary section="PRTitleCell" fallback={<InlineErrorFallback message="Error" />}>
          <TitleCell pr={pr} />
        </ErrorBoundary>
      ),
      sortable: true,
    },
    {
      id: 'branch',
      header: 'Branch',
      accessorKey: 'branch',
      cell: (pr) => (
        <ErrorBoundary section="PRBranchCell" fallback={<InlineErrorFallback message="Error" />}>
          <BranchCell pr={pr} />
        </ErrorBoundary>
      ),
    },
    {
      id: 'checks',
      header: 'Checks',
      accessorKey: (pr) => `${pr.checksPassed}/${pr.checksTotal}`,
      cell: (pr) => (
        <ErrorBoundary section="PRChecksCell" fallback={<InlineErrorFallback message="Error" />}>
          <ChecksCell pr={pr} />
        </ErrorBoundary>
      ),
      width: '80px',
    },
    {
      id: 'session',
      header: 'Session',
      accessorKey: 'sessionName',
      cell: (pr) => <SessionCell pr={pr} />,
      width: '120px',
      hidden: true,
    },
    {
      id: 'repository',
      header: 'Repository',
      accessorKey: 'repoName',
      cell: (pr) => <RepositoryCell pr={pr} />,
      width: '120px',
      hidden: !!initialWorkspaceId, // Hide when viewing single workspace
    },
  ], [initialWorkspaceId]);

  // Filter options
  const filterOptions: FilterOption[] = useMemo(() => [
    {
      column: 'statusCategory',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'ready', label: 'Ready to Merge' },
        { value: 'pending', label: 'Checks Pending' },
        { value: 'failures', label: 'Check Failures' },
        { value: 'conflicts', label: 'Merge Conflicts' },
        { value: 'draft', label: 'Draft' },
      ],
    },
    {
      column: 'hasSession',
      label: 'Has Session',
      type: 'select',
      options: [
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ],
    },
    { column: 'title', label: 'Title', type: 'text' },
    { column: 'branch', label: 'Branch', type: 'text' },
    ...(!initialWorkspaceId ? [{
      column: 'repoName',
      label: 'Repository',
      type: 'text' as const,
    }] : []),
  ], [initialWorkspaceId]);

  // Display options configuration
  const displayOptionsConfig: DisplayOptionsConfig = useMemo(() => ({
    groupingOptions: [
      { value: 'statusCategory', label: 'Status' },
      { value: 'repoName', label: 'Repository' },
      { value: 'sessionName', label: 'Session' },
    ],
    sortingOptions: [
      { value: 'number', label: 'PR Number' },
      { value: 'title', label: 'Title' },
      { value: 'statusCategory', label: 'Status' },
    ],
    toggleableColumns: [
      { id: 'branch', label: 'Branch' },
      { id: 'checks', label: 'Checks' },
      { id: 'session', label: 'Session' },
      ...(!initialWorkspaceId ? [{ id: 'repository', label: 'Repository' }] : []),
    ],
  }), [initialWorkspaceId]);

  // Handle row click
  const handleRowClick = useCallback((pr: PRWithStatus) => {
    if (pr.sessionId) {
      handleJumpToSession(pr.workspaceId, pr.sessionId);
    } else {
      openInBrowser(pr.htmlUrl);
    }
  }, [handleJumpToSession]);

  // Get group key for a PR
  const getPRGroupKey = useCallback((pr: PRWithStatus): string => {
    return pr.statusCategory;
  }, []);

  // Custom group label renderer
  const getGroupLabel = useCallback((key: string): string => {
    return STATUS_LABELS[key as PRStatusCategory] || key;
  }, []);

  // Custom group icon renderer
  const getGroupIcon = useCallback((key: string): React.ReactNode => {
    switch (key as PRStatusCategory) {
      case 'ready':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failures':
        return <X className="h-4 w-4 text-red-500" />;
      case 'conflicts':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'draft':
        return <GitPullRequestDraft className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  }, []);

  // Add hasSession computed field for filtering
  const prsWithSessionFlag = useMemo(() => {
    return prsWithStatus.map(pr => ({
      ...pr,
      hasSession: pr.sessionId ? 'true' : 'false',
    }));
  }, [prsWithStatus]);

  // Stats for header
  const stats = useMemo(() => {
    const ready = prsWithStatus.filter(pr => pr.statusCategory === 'ready').length;
    const failures = prsWithStatus.filter(pr => pr.statusCategory === 'failures').length;
    const conflicts = prsWithStatus.filter(pr => pr.statusCategory === 'conflicts').length;
    const pending = prsWithStatus.filter(pr => pr.statusCategory === 'pending').length;
    const draft = prsWithStatus.filter(pr => pr.statusCategory === 'draft').length;
    return { ready, failures, conflicts, pending, draft, total: prsWithStatus.length };
  }, [prsWithStatus]);

  // Set dynamic toolbar content (Flutter AppBar-style)
  const toolbarConfig = useMemo(() => ({
    titlePosition: 'center' as const,
    title: (
      <span className="flex items-center gap-1.5 min-w-0">
        {workspace && workspaces.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 min-w-0 shrink overflow-hidden hover:bg-surface-1 px-1.5 py-0.5 rounded-md transition-colors">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: resolveWorkspaceColor(initialWorkspaceId ?? '', workspaceColors) }}
                />
                <span className="text-base font-semibold truncate">{workspace.name}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {workspaces.map((w) => (
                <DropdownMenuItem
                  key={w.id}
                  onClick={() => handleWorkspaceChange(w.id)}
                  className={cn(w.id === initialWorkspaceId && 'bg-surface-2')}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: resolveWorkspaceColor(w.id, workspaceColors) }}
                  />
                  <span className="truncate font-medium">{w.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : workspace ? (
          <span className="flex items-center gap-1.5 min-w-0 shrink overflow-hidden">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: resolveWorkspaceColor(initialWorkspaceId ?? '', workspaceColors) }}
            />
            <span className="text-base font-semibold truncate">{workspace.name}</span>
          </span>
        ) : null}
        {workspace && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className="flex items-center gap-1.5 shrink-0">
          <GitPullRequest className="h-4 w-4 text-violet-400" />
          <h1 className="text-base font-semibold">Pull Requests</h1>
        </span>
      </span>
    ),
    bottom: {
      title: (
        <span className="text-sm text-muted-foreground">
          {stats.total} {stats.total === 1 ? 'PR' : 'PRs'}
          {stats.ready > 0 && <span className="text-green-500 ml-2">{stats.ready} ready</span>}
          {stats.failures > 0 && <span className="text-red-500 ml-2">{stats.failures} failing</span>}
          {stats.conflicts > 0 && <span className="text-yellow-500 ml-2">{stats.conflicts} conflicts</span>}
        </span>
      ),
      titlePosition: 'left' as const,
      actions: (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => fetchPRsRef.current(true)}
          disabled={refreshing}
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      ),
    },
  }), [workspace, workspaces, initialWorkspaceId, stats, refreshing, handleWorkspaceChange, workspaceColors]);
  useMainToolbarContent(toolbarConfig);

  return (
    <FullContentLayout>
      <div className="h-full flex flex-col">
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
              {initialWorkspaceId
                ? 'No open pull requests found for this workspace.'
                : 'No open pull requests found.'}
            </p>
          </div>
        ) : (
          <DataTable
            data={prsWithSessionFlag}
            columns={columns}
            getRowId={(pr) => `${pr.workspaceId}-${pr.number}`}
            groupBy={{
              key: getPRGroupKey,
              sortOrder: STATUS_ORDER,
              getLabel: getGroupLabel,
              getIcon: getGroupIcon,
            }}
            sortBy={{ column: 'number', direction: 'desc' }}
            onRowClick={handleRowClick}
            onRowContextMenu={getPRContextMenu}
            filterOptions={filterOptions}
            displayOptionsConfig={displayOptionsConfig}
            searchPlaceholder="Search PRs..."
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            selectable
            emptyState={
              <div className="text-center py-12 text-muted-foreground">
                <GitPullRequest className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No pull requests found</p>
                <p className="text-sm mt-1">Try adjusting your search or filters.</p>
              </div>
            }
          />
        )}
      </div>
    </FullContentLayout>
  );
}
