'use client';

import { useState, useCallback, useRef } from 'react';
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
import { generatePRDescription, createPR } from '@/lib/api';
import { Loader2, RefreshCw, GitPullRequest, AlertCircle } from 'lucide-react';

interface CreatePRDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  sessionId: string;
  onSuccess: (prUrl: string) => void;
}

type DialogState = 'generating' | 'ready' | 'creating' | 'error';

export function CreatePRDialog({
  open,
  onOpenChange,
  workspaceId,
  sessionId,
  onSuccess,
}: CreatePRDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [state, setState] = useState<DialogState>('generating');
  const [error, setError] = useState<string | null>(null);
  const generateCountRef = useRef(0);

  const generate = useCallback(async () => {
    const id = ++generateCountRef.current;
    setState('generating');
    setError(null);
    try {
      const result = await generatePRDescription(workspaceId, sessionId);
      if (id !== generateCountRef.current) return; // stale request
      setTitle(result.title);
      setBody(result.body);
      setState('ready');
    } catch (err) {
      if (id !== generateCountRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to generate PR description');
      setState('error');
    }
  }, [workspaceId, sessionId]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (!nextOpen) {
        // Reset state when dialog closes
        setTitle('');
        setBody('');
        setDraft(false);
        setState('generating');
        setError(null);
      }
    },
    [onOpenChange],
  );

  const handleOpenAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault(); // We'll manage focus via the Input autoFocus prop
      generate();
    },
    [generate],
  );

  const handleCreate = async () => {
    if (!title.trim()) return;
    setState('creating');
    setError(null);
    try {
      const result = await createPR(workspaceId, sessionId, {
        title: title.trim(),
        body,
        draft,
      });
      handleOpenChange(false);
      onSuccess(result.htmlUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request');
      setState('ready');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={handleOpenAutoFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            New Pull Request
          </DialogTitle>
          <DialogDescription>
            Create a pull request for this branch.
          </DialogDescription>
        </DialogHeader>

        {state === 'generating' ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Generating PR description...
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="pr-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="pr-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="PR title"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="pr-body" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="pr-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="PR description (markdown supported)"
                rows={8}
                className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft}
                onChange={(e) => setDraft(e.target.checked)}
                className="rounded border-input"
              />
              Create as draft
            </label>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={generate}
            disabled={state === 'generating' || state === 'creating'}
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Regenerate
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={state !== 'ready' || !title.trim()}
          >
            {state === 'creating' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Pull Request'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
