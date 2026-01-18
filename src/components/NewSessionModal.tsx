'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { spawnAgent } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { GitBranch, Loader2 } from 'lucide-react';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
}

export function NewSessionModal({ isOpen, onClose, workspaceId, workspaceName }: NewSessionModalProps) {
  const [task, setTask] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { addSession, addConversation, selectSession, selectConversation } = useAppStore();

  useEffect(() => {
    if (isOpen) {
      setTask('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim()) return;

    setError('');
    setLoading(true);

    try {
      // Spawn agent via API
      const agent = await spawnAgent(workspaceId, task.trim());

      // Add session to store
      const session = {
        id: agent.id,
        workspaceId: agent.repoId,
        name: agent.branch,
        branch: agent.branch,
        worktreePath: agent.worktree,
        task: agent.task,
        status: 'active' as const,
        createdAt: agent.createdAt,
        updatedAt: agent.createdAt,
      };
      addSession(session);

      // Create conversation for this session
      const convId = `conv-${agent.id}`;
      addConversation({
        id: convId,
        sessionId: agent.id,
        title: task.trim().slice(0, 50) + (task.length > 50 ? '...' : ''),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Select the new session and conversation
      selectSession(agent.id);
      selectConversation(convId);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            New Session
          </DialogTitle>
          <DialogDescription>
            Create a new agent session in <span className="font-medium text-foreground">{workspaceName}</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe the task for the agent..."
                className="min-h-[100px] resize-none"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The agent will work in a separate git worktree and branch.
              </p>
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !task.trim()}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Session'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
