'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { FullContentLayout } from '@/components/FullContentLayout';
import { BranchCard } from '@/components/branches/BranchCard';
import { listBranches, type BranchDTO, type BranchListResponse } from '@/lib/api';
import { useAvatars } from '@/hooks/useAvatars';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RefreshCw,
  Loader2,
  GitBranch,
  ChevronRight,
  ChevronDown,
  Folder,
  Search,
  X,
  Check,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { CardErrorFallback } from '@/components/ErrorFallbacks';

interface BranchesDashboardProps {
  workspaceId: string;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
}

// Group branches by prefix
function groupBranchesByPrefix(branches: BranchDTO[]): Map<string, BranchDTO[]> {
  const groups = new Map<string, BranchDTO[]>();

  for (const branch of branches) {
    // Determine group key
    let groupKey = branch.prefix || '(other)';

    // For remote branches, use "origin" as group
    if (branch.isRemote && branch.name.startsWith('origin/')) {
      groupKey = 'origin';
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(branch);
  }

  return groups;
}

// Sort group keys with preferred order
function sortGroupKeys(keys: string[]): string[] {
  const preferredOrder = ['main', 'master', 'feature', 'fix', 'release', 'hotfix', 'session'];

  return keys.sort((a, b) => {
    const aIndex = preferredOrder.indexOf(a);
    const bIndex = preferredOrder.indexOf(b);

    // Both in preferred order - sort by that order
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    // Only a in preferred order - a comes first
    if (aIndex !== -1) return -1;
    // Only b in preferred order - b comes first
    if (bIndex !== -1) return 1;
    // origin goes last
    if (a === 'origin') return 1;
    if (b === 'origin') return -1;
    // (other) goes second to last
    if (a === '(other)') return 1;
    if (b === '(other)') return -1;
    // Alphabetical for the rest
    return a.localeCompare(b);
  });
}

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
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['origin']));

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

  const handleJumpToSession = (sessionId: string) => {
    selectWorkspace(workspaceId);
    selectSession(sessionId);
    setContentView({ type: 'conversation' });
  };

  const toggleGroupCollapsed = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  // Group other branches by prefix
  const groupedOtherBranches = useMemo(() => {
    if (!branchData) return new Map<string, BranchDTO[]>();
    return groupBranchesByPrefix(branchData.otherBranches);
  }, [branchData]);

  const sortedGroupKeys = useMemo(() => {
    return sortGroupKeys(Array.from(groupedOtherBranches.keys()));
  }, [groupedOtherBranches]);

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
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search branches..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-8 h-8"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Remote toggle */}
          <Button
            variant={showRemote ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowRemote(!showRemote)}
            className="h-8 gap-1.5"
          >
            {showRemote && <Check className="h-3.5 w-3.5" />}
            Remote
          </Button>

          {/* Stats */}
          {branchData && (
            <div className="text-sm text-muted-foreground">
              {branchData.sessionBranches.length > 0 && (
                <span className="mr-3">
                  Session ({branchData.sessionBranches.length})
                </span>
              )}
              <span>Total ({branchData.total})</span>
            </div>
          )}
        </div>

        {/* Content */}
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
        ) : !branchData || (branchData.sessionBranches.length === 0 && branchData.otherBranches.length === 0) ? (
          <div className="text-center py-12 text-muted-foreground">
            <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No branches found</p>
            <p className="text-sm mt-1">
              {searchTerm ? 'Try adjusting your search.' : 'This repository has no branches.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Session Branches Section */}
            {branchData.sessionBranches.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2 px-1">
                  SESSION BRANCHES ({branchData.sessionBranches.length})
                </h3>
                <div className="space-y-2">
                  {branchData.sessionBranches.map((branch) => (
                    <ErrorBoundary
                      key={branch.name}
                      section="BranchCard"
                      fallback={<CardErrorFallback message={`Error loading branch ${branch.name}`} />}
                    >
                      <BranchCard
                        branch={branch}
                        currentBranch={branchData.currentBranch}
                        avatarUrl={branch.lastAuthorEmail ? avatars[branch.lastAuthorEmail.toLowerCase()] : undefined}
                        onJumpToSession={
                          branch.sessionId
                            ? () => handleJumpToSession(branch.sessionId!)
                            : undefined
                        }
                      />
                    </ErrorBoundary>
                  ))}
                </div>
              </div>
            )}

            {/* Other Branches Section */}
            {branchData.otherBranches.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-2 px-1">
                  OTHER BRANCHES ({branchData.otherBranches.length})
                </h3>
                <div className="space-y-3">
                  {sortedGroupKeys.map((groupKey) => {
                    const branches = groupedOtherBranches.get(groupKey) || [];
                    const isCollapsed = collapsedGroups.has(groupKey);

                    return (
                      <Collapsible
                        key={groupKey}
                        open={!isCollapsed}
                        onOpenChange={() => toggleGroupCollapsed(groupKey)}
                      >
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground hover:text-foreground w-full rounded hover:bg-surface-1 transition-colors">
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform',
                                isCollapsed && '-rotate-90'
                              )}
                            />
                            <span className="font-medium">{groupKey}/</span>
                            <span className="text-xs">({branches.length})</span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-2 mt-2">
                            {branches.map((branch) => (
                              <ErrorBoundary
                                key={branch.name}
                                section="BranchCard"
                                fallback={<CardErrorFallback message={`Error loading branch ${branch.name}`} />}
                              >
                                <BranchCard
                                  branch={branch}
                                  currentBranch={branchData.currentBranch}
                                  avatarUrl={branch.lastAuthorEmail ? avatars[branch.lastAuthorEmail.toLowerCase()] : undefined}
                                />
                              </ErrorBoundary>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t">
                <span className="text-sm text-muted-foreground">
                  Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, branchData.total)} of {branchData.total} branches
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </FullContentLayout>
  );
}
