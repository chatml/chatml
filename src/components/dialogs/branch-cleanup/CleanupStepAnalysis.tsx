'use client';

import { useEffect } from 'react';
import { Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
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
  error: string | null;
  dispatch: React.Dispatch<CleanupAction>;
  onCancel: () => void;
}

export function CleanupStepAnalysis({
  workspaceId,
  staleDaysThreshold,
  retryCount,
  error,
  dispatch,
  onCancel,
}: CleanupStepAnalysisProps) {
  // Run analysis on mount / retry
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
          dispatch({ type: 'SET_LOADING', loading: false });
          dispatch({
            type: 'SET_ERROR',
            error: err instanceof Error ? err.message : 'Analysis failed',
          });
        }
      }
    }

    runAnalysis();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, staleDaysThreshold, retryCount, dispatch]);

  // --- Error state ---
  if (error) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Analysis Failed</DialogTitle>
          <DialogDescription>
            Something went wrong while scanning your branches.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center py-6">
          <div className="animate-scale-in w-full max-w-sm rounded-lg border border-destructive/30 bg-destructive/5 p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Unable to complete analysis
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {error}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'RETRY' })}
                className="gap-1.5"
              >
                <RotateCcw className="h-3 w-3" />
                Try Again
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    );
  }

  // --- Loading state ---
  return (
    <>
      <DialogHeader>
        <DialogTitle>Analyzing Branches</DialogTitle>
        <DialogDescription>
          Scanning your repository for branches that can be safely cleaned up.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          This may take a moment...
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </DialogFooter>
    </>
  );
}
