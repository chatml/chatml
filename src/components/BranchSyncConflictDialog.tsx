'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, FileWarning, Loader2 } from 'lucide-react';

interface BranchSyncConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: 'rebase' | 'merge';
  conflictFiles: string[];
  onAbort: () => void;
  aborting?: boolean;
}

export function BranchSyncConflictDialog({
  open,
  onOpenChange,
  operation,
  conflictFiles,
  onAbort,
  aborting,
}: BranchSyncConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {operation === 'rebase' ? 'Rebase' : 'Merge'} Conflicts
          </DialogTitle>
          <DialogDescription>
            The {operation} operation resulted in conflicts that need to be resolved.
            You can abort the {operation} to return to the previous state.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <p className="text-sm text-muted-foreground mb-2">
            Files with conflicts ({conflictFiles.length}):
          </p>
          <ScrollArea className="h-40 border rounded-md">
            <div className="p-2 space-y-1">
              {conflictFiles.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/50"
                >
                  <FileWarning className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="truncate font-mono text-xs">{file}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={aborting}
          >
            Keep Working
          </Button>
          <Button
            variant="destructive"
            onClick={onAbort}
            disabled={aborting}
          >
            {aborting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Aborting...
              </>
            ) : (
              `Abort ${operation === 'rebase' ? 'Rebase' : 'Merge'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
