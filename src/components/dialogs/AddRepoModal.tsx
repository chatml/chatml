'use client';

import { useState, useEffect } from 'react';
import { addRepo } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderGit2, AlertCircle } from 'lucide-react';

interface AddRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddRepoModal({ isOpen, onClose }: AddRepoModalProps) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { addRepo: addRepoToStore } = useAppStore();

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setPath('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const repo = await addRepo(path);
      addRepoToStore(repo);
      setPath('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add repository');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderGit2 className="w-5 h-5" />
            Add Repository
          </DialogTitle>
          <DialogDescription>
            Enter the path to a local Git repository to start orchestrating agents.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/your/repository"
                className="font-mono text-sm"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The repository must be a valid Git repository with a working tree.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !path.trim()}>
              {loading ? 'Adding...' : 'Add Repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
