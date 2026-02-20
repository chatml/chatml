'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { DataTable, type Column, type ContextMenuItem, type FilterOption, type DisplayOptionsConfig, type DisplayOptions } from '@/components/data-table';
import { listBranches, pruneStaleBranches, type BranchDTO, type BranchListResponse } from '@/lib/api';
import { useAvatars } from '@/hooks/useAvatars';
import { Button } from '@/components/ui/button';
import { AuthorAvatar } from '@/components/ui/author-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  RefreshCw,
  Loader2,
  GitBranch,
  ChevronRight,
  ChevronDown,
  Check,
  ArrowRight,
  Copy,
  Cloud,
  Wand2,
  Scissors,
} from 'lucide-react';
import { BranchCleanupDialog } from '@/components/dialogs/branch-cleanup/BranchCleanupDialog';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';
import { PRNumberBadge } from '@/components/shared/PRNumberBadge';

interface BranchesDashboardProps {
  workspaceId: string;
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

// Branch name cell component
function BranchNameCell({ branch, currentBranch }: { branch: BranchDTO; currentBranch: string }) {
  const isCurrentBranch = branch.name === currentBranch;
  const isRemote = branch.isRemote;

  // Get branch display name (strip origin/ prefix for display)
  const displayName = isRemote && branch.name.startsWith('origin/')
    ? branch.name.slice(7)
    : branch.name;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-xs truncate',
          isRemote
            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300/70'
            : 'bg-purple-500/10 text-purple-700 dark:text-purple-300/70'
        )}
        title={displayName}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0" />
        {displayName}
      </span>

      {isCurrentBranch && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded bg-green-500/10 text-green-500 border border-green-500/20 shrink-0 whitespace-nowrap">
          <Check className="h-2.5 w-2.5" />
          HEAD
        </span>
      )}

      {isRemote && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-2xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0 whitespace-nowrap">
          <Cloud className="h-2.5 w-2.5" />
          REMOTE
        </span>
      )}
    </div>
  );
}

// Author cell component - avatar only with tooltip
function AuthorCell({ branch, avatarUrl }: { branch: BranchDTO; avatarUrl?: string }) {
  if (!branch.lastAuthor) return null;

  return (
    <div className="flex items-center justify-center" title={branch.lastAuthor}>
      <AuthorAvatar name={branch.lastAuthor} avatarUrl={avatarUrl} size="md" />
    </div>
  );
}

// Updated time cell component
function UpdatedCell({ branch }: { branch: BranchDTO }) {
  if (!branch.lastCommitDate) return null;
  return (
    <span className="text-sm text-muted-foreground whitespace-nowrap">
      {formatTimeAgo(branch.lastCommitDate)}
    </span>
  );
}

// Commit cell component - shows SHA and subject
function CommitCell({ branch }: { branch: BranchDTO }) {
  if (!branch.lastCommitSha) return null;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <code className="px-1.5 py-0.5 text-xs font-mono rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0 whitespace-nowrap">
        {branch.lastCommitSha.slice(0, 7)}
      </code>
      {branch.lastCommitSubject && (
        <span className="text-sm text-muted-foreground truncate min-w-0" title={branch.lastCommitSubject}>
          {branch.lastCommitSubject}
        </span>
      )}
    </div>
  );
}

// Diff badge cell component
function DiffBadgeCell({ branch }: { branch: BranchDTO }) {
  if (branch.aheadMain === 0 && branch.behindMain === 0) return null;

  return (
    <span className="flex items-center gap-1 font-mono text-xs whitespace-nowrap">
      {branch.aheadMain > 0 && (
        <span className="text-green-500">+{branch.aheadMain}</span>
      )}
      {branch.behindMain > 0 && (
        <span className="text-red-500">-{branch.behindMain}</span>
      )}
    </span>
  );
}

// Get group key for a branch
function getBranchGroupKey(branch: BranchDTO): string {
  // For remote branches, use "origin" as group
  if (branch.isRemote && branch.name.startsWith('origin/')) {
    return 'origin';
  }
  // For session branches, use "session" as group
  if (branch.sessionId) {
    return 'session';
  }
  // Otherwise use prefix or (None)
  return branch.prefix || '(None)';
}

