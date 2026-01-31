'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useSettingsStore } from '@/stores/settingsStore';

export interface ArchiveSessionDialogGitStatus {
  uncommittedCount: number;
  untrackedCount: number;
  unpushedCommits: number;
}

interface ArchiveSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  sessionName: string;
  gitStatus: ArchiveSessionDialogGitStatus;
}

export function ArchiveSessionDialog({
  open,
  onOpenChange,
  onConfirm,
  sessionName,
  gitStatus,
}: ArchiveSessionDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const setConfirmArchiveDirtySession = useSettingsStore(
    (s) => s.setConfirmArchiveDirtySession
  );

  const handleConfirm = () => {
    if (dontAskAgain) {
      setConfirmArchiveDirtySession(false);
    }
    onConfirm();
    onOpenChange(false);
  };

  const details: string[] = [];
  if (gitStatus.uncommittedCount > 0) {
    details.push(
      `${gitStatus.uncommittedCount} uncommitted change${gitStatus.uncommittedCount !== 1 ? 's' : ''}`
    );
  }
  if (gitStatus.untrackedCount > 0) {
    details.push(
      `${gitStatus.untrackedCount} untracked file${gitStatus.untrackedCount !== 1 ? 's' : ''}`
    );
  }
  if (gitStatus.unpushedCommits > 0) {
    details.push(
      `${gitStatus.unpushedCommits} unpushed commit${gitStatus.unpushedCommits !== 1 ? 's' : ''}`
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive session with unsaved changes?</DialogTitle>
          <DialogDescription>
            <strong>{sessionName}</strong> has {details.join(', ')}. These
            changes will remain in the worktree but the session will be hidden
            from your active list.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-1">
          <Checkbox
            id="dont-ask-again"
            checked={dontAskAgain}
            onCheckedChange={(checked) => setDontAskAgain(checked === true)}
          />
          <label
            htmlFor="dont-ask-again"
            className="text-sm text-muted-foreground cursor-pointer select-none"
          >
            Don&apos;t ask again
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Archive anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
