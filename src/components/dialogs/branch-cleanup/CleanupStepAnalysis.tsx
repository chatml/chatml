'use client';

import { useEffect } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { analyzeBranchCleanup } from '@/lib/api';
import type { CleanupAction } from './types';

interface CleanupStepAnalysisProps {
  workspaceId: string;
  staleDaysThreshold: number;
  retryCount: number;
  isLoading: boolean;
  error: string | null;
  dispatch: React.Dispatch<CleanupAction>;
  onCancel: () => void;
}

export function CleanupStepAnalysis({
  workspaceId,
  staleDaysThreshold,
  retryCount,
  isLoading,
  error,
  dispatch,
  onCancel,
}: CleanupStepAnalysisProps) {
  useEffect(() => {
    let cancelled = false;

    async function runAnalysis() {
      dispatch({ type: 'SET_LOADING', loading: true });
      dispatch({ type: 'SET_ERROR', error: '' });

      try {
        const result = await analyzeBranchCleanup(workspaceId, {
          staleDaysThreshold,
          includeRemote: true,
        });
        if (!cancelled) {
          dispatch({ type: 'SET_ANALYSIS', analysis: result });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : 'Analysis failed' });
        }
      }
    }

    runAnalysis();
    return () => { cancelled = true; };
  }, [workspaceId, staleDaysThreshold, retryCount, dispatch]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {error ? 'Analysis failed' : 'Analyzing branches...'}
        </DialogTitle>
        <DialogDescription>
          {error
            ? 'Something went wrong while scanning your branches.'
            : 'Scanning repository for branches that can be safely cleaned up.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center justify-center py-8 gap-4">
        {isLoading && !error && (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        )}

        {error && (
          <div className="text-center space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'RETRY' })}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}
