'use client';

import { useMemo } from 'react';
import { AlertTriangle, GitBranch, Cloud, Monitor, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CleanupAction, CleanupState } from './types';

interface CleanupStepConfirmationProps {
  state: CleanupState;
  dispatch: React.Dispatch<CleanupAction>;
  onExecute: () => void;
}

export function CleanupStepConfirmation({
  state,
  dispatch,
  onExecute,
}: CleanupStepConfirmationProps) {
  const { selectedBranches, error } = state;

  const { localCount, remoteCount, branches } = useMemo(() => {
    let local = 0;
    let remote = 0;
    const items: { name: string; deleteLocal: boolean; deleteRemote: boolean }[] = [];

    for (const [, target] of selectedBranches) {
      if (target.deleteLocal) local++;
      if (target.deleteRemote) remote++;
      items.push(target);
    }

    return { localCount: local, remoteCount: remote, branches: items };
  }, [selectedBranches]);

  const hasRemote = remoteCount > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirm Branch Cleanup</DialogTitle>
        <DialogDescription>
          Please review the branches that will be deleted.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* Error from failed execution attempt */}
        {error && (
          <div className="flex items-start gap-2.5 p-3 rounded-md border border-red-500/30 bg-red-500/5">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">{error}</div>
          </div>
        )}

        {/* Summary */}
        <div className="flex gap-4 text-sm">
          {localCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{localCount} local {localCount === 1 ? 'branch' : 'branches'}</span>
            </div>
          )}
          {remoteCount > 0 && (
            <div className="flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5 text-blue-400" />
              <span>{remoteCount} remote {remoteCount === 1 ? 'branch' : 'branches'}</span>
            </div>
          )}
        </div>

        {/* Remote warning */}
        {hasRemote && (
          <div className="flex items-start gap-2.5 p-3 rounded-md border border-red-500/30 bg-red-500/5">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-red-300">
              <strong>Remote branch deletion is permanent</strong> and may affect other team members
              who have checked out these branches.
            </div>
          </div>
        )}

        {/* Branch list */}
        <div className="max-h-[250px] overflow-y-auto rounded-md border border-border bg-surface-1 divide-y divide-border">
          {branches.map(branch => (
            <div key={branch.name} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="font-mono truncate">{branch.name}</span>
              <div className="flex items-center gap-1 ml-auto shrink-0">
                {branch.deleteLocal && (
                  <span className="text-2xs text-muted-foreground px-1 py-0.5 rounded bg-muted">
                    local
                  </span>
                )}
                {branch.deleteRemote && (
                  <span className="text-2xs text-red-400 px-1 py-0.5 rounded bg-red-500/10">
                    remote
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => dispatch({ type: 'SET_STEP', step: 'review' })}>
          Back
        </Button>
        <Button variant="destructive" onClick={onExecute}>
          Delete {selectedBranches.size} {selectedBranches.size === 1 ? 'branch' : 'branches'}
        </Button>
      </DialogFooter>
    </>
  );
}
