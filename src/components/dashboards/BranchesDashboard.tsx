'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/layout/FullContentLayout';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { DataTable, type Column, type ContextMenuItem, type FilterOption, type DisplayOptionsConfig, type DisplayOptions } from '@/components/data-table';
import { listBranches, type BranchDTO, type BranchListResponse } from '@/lib/api';
import { useAvatars } from '@/hooks/useAvatars';
import { Button } from '@/components/ui/button';
import { AuthorAvatar } from '@/components/ui/author-avatar';
import {
  RefreshCw,
  Loader2,
  GitBranch,
  ChevronRight,
  Check,
  ArrowRight,
  Copy,
  Cloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceColor } from '@/lib/workspace-colors';

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
          'font-medium truncate min-w-0 text-md',
          isRemote && 'text-muted-foreground'
        )}
        title={displayName}
      >
        {displayName}
      </span>

      {isCurrentBranch && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-500 border border-green-500/20 shrink-0 whitespace-nowrap">
          <Check className="h-2.5 w-2.5" />
          HEAD
        </span>
      )}

      {isRemote && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0 whitespace-nowrap">
          <Cloud className="h-2.5 w-2.5" />
          REMOTE
        </span>
      )}

      {hasSession && branch.sessionName && (
        <span className="text-sm text-purple-400 truncate whitespace-nowrap" title={branch.sessionName}>
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
        'px-1.5 py-0.5 text-sm rounded border capitalize whitespace-nowrap',
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
  const [branchData, setBranchData] = useState<BranchListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRemote, setShowRemote] = useState(false);

  const fetchBranchesRef = useRef<(isRefresh?: boolean) => void>(() => {});
  const hasFetchedRef = useRef(false);

  const workspaces = useAppStore((s) => s.workspaces);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const selectSession = useAppStore((s) => s.selectSession);
  const setContentView = useSettingsStore((s) => s.setContentView);

  // Get workspace name for the title
  const workspace = workspaces.find((w) => w.id === workspaceId);

  // Set dynamic toolbar content (Flutter AppBar-style)
  const toolbarConfig = useMemo(() => ({
    titlePosition: 'center' as const,
    title: (
      <span className="flex items-center gap-1.5">
        {workspace && (
          <>
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: getWorkspaceColor(workspaceId) }}
            />
            <span className="text-base font-semibold truncate max-w-[200px]">{workspace.name}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </>
        )}
        <GitBranch className="h-4 w-4 text-green-400" />
        <h1 className="text-base font-semibold">Branches</h1>
      </span>
    ),
    bottom: {
      title: branchData ? (
        <span className="text-sm text-muted-foreground">
          {branchData.sessionBranches.length} {branchData.sessionBranches.length === 1 ? 'session' : 'sessions'} in {branchData.total} branches
        </span>
      ) : undefined,
      titlePosition: 'left' as const,
      actions: (
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
      ),
    },
  }), [workspace, workspaceId, branchData, refreshing]);
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

  // Initial fetch and auto-refresh
  // After the first fetch, subsequent dependency changes use refresh mode
  // to keep the DataTable mounted and preserve its display options state.
  useEffect(() => {
    fetchBranches(hasFetchedRef.current);
    hasFetchedRef.current = true;

    const interval = setInterval(() => {
      fetchBranches(true);
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchBranches]);


  const handleJumpToSession = useCallback((sessionId: string) => {
    selectWorkspace(workspaceId);
    selectSession(sessionId);
    setContentView({ type: 'conversation' });
  }, [workspaceId, selectWorkspace, selectSession, setContentView]);

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
      id: 'name',
      header: 'Branch',
      accessorKey: 'name',
      cell: (branch) => (
        <div className="flex items-center gap-1.5">
          <BranchIconCell branch={branch} currentBranch={branchData?.currentBranch ?? ''} />
          <BranchNameCell branch={branch} currentBranch={branchData?.currentBranch ?? ''} />
        </div>
      ),
      sortable: true,
      // No width = flexible, will truncate
    },
    {
      id: 'commit',
      header: 'Last Commit',
      accessorKey: 'lastCommitSubject',
      cell: (branch) => <CommitCell branch={branch} />,
      // No width = flexible, will truncate
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'sessionStatus',
      cell: (branch) => <StatusBadgeCell branch={branch} />,
      width: '70px',
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
      { id: 'commit', label: 'Last Commit' },
      { id: 'status', label: 'Status' },
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
    </FullContentLayout>
  );
}
