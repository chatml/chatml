'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { openFolderDialog, getHomeDir } from '@/lib/tauri';
import {
  listGitHubRepos,
  listGitHubOrgs,
  cloneRepo,
  type GitHubRepoDTO,
  type GitHubOrgDTO,
  type RepoDTO,
} from '@/lib/api';
import { classifyCloneError } from '@/lib/clone-errors';
import { useAuthStore } from '@/stores/authStore';
import { startOAuthFlow } from '@/lib/auth';
import { getLanguageColor } from '@/lib/languageColors';
import { cn } from '@/lib/utils';
import {
  Loader2,
  Star,
  Lock,
  Globe2,
  Github,
  Search,
  GitFork,
  ArrowRight,
} from 'lucide-react';

interface GitHubReposDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCloned?: (repo: RepoDTO) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    const diffMonths = Math.floor(diffDays / 30);
    return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
  }
  if (diffDays > 0) return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  if (diffHours > 0) return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  if (diffMins > 0) return diffMins === 1 ? '1 min ago' : `${diffMins} mins ago`;
  return 'just now';
}

// -- Sub-components ----------------------------------------------------------

function OwnerAvatar({ owner }: { owner: string }) {
  const hue = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < owner.length; i++) {
      hash = owner.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
  }, [owner]);

  const initials = owner.slice(0, 2).toUpperCase();

  return (
    <div
      className="h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-white text-[9px] font-medium leading-none select-none"
      style={{ backgroundColor: `oklch(0.55 0.1 ${hue})` }}
      title={owner}
    >
      {initials}
    </div>
  );
}

