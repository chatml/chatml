'use client';

import { Loader2 } from 'lucide-react';
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CleanupStepExecutionProps {
  totalCount: number;
}

export function CleanupStepExecution({ totalCount }: CleanupStepExecutionProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Cleaning up branches...</DialogTitle>
        <DialogDescription>
          Deleting {totalCount} {totalCount === 1 ? 'branch' : 'branches'}. Please wait.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          This may take a moment for remote branches...
        </p>
      </div>
    </>
  );
}
