'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CloseFileConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  onSave: () => void;
  onDontSave: () => void;
}

export function CloseFileConfirmDialog({
  open,
  onOpenChange,
  fileName,
  onSave,
  onDontSave,
}: CloseFileConfirmDialogProps) {
  const handleSave = () => {
    onSave();
    onOpenChange(false);
  };

  const handleDontSave = () => {
    onDontSave();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogDescription>
            Do you want to save the changes you made to <span className="font-medium text-foreground">{fileName}</span>?
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleDontSave}>
              Don&apos;t Save
            </Button>
            <Button onClick={handleSave}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
