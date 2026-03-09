'use client';

import { useState, useEffect } from 'react';
import { FolderGit2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { listRepos, type RepoDTO } from '@/lib/api';

interface WorkspacePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentWorkspaceId: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function WorkspacePicker({
  open,
  onOpenChange,
  currentWorkspaceId,
  selectedIds,
  onSelectionChange,
}: WorkspacePickerProps) {
  const [workspaces, setWorkspaces] = useState<RepoDTO[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchWorkspaces = async () => {
      setLoading(true);
      try {
        const repos = await listRepos();
        if (!cancelled) {
          setWorkspaces(repos.filter((r) => r.id !== currentWorkspaceId));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchWorkspaces();
    return () => { cancelled = true; };
  }, [open, currentWorkspaceId]);

  const toggleWorkspace = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Link Workspaces</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Linked workspaces are added as context so the agent can reference files in those codebases.
        </p>
        <div className="max-h-[300px] overflow-y-auto space-y-2">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">Loading workspaces...</div>
          ) : workspaces.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No other workspaces available.
            </div>
          ) : (
            workspaces.map((ws) => {
              const isSelected = selectedIds.includes(ws.id);
              return (
                <button
                  key={ws.id}
                  type="button"
                  onClick={() => toggleWorkspace(ws.id)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-colors',
                    isSelected
                      ? 'border-brand bg-brand/5'
                      : 'border-border hover:border-brand/50 hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      'mt-0.5 size-4 rounded border flex items-center justify-center shrink-0',
                      isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                    )}>
                      {isSelected && <Check className="size-3 text-primary-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FolderGit2 className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{ws.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {ws.path}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {selectedIds.length > 0
              ? `Link ${selectedIds.length} ${selectedIds.length === 1 ? 'workspace' : 'workspaces'}`
              : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
