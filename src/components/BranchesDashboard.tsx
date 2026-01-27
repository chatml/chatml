'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/FullContentLayout';
import { DataTable, type Column, type ContextMenuItem, type FilterOption, type DisplayOptionsConfig } from '@/components/data-table';
import { listBranches, type BranchDTO, type BranchListResponse } from '@/lib/api';
import { useAvatars } from '@/hooks/useAvatars';
import { Button } from '@/components/ui/button';
import { AuthorAvatar } from '@/components/ui/author-avatar';
import {
  RefreshCw,
  Loader2,
  GitBranch,
  ChevronRight,
  Folder,
  Check,
  ArrowRight,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BranchesDashboardProps {
  workspaceId: string;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
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

// Branch icon cell component
function BranchIconCell({ branch, currentBranch }: { branch: BranchDTO; currentBranch: string }) {
  const isCurrentBranch = branch.name === currentBranch;
  const hasSession = !!branch.sessionId;
  const isRemote = branch.isRemote;

  return (
    <div className="flex items-center justify-center">
      <GitBranch
        className={cn(
          'h-4 w-4',
          hasSession ? 'text-purple-400' : isCurrentBranch ? 'text-green-400' : isRemote ? 'text-muted-foreground' : 'text-foreground/70'
        )}
      />
    </div>
  );
}

// Branch name cell component
function BranchNameCell({ branch, currentBranch }: { branch: BranchDTO; currentBranch: string }) {
  const isCurrentBranch = branch.name === currentBranch;
  const hasSession = !!branch.sessionId;
  const isRemote = branch.isRemote;

  // Get branch display name (strip origin/ prefix for display)
  const displayName = isRemote && branch.name.startsWith('origin/')
    ? branch.name.slice(7)
    : branch.name;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={cn(
          'font-medium text-sm truncate',
          isRemote && 'text-muted-foreground'
        )}
      >
        {displayName}
      </span>

      {isCurrentBranch && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-500 border border-green-500/20 shrink-0">
          <Check className="h-2.5 w-2.5" />
          HEAD
        </span>
      )}

      {hasSession && branch.sessionName && (
        <span className="text-sm text-purple-400 truncate max-w-[100px] shrink-0">
          {branch.sessionName}
        </span>
      )}
    </div>
  );
}

// Status badge cell component
function StatusBadgeCell({ branch }: { branch: BranchDTO }) {
  if (!branch.sessionStatus) return null;

  const statusStyles: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    idle: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    done: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    error: 'bg-red-500/10 text-red-500 border-red-500/20',
  };

  return (
    <span
      className={cn(
        'px-1.5 py-0.5 text-[10px] rounded border capitalize',
        statusStyles[branch.sessionStatus] || 'bg-surface-2 text-muted-foreground'
      )}
    >
      {branch.sessionStatus}
    </span>
  );
}

// Author cell component - avatar only with tooltip
function AuthorCell({ branch, avatarUrl }: { branch: BranchDTO; avatarUrl?: string }) {
  if (!branch.lastAuthor) return null;

  return (
    <div className="flex items-center justify-center" title={branch.lastAuthor}>
      <AuthorAvatar name={branch.lastAuthor} avatarUrl={avatarUrl} size="sm" />
    </div>
  );
}

// Updated time cell component
function UpdatedCell({ branch }: { branch: BranchDTO }) {
  if (!branch.lastCommitDate) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {formatTimeAgo(branch.lastCommitDate)}
    </span>
  );
}

