'use client';

import { useState, useEffect } from 'react';
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

interface AddWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddWorkspaceModal({ isOpen, onClose }: AddWorkspaceModalProps) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { addWorkspace, selectWorkspace } = useAppStore();

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
      // For now, create workspace locally
      // TODO: Call backend API to validate and add workspace
      const name = path.split('/').pop() || 'Workspace';
      const workspace = {
        id: crypto.randomUUID(),
        name,
        path,
        defaultBranch: 'main',
        createdAt: new Date().toISOString(),
      };
      addWorkspace(workspace);
      selectWorkspace(workspace.id);
      setPath('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add workspace');
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
            Enter the path to a local Git repository to create a new workspace.
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
                The repository must be a valid Git repository.
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
              {loading ? 'Adding...' : 'Add Workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
