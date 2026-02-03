'use client';

import { useMemo } from 'react';
import {
  GitBranch,
  Lock,
  AlertTriangle,
  Cloud,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CleanupCandidate, CleanupBranchTarget } from '@/lib/api';
import type { CleanupAction, CleanupState } from './types';

interface CleanupStepReviewProps {
  state: CleanupState;
  dispatch: React.Dispatch<CleanupAction>;
  onCancel: () => void;
}

const categoryConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  merged: { label: 'Merged', color: 'text-green-400', bgColor: 'bg-green-500/10 border-green-500/20' },
  stale: { label: 'Stale', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10 border-yellow-500/20' },
  orphaned: { label: 'Orphaned', color: 'text-orange-400', bgColor: 'bg-orange-500/10 border-orange-500/20' },
  safe: { label: 'Protected', color: 'text-muted-foreground', bgColor: 'bg-muted/50 border-border' },
};

function CategoryBadge({ category }: { category: string }) {
  const config = categoryConfig[category] || categoryConfig.safe;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium border ${config.bgColor} ${config.color}`}>
      {config.label}
    </span>
  );
}

function BranchRow({
  candidate,
  isSelected,
  onToggle,
}: {
  candidate: CleanupCandidate;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors
        ${candidate.deletable ? 'hover:bg-surface-2' : 'opacity-60 cursor-default'}`}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        disabled={!candidate.deletable}
        className="shrink-0"
      />
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {candidate.isProtected ? (
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-mono truncate">
          {candidate.isRemote
            ? candidate.name.replace(/^origin\//, '')
            : candidate.name}
        </span>
        {candidate.isRemote && (
          <Cloud className="h-3 w-3 text-blue-400 shrink-0" />
        )}
        {candidate.hasLocalAndRemote && !candidate.isRemote && (
          <span className="flex items-center gap-0.5 text-2xs text-muted-foreground">
            <Monitor className="h-2.5 w-2.5" />+<Cloud className="h-2.5 w-2.5" />
          </span>
        )}
        <CategoryBadge category={candidate.category} />
      </div>
      <span className="text-xs text-muted-foreground shrink-0 max-w-[200px] truncate">
        {candidate.reason}
      </span>
    </label>
  );
}

function CategorySection({
  category,
  candidates,
  selectedBranches,
  dispatch,
}: {
  category: string;
  candidates: CleanupCandidate[];
  selectedBranches: Map<string, CleanupBranchTarget>;
  dispatch: React.Dispatch<CleanupAction>;
}) {
  const config = categoryConfig[category] || categoryConfig.safe;
  const deletable = candidates.filter(c => c.deletable);
  const selectedCount = candidates.filter(c => selectedBranches.has(c.name)).length;
  const allSelected = deletable.length > 0 && selectedCount === deletable.length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-3 py-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground">
            ({candidates.length})
          </span>
        </div>
        {deletable.length > 0 && (
          <button
            type="button"
            className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              if (allSelected) {
                dispatch({ type: 'DESELECT_ALL_CATEGORY', category });
              } else {
                dispatch({ type: 'SELECT_ALL_CATEGORY', category });
              }
            }}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>
      {candidates.map(candidate => (
        <BranchRow
          key={candidate.name}
          candidate={candidate}
          isSelected={selectedBranches.has(candidate.name)}
          onToggle={() =>
            dispatch({
              type: 'TOGGLE_BRANCH',
              name: candidate.name,
              isRemote: candidate.isRemote,
              hasLocalAndRemote: candidate.hasLocalAndRemote,
            })
          }
        />
      ))}
    </div>
  );
}

export function CleanupStepReview({
  state,
  dispatch,
  onCancel,
}: CleanupStepReviewProps) {
  const { analysis, selectedBranches, deleteRemoteToo } = state;

  const grouped = useMemo(() => {
    if (!analysis) return {};
    const groups: Record<string, CleanupCandidate[]> = {};
    for (const candidate of analysis.candidates) {
      const cat = candidate.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(candidate);
    }
    return groups;
  }, [analysis]);

  const selectedCount = selectedBranches.size;
  const hasRemoteCandidates = analysis?.candidates.some(c => c.hasLocalAndRemote && !c.isRemote) ?? false;

  // Count how many deletable candidates exist
  const deletableCount = analysis?.candidates.filter(c => c.deletable).length ?? 0;
  const isEmpty = deletableCount === 0;

  if (!analysis) return null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Branch Cleanup</DialogTitle>
        <DialogDescription>
          {isEmpty ? (
            'Your repository is clean — no branches need cleanup.'
          ) : (
            <>
              Found {deletableCount} {deletableCount === 1 ? 'branch' : 'branches'} to clean up
              {analysis.protectedCount > 0 && (
                <> &middot; {analysis.protectedCount} protected</>
              )}
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      {!isEmpty && (
        <div className="max-h-[400px] overflow-y-auto -mx-6 px-6 space-y-3">
          {/* Show categories in order: merged, stale, orphaned, safe */}
          {['merged', 'stale', 'orphaned', 'safe'].map(category => {
            const candidates = grouped[category];
            if (!candidates || candidates.length === 0) return null;
            return (
              <CategorySection
                key={category}
                category={category}
                candidates={candidates}
                selectedBranches={selectedBranches}
                dispatch={dispatch}
              />
            );
          })}
        </div>
      )}

      {!isEmpty && hasRemoteCandidates && (
        <label className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-2 cursor-pointer">
          <Checkbox
            checked={deleteRemoteToo}
            onCheckedChange={() => dispatch({ type: 'TOGGLE_REMOTE_DELETE' })}
          />
          <div className="flex items-center gap-1.5">
            {deleteRemoteToo && (
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
            )}
            <span className="text-sm">Also delete remote branches</span>
          </div>
        </label>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {!isEmpty && (
          <Button
            variant="destructive"
            disabled={selectedCount === 0}
            onClick={() => dispatch({ type: 'SET_STEP', step: 'confirmation' })}
          >
            Review deletion ({selectedCount})
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
