'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openFolderDialog, getHomeDir } from '@/lib/tauri';

interface CloneFromUrlDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Validates common git URL formats: https://, git@, ssh://, git://
function isValidGitUrl(url: string): boolean {
  const gitUrlPattern = /^(https?:\/\/[\w.-]+\/.+|git@[\w.-]+:.+|ssh:\/\/[\w.-]+\/.+|git:\/\/[\w.-]+\/.+)$/i;
  return gitUrlPattern.test(url.trim());
}

export function CloneFromUrlDialog({ isOpen, onClose }: CloneFromUrlDialogProps) {
  const [gitUrl, setGitUrl] = useState('');
  const [cloneLocation, setCloneLocation] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const hasInitializedLocation = useRef(false);

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

  const handleClose = () => {
    setGitUrl('');
    setUrlError(null);
    // Intentionally preserve cloneLocation - users often clone to the same directory
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate git URL format
    if (!isValidGitUrl(gitUrl)) {
      setUrlError('Please enter a valid git URL (https://, git@, ssh://, or git://)');
      return;
    }

    if (!cloneLocation.trim()) {
      return;
    }

    // TODO: Implement actual git clone via Tauri command
    // For now, show a message that this feature is coming soon
    alert('Clone repository feature coming soon!\n\nRepository: ' + gitUrl + '\nLocation: ' + cloneLocation);
    handleClose();
  };

  const handleUrlChange = (value: string) => {
    setGitUrl(value);
    // Clear error when user starts typing
    if (urlError) setUrlError(null);
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
              />
              {urlError && (
                <p className="text-sm text-destructive">{urlError}</p>
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
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                >
                  Browse...
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!gitUrl.trim() || !cloneLocation.trim()}>
              Clone repository
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
