import { useMemo } from 'react';
import {
  AlertTriangle,
  XCircle,
  GitBranch,
  GitCommit,
  Upload,
  GitPullRequest,
  Archive,
  FileEdit,
  GitMerge,
  Rocket,
  Download,
} from 'lucide-react';
import type { GitStatusDTO, PRDetails } from '@/lib/api';
import type { PrimaryAction } from './types';

interface Session {
  id?: string;
  status?: string;
  prStatus?: string;
  prUrl?: string;
}

/**
 * Hook that determines the primary action based on git status, session state, and PR details.
 *
 * Three-tier color system:
 *   Alert (red)    — blockers that need fixing
 *   Action (primary) — the natural next workflow step
 *   Complete (green) — terminal/done state
 *
 * Priority order:
 * 1.  Local conflicts  → "Resolve Conflicts"   (alert)
 * 1b. GH conflicts     → "Resolve Conflicts"   (alert) — PR mergeable=false
 * 2.  CI failures      → "Fix Issues"          (alert)
 * 3. In-progress op   → "Continue {Op}"       (action)
 * 4. Diverged         → "Sync Branch"         (action)
 * 5. Work to ship     → "New Pull Request"    (action) — collapses commit/push/create-pr
 * 6. Open PR          → "Merge PR"            (action) — includes "Push Latest" when needed
 * 7. PR merged        → "Archive Session"     (complete)
 */
