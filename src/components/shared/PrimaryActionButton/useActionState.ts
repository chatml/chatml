import { useMemo } from 'react';
import {
  AlertTriangle,
  XCircle,
  RefreshCw,
  GitBranch,
  GitCommit,
  Upload,
  GitPullRequest,
  ExternalLink,
  Archive,
  FileEdit,
  GitMerge,
  Rocket,
  Package,
  History,
  Download,
  UserPlus,
  CheckCircle,
  XOctagon,
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
 * Priority order:
 * 1. Conflicts - "Resolve Conflicts" (destructive)
 * 2. CI failures - "Fix Issues" (destructive)
 * 3. In-progress operation - "Continue {Op}" with Abort dropdown (warning)
 * 4. Diverged - "Sync Branch" (info)
 * 5. Has changes - "Commit Changes" (default)
 * 6. Unpushed commits - "Push Changes" (default)
 * 7a. Open PR with unpushed - "Update PR" (success)
 * 7b. Open PR - "View PR" (success)
 * 8. Clean & ready - "Create PR" (success)
 * 9. PR merged - Hidden (null)
 * 10. Agent working - Disabled state
 */
export function useActionState(
  gitStatus: GitStatusDTO | null,
  session: Session | null | undefined,
  prDetails: PRDetails | null,
  isAgentWorking: boolean
): PrimaryAction | null {
  return useMemo(() => {
    // Priority 10: Agent is working - return disabled state
    if (isAgentWorking) {
      return {
        type: 'disabled',
        label: 'Working...',
        icon: RefreshCw,
        variant: 'default',
      };
    }

    // Priority 9: PR is merged - show archive session button
    if (session?.prStatus === 'merged') {
      return {
        type: 'archive-session',
        label: 'Archive Session',

        icon: Archive,
        variant: 'default',
        sessionId: session.id,
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
        label: 'Resolve Conflicts',

        icon: XCircle,
        variant: 'destructive',
        message: 'Resolve the merge conflicts',
      };
    }

    // Priority 2: CI check failures (only if we have PR details)
    if (prDetails?.checkStatus === 'failure') {
      return {
        type: 'fix-issues',
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
        label: 'Sync Branch',

        icon: GitBranch,
        variant: 'info',
        message: `Rebase my branch on ${sync.baseBranch}`,
        dropdownActions: [
          { label: 'Merge Instead', message: `Merge ${sync.baseBranch} into my branch`, icon: GitMerge },
          { label: 'Pull Only', message: 'Pull changes from the remote branch', icon: Download },
        ],
      };
    }

    // Priority 5: Has uncommitted changes
    if (workingDirectory.hasChanges) {
      return {
        type: 'commit-changes',
        label: 'Commit Changes',

        icon: GitCommit,
        variant: 'purple',
        message: 'Commit my changes',
        dropdownActions: [
          { label: 'Commit & Push', message: 'Commit my changes and push to remote', icon: Rocket },
          { label: 'Commit & Create PR', message: 'Commit my changes, push to remote, and create a pull request', icon: GitPullRequest },
          { label: 'Stash Changes', message: 'Stash my changes for later', icon: Package },
          { label: 'Amend Last Commit', message: 'Add these changes to my last commit', icon: History },
        ],
      };
    }

    // Priority 6: Has unpushed commits (no open PR)
    if (sync.unpushedCommits > 0 && session?.prStatus !== 'open') {
      return {
        type: 'push-changes',
        label: 'Push Changes',

        icon: Upload,
        variant: 'default',
        message: 'Push my commits',
        dropdownActions: [
          { label: 'Push & Create PR', message: 'Push my commits and create a pull request', icon: GitPullRequest },
          { label: 'Force Push', message: 'Force push my commits to the remote branch', icon: Upload },
        ],
      };
    }

    // Priority 7a: Open PR with unpushed commits
    if (session?.prStatus === 'open' && sync.unpushedCommits > 0) {
      return {
        type: 'update-pr',
        label: 'Update PR',
        icon: GitPullRequest,
        variant: 'success',
        message: 'Push the latest changes to the PR',
        dropdownActions: [
          { label: 'Force Push', message: 'Force push to update the PR', icon: Upload },
          { label: 'Squash & Push', message: 'Squash commits into one and push to the PR', icon: GitMerge },
        ],
      };
    }

    // Priority 7b: Open PR (view only)
    if (session?.prStatus === 'open') {
      // Variant depends on CI check status:
      // - checks passed or no checks → green (success)
      // - checks pending or unknown  → neutral (default)
      // Note: checks failed is caught by Priority 2 above
      const mergeVariant =
        prDetails?.checkStatus === 'success' || prDetails?.checkStatus === 'none'
          ? 'success' as const
          : 'default' as const;

      return {
        type: 'view-pr',
        label: 'Merge PR',
        icon: GitMerge,
        variant: mergeVariant,
        message: 'Squash and merge the pull request',
        dropdownActions: [
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
        ],
      };
    }

    // Priority 8: Clean state with commits ahead - ready to create PR
    // Only show "Create PR" if we have commits ahead of the base branch
    if (sync.aheadBy > 0) {
      return {
        type: 'create-pr',
        label: 'New Pull Request',

        icon: GitPullRequest,
        variant: 'success',
        message: 'Create a pull request',
        dropdownActions: [
          { label: 'Create PR in Draft', message: 'Create a draft pull request', icon: FileEdit },
          { label: 'Push Changes Only', message: 'Push my commits to the remote branch', icon: Upload },
          { label: 'Squash & Create PR', message: 'Squash my commits into one and create a pull request', icon: GitMerge },
        ],
      };
    }

    // Priority 9: Completely clean state - nothing to do, hide button
    return null;
  }, [gitStatus, session, prDetails, isAgentWorking]);
}
