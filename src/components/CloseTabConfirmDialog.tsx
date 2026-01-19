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
import { Checkbox } from '@/components/ui/checkbox';
import { useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';

interface CloseTabConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationName: string;
  onConfirm: () => void;
}

export function CloseTabConfirmDialog({
  open,
  onOpenChange,
  conversationName,
  onConfirm,
}: CloseTabConfirmDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const setConfirmCloseActiveTab = useSettingsStore((s) => s.setConfirmCloseActiveTab);

  const handleConfirm = () => {
    if (dontAskAgain) {
      setConfirmCloseActiveTab(false);
    }
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    setDontAskAgain(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close conversation?</DialogTitle>
          <DialogDescription>
            This conversation has messages. Closing it will permanently delete the conversation and its history.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center space-x-2 py-2">
          <Checkbox
            id="dont-ask"
            checked={dontAskAgain}
            onCheckedChange={(checked) => setDontAskAgain(checked === true)}
          />
          <label
            htmlFor="dont-ask"
            className="text-sm text-muted-foreground cursor-pointer select-none"
          >
            Don&apos;t ask again
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Close conversation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
