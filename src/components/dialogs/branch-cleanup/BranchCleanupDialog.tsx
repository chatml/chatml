'use client';

import { useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { executeBranchCleanup } from '@/lib/api';
import { useCleanupReducer } from './useCleanupReducer';
import { CleanupStepAnalysis } from './CleanupStepAnalysis';
import { CleanupStepReview } from './CleanupStepReview';
import { CleanupStepConfirmation } from './CleanupStepConfirmation';
import { CleanupStepExecution } from './CleanupStepExecution';
import { CleanupStepResults } from './CleanupStepResults';

interface BranchCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onComplete: () => void;
}

export function BranchCleanupDialog({
  open,
  onOpenChange,
  workspaceId,
  onComplete,
}: BranchCleanupDialogProps) {
  const [state, dispatch] = useCleanupReducer();

  const handleCancel = useCallback(() => {
    onOpenChange(false);
    // Reset state after dialog closes
    setTimeout(() => dispatch({ type: 'RESET' }), 200);
  }, [onOpenChange, dispatch]);

  const handleDone = useCallback(() => {
    onOpenChange(false);
    onComplete();
    setTimeout(() => dispatch({ type: 'RESET' }), 200);
  }, [onOpenChange, onComplete, dispatch]);

  const handleExecute = useCallback(async () => {
    dispatch({ type: 'SET_STEP', step: 'execution' });
    dispatch({ type: 'SET_LOADING', loading: true });

    try {
      const targets = Array.from(state.selectedBranches.values());
      const result = await executeBranchCleanup(workspaceId, targets);
      dispatch({ type: 'SET_RESULTS', results: result });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Cleanup failed',
      });
      dispatch({ type: 'SET_STEP', step: 'confirmation' });
    }
  }, [workspaceId, state.selectedBranches, dispatch]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    // Prevent closing during execution
    if (state.step === 'execution') return;
    if (!nextOpen) {
      handleCancel();
    }
  }, [state.step, handleCancel]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={state.step !== 'execution'} className="sm:max-w-2xl">
        <DialogTitle className="sr-only">Branch Cleanup</DialogTitle>
        {state.step === 'analysis' && (
          <CleanupStepAnalysis
            workspaceId={workspaceId}
            staleDaysThreshold={state.staleDaysThreshold}
            retryCount={state.retryCount}
            error={state.error}
            dispatch={dispatch}
            onCancel={handleCancel}
          />
        )}

        {state.step === 'review' && (
          <CleanupStepReview
            state={state}
            dispatch={dispatch}
            onCancel={handleCancel}
          />
        )}

        {state.step === 'confirmation' && (
          <CleanupStepConfirmation
            state={state}
            dispatch={dispatch}
            onExecute={handleExecute}
          />
        )}

        {state.step === 'execution' && (
          <CleanupStepExecution
            totalCount={state.selectedBranches.size}
          />
        )}

        {state.step === 'results' && state.results && (
          <CleanupStepResults
            results={state.results}
            onDone={handleDone}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