// Diff badge cell component
function DiffBadgeCell({ branch }: { branch: BranchDTO }) {
  if (branch.aheadMain === 0 && branch.behindMain === 0) return null;

  return (
    <span className="flex items-center gap-1 font-mono text-[10px]">
      {branch.aheadMain > 0 && (
        <span className="text-green-500">+{branch.aheadMain}</span>
      )}
      {branch.behindMain > 0 && (
        <span className="text-red-500">-{branch.behindMain}</span>
      )}
      <span className="text-muted-foreground/50">main</span>
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
  // Otherwise use prefix or (other)
  return branch.prefix || '(other)';
}

// Sort group keys with preferred order
const GROUP_SORT_ORDER = ['session', 'main', 'master', 'feature', 'fix', 'release', 'hotfix', '(other)', 'origin'];

export function BranchesDashboard({
  workspaceId,
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar,
}: BranchesDashboardProps) {
  const [branchData, setBranchData] = useState<BranchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRemote, setShowRemote] = useState(true);
  const [page, setPage] = useState(0);

  const PAGE_SIZE = 50;

  const workspaces = useAppStore((s) => s.workspaces);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const selectSession = useAppStore((s) => s.selectSession);
  const setContentView = useSettingsStore((s) => s.setContentView);

  // Get workspace name for the title
  const workspace = workspaces.find((w) => w.id === workspaceId);

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
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: searchTerm || undefined,
        sortBy: 'date',
      });
      setBranchData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load branches');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [workspaceId, showRemote, page, searchTerm]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchBranches();

    // Auto-refresh every 60 seconds
    const interval = setInterval(() => {
      fetchBranches(true);
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchBranches]);

  // Reset page when search or remote filter changes
  useEffect(() => {
    setPage(0);
  }, [searchTerm, showRemote]);

  const handleRefresh = () => {
    fetchBranches(true);
  };

  const handleJumpToSession = useCallback((sessionId: string) => {
    selectWorkspace(workspaceId);
    selectSession(sessionId);
    setContentView({ type: 'conversation' });
  }, [workspaceId, selectWorkspace, selectSession, setContentView]);

  // Combine all branches for the table
  const allBranches = useMemo(() => {
    if (!branchData) return [];
    return [...branchData.sessionBranches, ...branchData.otherBranches];
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
      onClick: () => navigator.clipboard.writeText(branch.name),
    });

    // View on GitHub (placeholder - would need repo info)
    // items.push({
    //   label: 'View on GitHub',
    //   icon: <ExternalLink className="h-4 w-4" />,
    //   onClick: () => {},
    // });

    return items;
  }, [handleJumpToSession]);

  // Define columns for the data table
  const columns: Column<BranchDTO>[] = useMemo(() => [
    {
      id: 'icon',
      header: '',
      cell: (branch) => (
        <BranchIconCell branch={branch} currentBranch={branchData?.currentBranch ?? ''} />
      ),
      width: '32px',
    },
    {
      id: 'name',
      header: 'Branch',
      accessorKey: 'name',
      cell: (branch) => (
        <BranchNameCell branch={branch} currentBranch={branchData?.currentBranch ?? ''} />
      ),
      sortable: true,
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'sessionStatus',
      cell: (branch) => <StatusBadgeCell branch={branch} />,
      width: '80px',
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
      width: '32px',
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
    { column: 'name', label: 'Branch name', type: 'text' },
    { column: 'lastAuthor', label: 'Author', type: 'text' },
    {
      column: 'sessionStatus',
      label: 'Status',
      type: 'select',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'idle', label: 'Idle' },
        { value: 'done', label: 'Done' },
        { value: 'error', label: 'Error' },
      ],
    },
  ], []);

  // Display options configuration
  const displayOptionsConfig: DisplayOptionsConfig = useMemo(() => ({
    groupingOptions: [
      { value: 'prefix', label: 'Branch prefix' },
      { value: 'lastAuthor', label: 'Author' },
    ],
    sortingOptions: [
      { value: 'name', label: 'Name' },
      { value: 'lastCommitDate', label: 'Last updated' },
      { value: 'lastAuthor', label: 'Author' },
    ],
    toggleableColumns: [
      { id: 'status', label: 'Status' },
      { id: 'author', label: 'Author' },
      { id: 'updated', label: 'Updated' },
      { id: 'diff', label: 'Diff' },
    ],
  }), []);

  // Handle row click
  const handleRowClick = useCallback((branch: BranchDTO) => {
    if (branch.sessionId) {
      handleJumpToSession(branch.sessionId);
    }
  }, [handleJumpToSession]);

  // Calculate total pages
  const totalPages = branchData ? Math.ceil(branchData.total / PAGE_SIZE) : 0;

  return (
    <FullContentLayout
      title={
        <span className="flex items-center gap-1.5">
          Branches
          {workspace && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/10 text-sm font-medium text-purple-300/80">
                <Folder className="h-3 w-3" />
                <span className="truncate max-w-[200px]">{workspace.name}</span>
              </span>
            </>
          )}
        </span>
      }
      onOpenSettings={onOpenSettings}
      onOpenShortcuts={onOpenShortcuts}
      showLeftSidebar={showLeftSidebar}
      headerActions={
        <div className="flex items-center gap-2">
          {/* Remote toggle */}
          <Button
            variant={showRemote ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowRemote(!showRemote)}
            className="h-6 text-xs gap-1"
          >
            {showRemote && <Check className="h-3 w-3" />}
            Remote
          </Button>

          {/* Stats */}
          {branchData && (
            <div className="text-xs text-muted-foreground">
              {branchData.sessionBranches.length > 0 && (
                <span className="mr-2">
                  Session ({branchData.sessionBranches.length})
                </span>
              )}
              <span>Total ({branchData.total})</span>
            </div>
          )}

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
        </div>
      }
    >
      <div className="pt-2 pb-4">
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
              }}
              sortBy={{ column: 'lastCommitDate', direction: 'desc' }}
              onRowClick={handleRowClick}
              onRowContextMenu={getBranchContextMenu}
              filterOptions={filterOptions}
              displayOptionsConfig={displayOptionsConfig}
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-border/30">
                <span className="text-sm text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, branchData.total)} of {branchData.total}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </FullContentLayout>
  );
}
