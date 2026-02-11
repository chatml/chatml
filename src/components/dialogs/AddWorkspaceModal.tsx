'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore, getBranchPrefix, getWorkspaceBranchPrefix } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { addRepo, createSession as createSessionApi, listConversations as listConversationsApi, mapSessionDTO } from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
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
import { FolderGit2, AlertCircle, FolderOpen } from 'lucide-react';
import { openFolderDialog } from '@/lib/tauri';

interface AddWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddWorkspaceModal({ isOpen, onClose }: AddWorkspaceModalProps) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { addWorkspace, addSession, addConversation } = useAppStore(
    useShallow((s) => ({
      addWorkspace: s.addWorkspace,
      addSession: s.addSession,
      addConversation: s.addConversation,
    }))
  );
  const { expandWorkspace } = useSettingsStore();

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
      // Call backend API to validate and add repo
      const repo = await addRepo(path);

      // Map to workspace and add to store
      const workspace = {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        defaultBranch: repo.branch,
        remote: repo.remote || 'origin',
        branchPrefix: repo.branchPrefix || '',
        customPrefix: repo.customPrefix || '',
        createdAt: repo.createdAt,
      };
      addWorkspace(workspace);

      // Auto-create first session for the new workspace (backend generates city-based name)
      const branchPrefix = workspace.branchPrefix
        ? getWorkspaceBranchPrefix(workspace)
        : getBranchPrefix();
      const session = await createSessionApi(workspace.id, {
        ...(branchPrefix !== undefined && { branchPrefix }),
      });

      addSession(mapSessionDTO(session));

      // Fetch conversations created by backend (includes "Untitled" with setup info)
      const conversations = await listConversationsApi(workspace.id, session.id);
      conversations.forEach((conv) => {
        addConversation({
          id: conv.id,
          sessionId: conv.sessionId,
          type: conv.type,
          name: conv.name,
          status: conv.status,
          messages: conv.messages.map((m) => ({
            id: m.id,
            conversationId: conv.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            setupInfo: (m as { setupInfo?: SetupInfo }).setupInfo,
            timestamp: m.timestamp,
          })),
          toolSummary: conv.toolSummary,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      });

      expandWorkspace(workspace.id);
      navigate({
        workspaceId: workspace.id,
        sessionId: session.id,
        contentView: { type: 'conversation' },
      });

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
              <div className="flex gap-2">
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/your/repository"
                  className="font-mono text-sm flex-1"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={async () => {
                    const selectedPath = await openFolderDialog('Select Repository');
                    if (selectedPath) {
                      setPath(selectedPath);
                    }
                  }}
                >
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </div>
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