// Sort group keys with preferred order - (None) and origin at the end
const GROUP_SORT_ORDER = ['session', 'main', 'master', 'feature', 'fix', 'release', 'hotfix', 'origin', '(None)'];

export function BranchesDashboard({
  workspaceId,
}: BranchesDashboardProps) {
  const toast = useToast();
  const [branchData, setBranchData] = useState<BranchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRemote, setShowRemote] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [pruning, setPruning] = useState(false);

  const fetchBranchesRef = useRef<(isRefresh?: boolean) => void>(() => {});
  const hasFetchedRef = useRef(false);

  const workspaces = useAppStore((s) => s.workspaces);
  const { setLastRepoDashboardWorkspaceId, workspaceColors } = useSettingsStore();

  // Get workspace name for the title
  const workspace = workspaces.find((w) => w.id === workspaceId);

  const handleWorkspaceChange = useCallback((newWorkspaceId: string) => {
    setLastRepoDashboardWorkspaceId(newWorkspaceId);
    navigate({ contentView: { type: 'branches', workspaceId: newWorkspaceId } });
  }, [setLastRepoDashboardWorkspaceId]);

  const handlePrune = useCallback(async () => {
    setPruning(true);
    try {
      const result = await pruneStaleBranches(workspaceId);
      const deletedCount = result.deletedLocalBranches?.length ?? 0;
      if (deletedCount > 0) {
        toast.success(`Cleaned up ${deletedCount} merged local ${deletedCount === 1 ? 'branch' : 'branches'} and pruned stale refs`);
      } else {
        toast.success('Pruned stale remote refs (no merged local branches to clean)');
      }
      // Directly refresh instead of relying solely on WebSocket event
      fetchBranchesRef.current(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clean up branches');
    } finally {
      setPruning(false);
    }
  }, [workspaceId, toast]);

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
                  style={{ backgroundColor: resolveWorkspaceColor(workspaceId, workspaceColors) }}
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
                  className={cn(w.id === workspaceId && 'bg-surface-2')}
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
              style={{ backgroundColor: resolveWorkspaceColor(workspaceId, workspaceColors) }}
            />
            <span className="text-base font-semibold truncate">{workspace.name}</span>
          </span>
        ) : null}
        {workspace && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className="flex items-center gap-1.5 shrink-0">
          <GitBranch className="h-4 w-4 text-green-400" />
          <h1 className="text-base font-semibold">Branches</h1>
        </span>
      </span>
    ),
    bottom: {
      title: branchData ? (
        <span className="text-sm text-muted-foreground">
          {branchData.sessionBranches.length} {branchData.sessionBranches.length === 1 ? 'session' : 'sessions'} · {branchData.total} {branchData.total === 1 ? 'branch' : 'branches'}
        </span>
      ) : undefined,
      titlePosition: 'left' as const,
      actions: (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={handlePrune}
            disabled={pruning}
            title="Prune stale remote refs and delete merged local branches"
          >
            <Scissors className={cn('h-3.5 w-3.5', pruning && 'animate-spin')} />
            {pruning ? 'Cleaning...' : 'Clean Up Branches'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setCleanupOpen(true)}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Smart Branch Cleanup
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => fetchBranchesRef.current(true)}
            disabled={refreshing}
            title="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </Button>
        </>
      ),
    },
  }), [workspace, workspaces, workspaceId, branchData, refreshing, handleWorkspaceChange, handlePrune, pruning, workspaceColors]);
  useMainToolbarContent(toolbarConfig);

  const fetchBranches = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await listBranches(workspaceId, {
        includeRemote: showRemote,
        search: searchTerm || undefined,
        sortBy: 'date',
        limit: 1000, // Fetch all branches
      });
      setBranchData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId, showRemote, searchTerm]);
  fetchBranchesRef.current = fetchBranches;

  // Initial fetch + WebSocket-driven refresh + slow fallback poll
  // After the first fetch, subsequent dependency changes use refresh mode
  // to keep the DataTable mounted and preserve its display options state.
  useEffect(() => {
    fetchBranches(hasFetchedRef.current);
    hasFetchedRef.current = true;

    // Listen for WebSocket invalidation events from BranchWatcher
    const handleBranchUpdate = () => fetchBranchesRef.current(true);
    window.addEventListener('branch_dashboard_update', handleBranchUpdate);

    // Slow fallback poll (5 minutes) as a safety net
    const interval = setInterval(() => {
      fetchBranches(true);
    }, 300000);

    return () => {
      window.removeEventListener('branch_dashboard_update', handleBranchUpdate);
      clearInterval(interval);
    };
  }, [fetchBranches]);


  const handleJumpToSession = useCallback((sessionId: string) => {
    navigate({
      workspaceId,
      sessionId,
      contentView: { type: 'conversation' },
    });
  }, [workspaceId]);

  // Combine all branches for the table with computed location field
  const allBranches = useMemo(() => {
    if (!branchData) return [];
    return [...branchData.sessionBranches, ...branchData.otherBranches].map(branch => ({
      ...branch,
      location: branch.isRemote ? 'Remote' : 'Local',
    }));
  }, [branchData]);

  // Collect all unique author emails from branches
  const authorEmails = useMemo(() => {
    if (!branchData) return [];
    const emails = new Set<string>();
    for (const branch of [...branchData.sessionBranches, ...branchData.otherBranches]) {
      if (branch.lastAuthorEmail) {
        emails.add(branch.lastAuthorEmail);
      }
    }
    return Array.from(emails);
  }, [branchData]);

  // Fetch avatars for all author emails
  const avatars = useAvatars(authorEmails);

  // Get avatar URL for a branch
  const getAvatarUrl = useCallback((branch: BranchDTO) => {
    return branch.lastAuthorEmail ? avatars[branch.lastAuthorEmail.toLowerCase()] : undefined;
  }, [avatars]);

  // Context menu actions for a branch
  const getBranchContextMenu = useCallback((branch: BranchDTO): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];

    // Session actions
    if (branch.sessionId) {
      items.push({
        label: 'Go to session',
        icon: <ArrowRight className="h-4 w-4" />,
        shortcut: 'Enter',
        onClick: () => handleJumpToSession(branch.sessionId!),
      });
      items.push({ label: '', onClick: () => {}, separator: true });
    }

    // Copy branch name
    items.push({
      label: 'Copy branch name',
      icon: <Copy className="h-4 w-4" />,
      shortcut: '⌘C',
      onClick: async () => {
        const success = await copyToClipboard(branch.name);
        if (!success) toast.error('Failed to copy to clipboard');
      },
    });

    // View on GitHub (placeholder - would need repo info)
    // items.push({
    //   label: 'View on GitHub',
    //   icon: <ExternalLink className="h-4 w-4" />,
    //   onClick: () => {},
    // });

    return items;
  }, [handleJumpToSession, toast]);

  // Define columns for the data table
  const columns: Column<BranchDTO>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Branch',
      accessorKey: 'name',
      cell: (branch) => (
        <ErrorBoundary section="BranchNameCell" fallback={<InlineErrorFallback message="Error" />}>
          <BranchNameCell branch={branch} currentBranch={branchData?.currentBranch ?? ''} />
        </ErrorBoundary>
      ),
      sortable: true,
      // No width = flexible, will truncate
    },
    {
      id: 'pr',
      header: 'PR #',
      accessorKey: 'prNumber',
      cell: (branch) => branch.prNumber ? (
        <PRNumberBadge
          prNumber={branch.prNumber}
          prStatus={(branch.prStatus as 'open' | 'merged' | 'closed') || 'open'}
          checkStatus={branch.checkStatus as 'none' | 'pending' | 'success' | 'failure' | undefined}
          hasMergeConflict={branch.hasMergeConflict}
          prUrl={branch.prUrl}
          size="sm"
        />
      ) : null,
      width: '80px',
    },
    {
      id: 'commit',
      header: 'Last Commit',
      accessorKey: 'lastCommitSubject',
      cell: (branch) => (
        <ErrorBoundary section="BranchCommitCell" fallback={<InlineErrorFallback message="Error" />}>
          <CommitCell branch={branch} />
        </ErrorBoundary>
      ),
      // No width = flexible, will truncate
    },
    {
      id: 'updated',
      header: 'Updated',
      accessorKey: 'lastCommitDate',
      cell: (branch) => <UpdatedCell branch={branch} />,
      sortable: true,
      width: '80px',
    },
    {
      id: 'author',
      header: '',
      accessorKey: 'lastAuthor',
      cell: (branch) => <AuthorCell branch={branch} avatarUrl={getAvatarUrl(branch)} />,
      width: '40px',
    },
    {
      id: 'diff',
      header: 'Diff',
      cell: (branch) => <DiffBadgeCell branch={branch} />,
      width: '80px',
    },
  ], [branchData?.currentBranch, getAvatarUrl]);

  // Filter options
  const filterOptions: FilterOption[] = useMemo(() => [
    {
      column: 'location',
      label: 'Location',
      type: 'select',
      options: [
        { value: 'Local', label: 'Local' },
        { value: 'Remote', label: 'Remote' },
      ],
    },
    { column: 'lastAuthor', label: 'Author', type: 'text' },
    { column: 'name', label: 'Branch name', type: 'text' },
  ], []);

  // Display options configuration
  const displayOptionsConfig: DisplayOptionsConfig = useMemo(() => ({
    groupingOptions: [
      { value: 'prefix', label: 'Branch prefix' },
      { value: 'lastAuthor', label: 'Author' },
      { value: 'location', label: 'Location' },
    ],
    sortingOptions: [
      { value: 'name', label: 'Name' },
      { value: 'updated', label: 'Last updated' },
      { value: 'lastAuthor', label: 'Author' },
    ],
    toggleableColumns: [
      { id: 'pr', label: 'PR #' },
      { id: 'commit', label: 'Last Commit' },
      { id: 'author', label: 'Author' },
      { id: 'updated', label: 'Updated' },
      { id: 'diff', label: 'Diff' },
    ],
    listOptions: [
      { id: 'showRemote', label: 'Show remote branches', defaultValue: false },
    ],
  }), []);

  // Sync display option toggles with local state
  const handleDisplayOptionsChange = useCallback((opts: DisplayOptions) => {
    setShowRemote(opts.customToggles.showRemote ?? false);
  }, []);

  // Handle row click
  const handleRowClick = useCallback((branch: BranchDTO) => {
    if (branch.sessionId) {
      handleJumpToSession(branch.sessionId);
    }
  }, [handleJumpToSession]);

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
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchBranches()}>
              Try Again
            </Button>
          </div>
        ) : !branchData || allBranches.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No branches found</p>
            <p className="text-sm mt-1">
              {searchTerm ? 'Try adjusting your search.' : 'This repository has no branches.'}
            </p>
          </div>
        ) : (
          <>
            <DataTable
              data={allBranches}
              columns={columns}
              getRowId={(branch) => branch.name}
              groupBy={{
                key: getBranchGroupKey,
                sortOrder: GROUP_SORT_ORDER,
                defaultCollapsed: ['origin'],
                getLabel: (key) => key === '' ? '(None)' : key,
              }}
              sortBy={{ column: 'updated', direction: 'desc' }}
              onRowClick={handleRowClick}
              onRowContextMenu={getBranchContextMenu}
              filterOptions={filterOptions}
              displayOptionsConfig={displayOptionsConfig}
              onDisplayOptionsChange={handleDisplayOptionsChange}
              searchPlaceholder="Search..."
              searchValue={searchTerm}
              onSearchChange={setSearchTerm}
              selectable
              emptyState={
                <div className="text-center py-12 text-muted-foreground">
                  <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">No branches found</p>
                  <p className="text-sm mt-1">Try adjusting your search or filters.</p>
                </div>
              }
            />
          </>
        )}
      </div>

      <BranchCleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        workspaceId={workspaceId}
        onComplete={() => fetchBranchesRef.current(true)}
      />
    </FullContentLayout>
  );
}
