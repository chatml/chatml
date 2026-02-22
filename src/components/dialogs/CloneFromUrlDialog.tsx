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
import { openFolderDialog, getHomeDir } from '@/lib/tauri';
import { cloneRepo, resolveGitHubRepo, type GitHubRepoDTO, type RepoDTO } from '@/lib/api';
import { parseGitHubUrl, extractRepoName } from '@/lib/github-url';
import { classifyCloneError } from '@/lib/clone-errors';
import { Loader2, Star, Lock, Globe2 } from 'lucide-react';

interface CloneFromUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCloned?: (repo: RepoDTO) => void;
}

// Validates common git URL formats: https://, git@, ssh://, git://, file://
function isValidGitUrl(url: string): boolean {
  const gitUrlPattern = /^(https?:\/\/[\w.\-]+\/.+|git@[\w.\-]+:.+|ssh:\/\/[\w.\-@]+\/.+|git:\/\/[\w.\-]+\/.+|file:\/\/.+)$/i;
  return gitUrlPattern.test(url.trim());
}

export function CloneFromUrlDialog({ isOpen, onClose, onCloned }: CloneFromUrlDialogProps) {
  const [gitUrl, setGitUrl] = useState('');
  const [cloneLocation, setCloneLocation] = useState('');
  const [dirName, setDirName] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [repoPreview, setRepoPreview] = useState<GitHubRepoDTO | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const hasInitializedLocation = useRef(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloneAbortRef = useRef<AbortController | null>(null);

  // Fetch home directory once for default location
  useEffect(() => {
    if (!hasInitializedLocation.current) {
      hasInitializedLocation.current = true;
      getHomeDir().then((home) => {
        if (home) {
          setCloneLocation(home);
        }
      });
    }
  }, []);

  // Abort clone on unmount to prevent orphaned operations
  useEffect(() => {
    return () => {
      if (cloneAbortRef.current) cloneAbortRef.current.abort();
    };
  }, []);

  const handleClose = useCallback(() => {
    // Abort in-progress clone if any
    if (cloneAbortRef.current) cloneAbortRef.current.abort();
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    if (previewAbortRef.current) previewAbortRef.current.abort();
    setGitUrl('');
    setDirName('');
    setUrlError(null);
    setCloneError(null);
    setRepoPreview(null);
    setIsLoadingPreview(false);
    // Intentionally preserve cloneLocation — users often clone to the same directory
    onClose();
  }, [onClose]);

  // Debounced GitHub URL detection and preview
  const fetchPreview = useCallback((url: string) => {
    // Cancel any pending preview fetch
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    if (previewAbortRef.current) previewAbortRef.current.abort();
    setRepoPreview(null);
    setIsLoadingPreview(false);

    const parsed = parseGitHubUrl(url);
    if (!parsed) return;

    setIsLoadingPreview(true);
    previewTimeoutRef.current = setTimeout(async () => {
      const controller = new AbortController();
      previewAbortRef.current = controller;
      try {
        const repo = await resolveGitHubRepo(url, controller.signal);
        if (!controller.signal.aborted) {
          setRepoPreview(repo);
        }
      } catch {
        // Silently fail — preview is optional
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingPreview(false);
        }
      }
    }, 500);
  }, []);

  const handleUrlChange = (value: string) => {
    setGitUrl(value);
    if (urlError) setUrlError(null);
    if (cloneError) setCloneError(null);

    // Auto-extract directory name
    const name = extractRepoName(value);
    if (name) setDirName(name);

    // Trigger preview for GitHub URLs
    fetchPreview(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedUrl = gitUrl.trim();
    const trimmedLocation = cloneLocation.trim();
    const trimmedDirName = dirName.trim();

    // Validate git URL format
    if (!isValidGitUrl(trimmedUrl)) {
      setUrlError('Please enter a valid git URL (https://, git@, ssh://, or git://)');
      return;
    }

    if (!trimmedLocation) return;
    if (!trimmedDirName) {
      setUrlError('Directory name is required');
      return;
    }

    setIsCloning(true);
    setCloneError(null);

    const controller = new AbortController();
    cloneAbortRef.current = controller;

    // Frontend timeout: 6 minutes (backend has 5-min timeout for git clone).
    // Pass a reason string so we can distinguish timeout aborts from user cancels.
    const timeoutId = setTimeout(() => controller.abort('clone_timeout'), 6 * 60 * 1000);

    try {
      const result = await cloneRepo(trimmedUrl, trimmedLocation, trimmedDirName, controller.signal);
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

  const handleBrowse = async () => {
    const selectedPath = await openFolderDialog('Select Clone Location');
    if (selectedPath) {
      setCloneLocation(selectedPath);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone from URL</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="git-url" className="text-sm font-medium">Git URL</label>
              <Input
                id="git-url"
                value={gitUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className={`font-mono text-sm ${urlError ? 'border-destructive' : ''}`}
                autoFocus
                disabled={isCloning}
              />
              {urlError && (
                <p className="text-sm text-destructive">{urlError}</p>
              )}

              {/* GitHub repo preview */}
              {isLoadingPreview && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading repository info...
                </div>
              )}
              {repoPreview && !isLoadingPreview && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{repoPreview.fullName}</span>
                    {repoPreview.private ? (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Lock className="h-3 w-3" />
                        Private
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <Globe2 className="h-3 w-3" />
                        Public
                      </Badge>
                    )}
                  </div>
                  {repoPreview.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{repoPreview.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {repoPreview.language && <span>{repoPreview.language}</span>}
                    {repoPreview.stargazersCount > 0 && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        {repoPreview.stargazersCount.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="clone-location" className="text-sm font-medium">Clone location</label>
              <div className="flex gap-2">
                <Input
                  id="clone-location"
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

            <div className="space-y-2">
              <label htmlFor="dir-name" className="text-sm font-medium">Directory name</label>
              <Input
                id="dir-name"
                value={dirName}
                onChange={(e) => setDirName(e.target.value)}
                placeholder="repo-name"
                className="font-mono text-sm"
                disabled={isCloning}
              />
            </div>

            {cloneError && (
              <p className="text-sm text-destructive">{cloneError}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant={isCloning ? "destructive" : "outline"} onClick={handleClose}>
              {isCloning ? 'Cancel clone' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={!gitUrl.trim() || !cloneLocation.trim() || !dirName.trim() || isCloning}>
              {isCloning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cloning...
                </>
              ) : (
                'Clone repository'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
