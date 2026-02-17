'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useAuthStore } from '@/stores/authStore';
import { startOAuthFlow } from '@/lib/auth';
import {
  Loader2,
  Star,
  Lock,
  Globe2,
  Github,
  Search,
  GitFork,
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

function RepoCard({
  repo,
  isSelected,
  onClick,
}: {
  repo: GitHubRepoDTO;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-md border p-3 space-y-1.5 transition-colors cursor-pointer ${
        isSelected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-muted-foreground/30 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm truncate">{repo.name}</span>
        {repo.fork && (
          <GitFork className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        {repo.private ? (
          <Badge variant="outline" className="text-xs gap-1 shrink-0">
            <Lock className="h-3 w-3" />
            Private
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs gap-1 shrink-0">
            <Globe2 className="h-3 w-3" />
            Public
          </Badge>
        )}
      </div>
      {repo.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {repo.description}
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {repo.language && <span>{repo.language}</span>}
        {repo.stargazersCount > 0 && (
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3" />
            {repo.stargazersCount.toLocaleString()}
          </span>
        )}
        {repo.updatedAt && <span>Updated {formatRelativeTime(repo.updatedAt)}</span>}
      </div>
    </button>
  );
}

function RepoCardSkeleton() {
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-14" />
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

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

  const hasInitializedLocation = useRef(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch home directory once for default clone location
  useEffect(() => {
    if (!hasInitializedLocation.current) {
      hasInitializedLocation.current = true;
      getHomeDir().then((home) => {
        if (home) setCloneLocation(home);
      });
    }
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
    if (isCloning) return;
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
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (abortRef.current) abortRef.current.abort();
    onClose();
  }, [isCloning, onClose]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      setSelectedRepo(null);
      fetchRepos(1, value, selectedOrg, false);
    }, 300);
  };

  const handleOrgChange = (org: string) => {
    setSelectedOrg(org);
    setSelectedRepo(null);
    fetchRepos(1, search, org, false);
  };

  const handleLoadMore = () => {
    fetchRepos(page + 1, search, selectedOrg, true);
  };

  const handleBrowse = async () => {
    const selectedPath = await openFolderDialog('Select Clone Location');
    if (selectedPath) setCloneLocation(selectedPath);
  };

  const handleClone = async () => {
    if (!selectedRepo || !cloneLocation.trim()) return;

    setIsCloning(true);
    setCloneError(null);

    try {
      const result = await cloneRepo(
        selectedRepo.cloneUrl,
        cloneLocation.trim(),
        selectedRepo.name
      );
      onCloned?.(result.repo);
      handleClose();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Clone failed';
      if (msg.includes('already exists')) {
        setCloneError(
          `A directory "${selectedRepo.name}" already exists at the selected location.`
        );
      } else if (msg.includes('clone failed') || msg.includes('BAD_GATEWAY')) {
        setCloneError('Git clone failed. Please check your access and try again.');
      } else {
        setCloneError(msg);
      }
    } finally {
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Repositories
          </DialogTitle>
        </DialogHeader>

        {!isAuthenticated ? (
          // Unauthenticated state
          <div className="flex flex-col items-center justify-center py-10 space-y-4">
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
          // Authenticated state
          <>
            {/* Search + Org filter */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search repos..."
                  className="pl-8 text-sm"
                  disabled={isCloning}
                />
              </div>
              {orgs.length > 0 && (
                <Select
                  value={selectedOrg}
                  onValueChange={handleOrgChange}
                  disabled={isCloning}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="All repos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All repos</SelectItem>
                    {orgs.map((org) => (
                      <SelectItem key={org.login} value={org.login}>
                        {org.login}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Repo list */}
            <ScrollArea className="flex-1 min-h-0 max-h-[340px]">
              <div className="space-y-2 pr-3">
                {isLoadingRepos && repos.length === 0 ? (
                  // Loading skeletons
                  <>
                    <RepoCardSkeleton />
                    <RepoCardSkeleton />
                    <RepoCardSkeleton />
                    <RepoCardSkeleton />
                  </>
                ) : fetchError ? (
                  // Error state
                  <div className="flex flex-col items-center justify-center py-8 space-y-2">
                    <p className="text-sm text-destructive">{fetchError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        fetchRepos(1, search, selectedOrg, false)
                      }
                    >
                      Try again
                    </Button>
                  </div>
                ) : repos.length === 0 ? (
                  // Empty state
                  <div className="flex flex-col items-center justify-center py-8">
                    <p className="text-sm text-muted-foreground">
                      {search
                        ? 'No repositories match your search.'
                        : 'No repositories found.'}
                    </p>
                  </div>
                ) : (
                  // Repo cards
                  <>
                    {repos.map((repo) => (
                      <RepoCard
                        key={repo.fullName}
                        repo={repo}
                        isSelected={selectedRepo?.fullName === repo.fullName}
                        onClick={() =>
                          setSelectedRepo(
                            selectedRepo?.fullName === repo.fullName
                              ? null
                              : repo
                          )
                        }
                      />
                    ))}
                    {hasMore && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          'Load more'
                        )}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>

            {/* Clone location */}
            <div className="space-y-2 pt-1">
              <label htmlFor="gh-clone-location" className="text-sm font-medium">
                Clone to
              </label>
              <div className="flex gap-2">
                <Input
                  id="gh-clone-location"
                  value={cloneLocation}
                  onChange={(e) => setCloneLocation(e.target.value)}
                  placeholder="Select a location..."
                  className="font-mono text-sm flex-1"
                  disabled={isCloning}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                  disabled={isCloning}
                >
                  Browse...
                </Button>
              </div>
            </div>

            {cloneError && (
              <p className="text-sm text-destructive">{cloneError}</p>
            )}
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isCloning}
          >
            Cancel
          </Button>
          {isAuthenticated && (
            <Button
              onClick={handleClone}
              disabled={
                !selectedRepo || !cloneLocation.trim() || isCloning
              }
            >
              {isCloning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                'Clone'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