export function useActionState(
  gitStatus: GitStatusDTO | null,
  session: Session | null | undefined,
  prDetails: PRDetails | null,
): PrimaryAction | null {
  return useMemo(() => {
    // Priority 7: PR is merged — show archive session button
    // Check both the session store (updated by PRWatcher) and live prDetails
    // (fetched from GitHub) to handle the case where the PR was just merged
    // but the store hasn't been updated yet.
    if (session?.prStatus === 'merged' || prDetails?.merged) {
      return {
        type: 'archive-session',
        tier: 'complete',
        label: 'Archive Session',
        icon: Archive,
        variant: 'success',
        sessionId: session?.id,
      };
    }

    // If we don't have git status yet, hide button until we know the state
    if (!gitStatus) {
      return null;
    }

    const { conflicts, inProgress, sync, workingDirectory } = gitStatus;

    // Priority 1: Merge conflicts
    if (conflicts.hasConflicts) {
      return {
        type: 'resolve-conflicts',
        tier: 'alert',
        label: 'Resolve Conflicts',
        icon: XCircle,
        variant: 'destructive',
        message: 'Resolve the merge conflicts',
      };
    }

    // Priority 1.5: GitHub merge conflicts (PR can't be merged)
    // This catches the case where GitHub reports conflicts but no local merge is in progress yet.
    if (session?.prStatus === 'open' && prDetails && (prDetails.mergeableState === 'dirty' || prDetails.mergeable === false)) {
      return {
        type: 'resolve-conflicts',
        tier: 'alert',
        label: 'Resolve Conflicts',
        icon: XCircle,
        variant: 'destructive',
        message: `Rebase my branch on ${sync.baseBranch} to resolve the merge conflicts`,
        dropdownActions: [
          { label: 'Merge Instead', message: `Merge ${sync.baseBranch} into my branch to resolve conflicts`, icon: GitMerge },
        ],
      };
    }

    // Priority 2: CI check failures (only if we have PR details)
    if (prDetails?.checkStatus === 'failure') {
      return {
        type: 'fix-issues',
        tier: 'alert',
        label: 'Fix Issues',
        icon: XCircle,
        variant: 'destructive',
        message: 'Fix the failing CI checks',
      };
    }

    // Priority 3: In-progress git operation
    if (inProgress.type !== 'none') {
      const opType = inProgress.type;
      const capitalizedOp = opType.charAt(0).toUpperCase() + opType.slice(1);

      return {
        type: `continue-${opType}` as PrimaryAction['type'],
        tier: 'action',
        label: `Continue ${capitalizedOp}`,
        icon: AlertTriangle,
        variant: 'warning',
        message: `Continue the ${opType}`,
        secondaryAction: {
          label: 'Abort',
          message: `Abort the ${opType}`,
        },
      };
    }

    // Priority 4: Branch is diverged from base
    if (sync.diverged) {
      return {
        type: 'sync-branch',
        tier: 'action',
        label: 'Sync Branch',
        icon: GitBranch,
        variant: 'default',
        message: `Rebase my branch on ${sync.baseBranch}`,
        dropdownActions: [
          { label: 'Merge Instead', message: `Merge ${sync.baseBranch} into my branch`, icon: GitMerge },
          { label: 'Pull Only', message: 'Pull changes from the remote branch', icon: Download },
        ],
      };
    }

    // Priority 5: Work to ship — uncommitted changes, unpushed commits, or commits ahead (no open PR)
    // Collapses the old "Commit Changes", "Push Changes", and "Create PR" into one action.
    const hasChanges = workingDirectory.hasChanges;
    const hasUnpushed = sync.unpushedCommits > 0;
    const hasAhead = sync.aheadBy > 0;
    const hasOpenPR = session?.prStatus === 'open';

    if ((hasChanges || hasUnpushed || hasAhead) && !hasOpenPR) {
      // Adapt the primary message based on what work is needed
      let message: string;
      if (hasChanges) {
        message = 'Commit all changes, push to remote, and create a pull request';
      } else if (hasUnpushed) {
        message = 'Push commits and create a pull request';
      } else {
        message = 'Create a pull request';
      }

      // Build contextual dropdown options
      const dropdownActions: PrimaryAction['dropdownActions'] = [];

      if (hasChanges) {
        dropdownActions.push(
          { label: 'Commit Only', message: 'Commit my changes', icon: GitCommit },
          { label: 'Commit & Push', message: 'Commit my changes and push to remote', icon: Rocket },
        );
      }
      if (hasUnpushed && !hasChanges) {
        dropdownActions.push(
          { label: 'Push Only', message: 'Push my commits to the remote branch', icon: Upload },
        );
      }
      dropdownActions.push(
        { label: 'Create PR in Draft', message: hasChanges
          ? 'Commit all changes, push to remote, and create a draft pull request'
          : hasUnpushed
            ? 'Push commits and create a draft pull request'
            : 'Create a draft pull request', icon: FileEdit },
      );

      return {
        type: 'create-pr',
        tier: 'action',
        label: 'New Pull Request',
        icon: GitPullRequest,
        variant: 'default',
        message,
        dropdownActions,
      };
    }

    // Priority 6: Open PR — always show "Merge PR", with "Push Latest" in dropdown when needed
    // Variant depends on CI check status:
    // - checks passed or no checks → green (success) — safe to merge signal
    // - checks pending or unknown  → neutral (default)
    // Note: checks failed is caught by Priority 2 above
    if (hasOpenPR) {
      const mergeVariant =
        prDetails?.checkStatus === 'success' || prDetails?.checkStatus === 'none'
          ? 'success' as const
          : 'default' as const;

      const dropdownActions: PrimaryAction['dropdownActions'] = [];

      // Add push option when there are unpushed commits
      if (hasUnpushed) {
        dropdownActions.push(
          { label: 'Push Latest Changes', message: 'Push the latest changes to the PR', icon: Upload },
        );
      }

      dropdownActions.push(
        {
          label: 'Create a merge commit',
          message: 'Merge the pull request with a merge commit',
          description: 'All commits from this branch will be added to the base branch via a merge commit.',
        },
        {
          label: 'Squash and merge',
          message: 'Squash and merge the pull request',
          description: 'The commits from this branch will be combined into one commit in the base branch.',
        },
        {
          label: 'Rebase and merge',
          message: 'Rebase and merge the pull request',
          description: 'The commits from this branch will be rebased and added to the base branch.',
        },
      );

      return {
        type: 'view-pr',
        tier: 'action',
        label: 'Merge PR',
        icon: GitMerge,
        variant: mergeVariant,
        message: 'Squash and merge the pull request',
        dropdownActions,
      };
    }

    // Clean state — nothing to do, hide button
    return null;
  }, [gitStatus, session, prDetails]);
}