function RepoRow({
  repo,
  isSelected,
  isFocused,
  onClick,
}: {
  repo: GitHubRepoDTO;
  isSelected: boolean;
  isFocused: boolean;
  onClick: () => void;
}) {
  const hasTooltipContent = repo.description || repo.fork || repo.updatedAt;

  const row = (
    <button
      type="button"
      onClick={onClick}
      data-selected={isSelected || undefined}
      className={cn(
        'w-full text-left flex items-center gap-3 px-4 py-1.5 transition-colors cursor-pointer outline-none',
        'border-l-2 border-l-transparent',
        'hover:bg-muted/40',
        isSelected && 'bg-primary/8 dark:bg-primary/12 border-l-primary',
        isFocused && !isSelected && 'bg-muted/30',
      )}
    >
      <OwnerAvatar owner={repo.owner} />

      <span
        className={cn(
          'text-sm truncate min-w-0 flex-1',
          isSelected ? 'font-medium text-foreground' : 'text-foreground/80',
        )}
      >
        <span className="text-muted-foreground">{repo.owner}/</span>
        {repo.name}
      </span>

      <div className="flex items-center gap-2.5 shrink-0 text-muted-foreground">
        {repo.private ? (
          <Lock className="h-3 w-3" />
        ) : (
          <Globe2 className="h-3 w-3" />
        )}

        {repo.language && (
          <span className="flex items-center gap-1 text-2xs">
            <span
              className="inline-block h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: getLanguageColor(repo.language) }}
            />
            <span className="hidden sm:inline">{repo.language}</span>
          </span>
        )}

        {repo.stargazersCount > 0 && (
          <span className="flex items-center gap-0.5 text-2xs tabular-nums">
            <Star className="h-2.5 w-2.5" />
            {repo.stargazersCount >= 1000
              ? `${(repo.stargazersCount / 1000).toFixed(1)}k`
              : repo.stargazersCount}
          </span>
        )}
      </div>
    </button>
  );

  if (hasTooltipContent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs text-left">
          {repo.description && (
            <p className="text-xs leading-relaxed line-clamp-3">{repo.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1 text-2xs opacity-80">
            {repo.fork && (
              <span className="flex items-center gap-1">
                <GitFork className="h-2.5 w-2.5" /> Fork
              </span>
            )}
            {repo.updatedAt && (
              <span>Updated {formatRelativeTime(repo.updatedAt)}</span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return row;
}

function RepoRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <Skeleton className="h-5 w-5 rounded-full shrink-0" />
      <Skeleton className="h-3.5 flex-1 max-w-[220px]" />
      <div className="flex items-center gap-2.5 ml-auto">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-2 w-2 rounded-full" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  );
}

// -- Main dialog -------------------------------------------------------------

export function GitHubReposDialog({
  isOpen,
  onClose,
  onCloned,
}: GitHubReposDialogProps) {
  const { isAuthenticated } = useAuthStore();

  const [repos, setRepos] = useState<GitHubRepoDTO[]>([]);
  const [orgs, setOrgs] = useState<GitHubOrgDTO[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoDTO | null>(null);
  const [cloneLocation, setCloneLocation] = useState('');
  const [search, setSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<string>('all');
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const hasInitializedLocation = useRef(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const cloneAbortRef = useRef<AbortController | null>(null);

  // Fetch home directory once for default clone location
  useEffect(() => {
    if (!hasInitializedLocation.current) {
      hasInitializedLocation.current = true;
      getHomeDir().then((home) => {
        if (home) setCloneLocation(home);
      });
    }
  }, []);

  // Abort clone on unmount to prevent orphaned operations
  useEffect(() => {
    return () => {
      if (cloneAbortRef.current) cloneAbortRef.current.abort();
    };
  }, []);

  const fetchRepos = useCallback(
    async (
      pageNum: number,
      searchQuery: string,
      org: string,
      append: boolean
    ) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingRepos(true);
      }
      setFetchError(null);

      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await listGitHubRepos({
          page: pageNum,
          perPage: 30,
          sort: 'updated',
          ...(searchQuery && { search: searchQuery }),
          ...(org && org !== 'all' && { org }),
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (append) {
          setRepos((prev) => [...prev, ...result.repos]);
        } else {
          setRepos(result.repos);
        }
        setHasMore(result.hasMore);
        setPage(pageNum);
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Failed to load repositories';
        setFetchError(msg);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingRepos(false);
          setIsLoadingMore(false);
        }
      }
    },
    []
  );

  // Load repos + orgs when dialog opens with auth
  useEffect(() => {
    if (isOpen && isAuthenticated) {
      fetchRepos(1, '', 'all', false);
      listGitHubOrgs()
        .then((o) => setOrgs(o))
        .catch(() => {}); // Orgs are optional
    }
  }, [isOpen, isAuthenticated, fetchRepos]);

  const handleClose = useCallback(() => {
    // Abort in-progress clone if any
    if (cloneAbortRef.current) cloneAbortRef.current.abort();
    setRepos([]);
    setOrgs([]);
    setSelectedRepo(null);
    setSearch('');
    setSelectedOrg('all');
    setCloneError(null);
    setFetchError(null);
    setIsLoadingRepos(false);
    setHasMore(false);
    setPage(1);
    setFocusedIndex(-1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (abortRef.current) abortRef.current.abort();
    onClose();
  }, [onClose]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setFocusedIndex(-1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      setSelectedRepo(null);
      fetchRepos(1, value, selectedOrg, false);
    }, 300);
  };

  const handleOrgChange = (org: string) => {
    setSelectedOrg(org);
    setSelectedRepo(null);
    setFocusedIndex(-1);
    fetchRepos(1, search, org, false);
  };

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchRepos(page + 1, search, selectedOrg, true);
    }
  }, [fetchRepos, page, search, selectedOrg, isLoadingMore, hasMore]);

  const handleBrowse = async () => {
    const selectedPath = await openFolderDialog('Select Clone Location');
    if (selectedPath) setCloneLocation(selectedPath);
  };

  const handleSelectRepo = useCallback((repo: GitHubRepoDTO) => {
    setSelectedRepo((prev) =>
      prev?.fullName === repo.fullName ? null : repo
    );
    setCloneError(null);
  }, []);

  const handleClone = async () => {
    if (!selectedRepo || !cloneLocation.trim()) return;

    setIsCloning(true);
    setCloneError(null);

    const controller = new AbortController();
    cloneAbortRef.current = controller;

    // Frontend timeout: 6 minutes (backend has 5-min timeout for git clone).
    // Pass a reason string so we can distinguish timeout aborts from user cancels.
    const timeoutId = setTimeout(() => controller.abort('clone_timeout'), 6 * 60 * 1000);

    try {
      const result = await cloneRepo(
        selectedRepo.cloneUrl,
        cloneLocation.trim(),
        selectedRepo.name,
        controller.signal
      );
      onCloned?.(result.repo);
      handleClose();
    } catch (error) {
      setCloneError(classifyCloneError(error, controller.signal));
    } finally {
      clearTimeout(timeoutId);
      cloneAbortRef.current = null;
      setIsCloning(false);
    }
  };

  const handleConnectGitHub = async () => {
    try {
      useAuthStore.getState().startOAuth();
      await startOAuthFlow();
    } catch {
      // OAuth flow handled by listener in page.tsx
    }
  };

  // Keyboard navigation for the repo list
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (repos.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.min(prev + 1, repos.length - 1);
            virtuosoRef.current?.scrollToIndex({ index: next, align: 'center', behavior: 'auto' });
            return next;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => {
            const next = Math.max(prev - 1, 0);
            virtuosoRef.current?.scrollToIndex({ index: next, align: 'center', behavior: 'auto' });
            return next;
          });
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < repos.length) {
            handleSelectRepo(repos[focusedIndex]);
          }
          break;
      }
    },
    [repos, focusedIndex, handleSelectRepo]
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 flex flex-col h-[85vh]">
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">
            Clone a Repository
          </DialogTitle>
        </div>

        {!isAuthenticated ? (
          // Unauthenticated state
          <div className="flex-1 flex flex-col items-center justify-center py-10 space-y-4 px-6">
            <Github className="h-12 w-12 text-muted-foreground" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Connect your GitHub account</p>
              <p className="text-xs text-muted-foreground">
                Sign in to browse and clone your repositories.
              </p>
            </div>
            <Button onClick={handleConnectGitHub}>
              <Github className="h-4 w-4" />
              Connect GitHub
            </Button>
          </div>
        ) : (
          <>
            {/* Search + Org filter */}
            <div className="shrink-0 px-5 pb-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search repositories..."
                    className="pl-8 text-sm h-8"
                    disabled={isCloning}
                    autoFocus
                  />
                </div>
                {orgs.length > 0 && (
                  <Select
                    value={selectedOrg}
                    onValueChange={handleOrgChange}
                    disabled={isCloning}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-sm">
                      <SelectValue placeholder="All repos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All repos</SelectItem>
                      {orgs.map((org) => (
                        <SelectItem key={org.login} value={org.login}>
                          <span className="flex items-center gap-2">
                            <img
                              src={org.avatarUrl}
                              alt=""
                              className="h-4 w-4 rounded-full"
                            />
                            {org.login}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* Repo list */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <div
              className="flex-1 min-h-0 border-y"
              role="listbox"
              aria-label="Repositories"
              onKeyDown={handleListKeyDown}
              tabIndex={0}
            >
              {isLoadingRepos && repos.length === 0 ? (
                <div className="divide-y divide-border/50">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <RepoRowSkeleton key={i} />
                  ))}
                </div>
              ) : fetchError ? (
                <EmptyState
                  icon={Github}
                  title="Failed to load repositories"
                  description={fetchError}
                  size="sm"
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchRepos(1, search, selectedOrg, false)}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : repos.length === 0 && !isLoadingRepos ? (
                <EmptyState
                  icon={Search}
                  title={search ? 'No matches' : 'No repositories found'}
                  description={search ? `No repositories matching "${search}"` : undefined}
                  size="sm"
                />
              ) : (
                <Virtuoso
                  ref={virtuosoRef}
                  data={repos}
                  endReached={() => hasMore && !isLoadingMore && handleLoadMore()}
                  overscan={200}
                  itemContent={(index, repo) => (
                    <div className="border-b border-border/50 last:border-b-0">
                      <RepoRow
                        repo={repo}
                        isSelected={selectedRepo?.fullName === repo.fullName}
                        isFocused={focusedIndex === index}
                        onClick={() => handleSelectRepo(repo)}
                      />
                    </div>
                  )}
                  components={{
                    Footer: () =>
                      isLoadingMore ? (
                        <div className="flex items-center justify-center py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        </div>
                      ) : null,
                  }}
                />
              )}
            </div>

            {/* Clone location — compact inline bar */}
            <div className="shrink-0 px-5 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  Clone to
                </span>
                <Input
                  id="gh-clone-location"
                  value={cloneLocation}
                  onChange={(e) => setCloneLocation(e.target.value)}
                  placeholder="Select a location..."
                  className="font-mono text-xs h-7 flex-1 min-w-0"
                  disabled={isCloning}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleBrowse}
                  disabled={isCloning}
                  className="text-xs shrink-0"
                >
                  Browse...
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Footer — contextual with selection info */}
        <div className="shrink-0 px-5 py-3 flex items-center gap-3 border-t">
          <div className="flex-1 min-w-0">
            {cloneError ? (
              <p className="text-xs text-destructive truncate">{cloneError}</p>
            ) : selectedRepo ? (
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                <span className="font-medium text-foreground">{selectedRepo.fullName}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span className="font-mono truncate">
                  {cloneLocation}/{selectedRepo.name}
                </span>
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={isCloning ? "destructive" : "ghost"}
              size="sm"
              onClick={handleClose}
            >
              {isCloning ? 'Cancel clone' : 'Cancel'}
            </Button>
            {isAuthenticated && (
              <Button
                size="sm"
                onClick={handleClone}
                disabled={!selectedRepo || !cloneLocation.trim() || isCloning}
              >
                {isCloning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cloning...
                  </>
                ) : (
                  'Clone'
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
