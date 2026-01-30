'use client';

import { useState } from 'react';
import { Check, AlertTriangle, ChevronDown, ChevronRight, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CleanupResult } from '@/lib/api';

interface CleanupStepResultsProps {
  results: CleanupResult;
  onDone: () => void;
}

export function CleanupStepResults({ results, onDone }: CleanupStepResultsProps) {
  const [showErrors, setShowErrors] = useState(false);
  const hasFailures = results.failed.length > 0;
  const successCount = results.succeeded.length;
  const failCount = results.failed.length;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {hasFailures ? (
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
          ) : (
            <Check className="h-5 w-5 text-green-400" />
          )}
          Cleanup Complete
        </DialogTitle>
        <DialogDescription>
          {successCount > 0 && (
            <>Successfully deleted {successCount} {successCount === 1 ? 'branch' : 'branches'}.</>
          )}
          {hasFailures && (
            <> {failCount} {failCount === 1 ? 'branch' : 'branches'} could not be deleted.</>
          )}
          {successCount === 0 && !hasFailures && (
            <>No branches were deleted.</>
          )}
        </DialogDescription>
      </DialogHeader>

      {hasFailures && (
        <div className="space-y-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowErrors(!showErrors)}
          >
            {showErrors ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {failCount} failed {failCount === 1 ? 'deletion' : 'deletions'}
          </button>

          {showErrors && (
            <div className="max-h-[200px] overflow-y-auto rounded-md border border-border bg-surface-1 divide-y divide-border">
              {results.failed.map(result => (
                <div key={result.name} className="px-3 py-2 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm">
                    <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                    <span className="font-mono truncate">{result.name}</span>
                  </div>
                  {result.deletedLocal && (
                    <p className="text-xs text-yellow-400 pl-[18px]">Local branch was deleted</p>
                  )}
                  {result.error && (
                    <p className="text-xs text-muted-foreground pl-[18px]">{result.error}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <Button onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
