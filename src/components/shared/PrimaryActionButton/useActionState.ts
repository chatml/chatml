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
  Combine,
  Rocket,
  Download,
  Lightbulb,
  Eye,
  TestTube,
} from 'lucide-react';
import type { GitStatusDTO, PRDetails } from '@/lib/api';
import type { WorktreeSession, SprintPhase } from '@/lib/types';
import type { PrimaryAction } from './types';

type Session = Pick<Partial<WorktreeSession>, 'id' | 'status' | 'prStatus' | 'prUrl' | 'checkStatus' | 'sprintPhase'>;

/**
 * Hook that determines the primary action based on git status, session state, and PR details.
 *
 * Color system:
 *   Red (destructive) — blockers that need fixing
 *   Yellow (warning)  — in-progress operations needing attention
 *   Green (success)   — positive forward actions (create PR, merge)
 *   Purple (default)  — neutral actions (sync, archive)
 *
 * Priority order:
 * 1.  Local conflicts  → "Resolve Conflicts"   (red)
 * 1b. GH conflicts     → "Resolve Conflicts"   (red) — PR mergeable=false
 * 2.  CI failures      → "Fix Issues"          (red)
 * 3. In-progress op   → "Continue {Op}"       (yellow)
 * 4. Diverged         → "Sync Branch"         (purple)
 * 5. Work to ship     → "New Pull Request"    (green)
 * 6. Open PR (CI ok)  → "Merge PR"            (green) — hidden while CI pending
 * 7. PR merged (clean) → "Archive Session"     (purple)
 * 7b. PR merged + work → falls through to 1–6  (allows new PR cycle)
 */
export function useActionState(
  gitStatus: GitStatusDTO | null,
  session: Session | null | undefined,
  prDetails: PRDetails | null,
): PrimaryAction | null {
  return useMemo(() => {
    // Merge WebSocket-updated store value (session.checkStatus) with polled API value
    // (prDetails.checkStatus). WebSocket is real-time but updates can be missed, while
    // prDetails polls every 90s but is reliable.
    // - If polling says 'pending', trust it — it fetches the *current* PR, so session
    //   may be stale from a previous PR cycle (e.g. after merge → new PR).
    // - If session is still 'pending' but polling shows a terminal state, prefer terminal.
    const sessionCheck = session?.checkStatus ?? null;
    const prCheck = prDetails?.checkStatus ?? null;
    const isTerminal = (s: string | null) => s === 'success' || s === 'failure';
    const effectiveCheckStatus =
      prCheck === 'pending' ? 'pending'                              // polling says pending → trust it (current PR)
      : sessionCheck === 'pending' && isTerminal(prCheck) ? prCheck  // polling caught up first
      : sessionCheck ?? prCheck;

    const archiveAction: PrimaryAction = {
      type: 'archive-session',
      tier: 'complete',
      label: 'Archive Session',
      icon: Archive,
      variant: 'default',
      sessionId: session?.id,
    };

    // Helper: does the working tree have new work beyond the merged PR?
    const hasNewWork = gitStatus && (
      gitStatus.workingDirectory.hasChanges ||
      gitStatus.sync.unpushedCommits > 0
    );

    // Priority 7: PR is merged
    // When the store confirms the merge AND there's new work (uncommitted changes,
    // unpushed commits, or commits ahead of base), fall through to the normal
    // priority chain so the user can sync, review, and create a new PR.
    if (session?.prStatus === 'merged') {
      if (!gitStatus || !hasNewWork) {
        return archiveAction;
      }
      // Fall through — normal chain handles sync, PR creation, etc.
    }

    // Catch-up: GitHub says merged but the store hasn't synced yet.
    // Show archive to avoid briefly showing stale actions while the store updates.
    // Also check for new work so the behavior is consistent with the branch above.
    if (prDetails?.merged && session?.prStatus !== 'merged') {
      if (!gitStatus || !hasNewWork) {
        return archiveAction;
      }
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
    if (effectiveCheckStatus === 'failure') {
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
        variant: 'success',
        message,
        dropdownActions,
      };
    }

    // Priority 6: Open PR — show "Merge PR" when safe to merge
    // - checks passed or no checks → show green (success)
    // - checks pending             → hide button (nothing actionable while CI runs)
    // Note: checks failed is caught by Priority 2 above
    if (hasOpenPR) {
      // Don't show merge button while CI is still running
      if (effectiveCheckStatus === 'pending') {
        return null;
      }

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
          icon: GitMerge,
          color: 'blue',
          shortcut: '1',
        },
        {
          label: 'Squash and merge',
          message: 'Squash and merge the pull request',
          description: 'The commits from this branch will be combined into one commit in the base branch.',
          icon: Combine,
          color: 'purple',
          shortcut: '2',
        },
        {
          label: 'Rebase and merge',
          message: 'Rebase and merge the pull request',
          description: 'The commits from this branch will be rebased and added to the base branch.',
          icon: GitBranch,
          color: 'teal',
          shortcut: '3',
        },
      );

      return {
        type: 'merge-pr',
        tier: 'action',
        label: 'Merge PR',
        icon: GitMerge,
        variant: 'success',
        message: 'Squash and merge the pull request',
        dropdownActions,
      };
    }

    // Sprint phase fallback — show phase-specific action when nothing urgent
    const sprintPhase = session?.sprintPhase;
    if (sprintPhase) {
      const phaseAction = getSprintPhaseAction(sprintPhase, session?.id);
      if (phaseAction) return phaseAction;
    }

    // Clean state — nothing to do, hide button
    return null;
  }, [gitStatus, session, prDetails]);
}

/** Maps a sprint phase to a Primary Action button configuration */
function getSprintPhaseAction(phase: SprintPhase, sessionId?: string): PrimaryAction | null {
  switch (phase) {
    case 'think':
      return {
        type: 'sprint-think',
        tier: 'action',
        label: 'Start Planning',
        icon: Lightbulb,
        variant: 'default',
        message: 'Let\'s move from thinking to planning. Create a detailed implementation plan for the task.',
        nextPhase: 'plan',
        dropdownActions: [
          { label: 'Skip to Build', message: 'Skip planning and start building.', nextPhase: 'build' },
        ],
      };
    case 'plan':
      // Plan phase ties into existing plan mode — no separate action needed
      // (plan approval UI handles this)
      return null;
    case 'build':
      // Build phase falls through to git flow (sync, commit, PR)
      return null;
    case 'review':
      return {
        type: 'sprint-review',
        tier: 'action',
        label: 'Run Review',
        icon: Eye,
        variant: 'default',
        message: 'Run a deep code review on the changes',
        nextPhase: 'test',
        dropdownActions: [
          { label: 'Skip to Test', message: 'Skip review and move to testing.', nextPhase: 'test' },
        ],
      };
    case 'test':
      return {
        type: 'sprint-test',
        tier: 'action',
        label: 'Run Tests',
        icon: TestTube,
        variant: 'default',
        message: 'Run the test suite and report results. Check for edge cases and verify coverage.',
        nextPhase: 'ship',
        dropdownActions: [
          { label: 'Skip to Ship', message: 'Skip testing and prepare to ship.', nextPhase: 'ship' },
        ],
      };
    case 'ship':
      // Ship phase falls through to git flow (create PR, merge)
      return null;
    case 'reflect':
      return {
        type: 'archive-session',
        tier: 'complete',
        label: 'Archive Session',
        icon: Archive,
        variant: 'default',
        sessionId,
        nextPhase: null, // Clears sprint on archive
        dropdownActions: [
          { label: 'Summarize', message: 'Summarize what was accomplished, lessons learned, and potential follow-up work.' },
        ],
      };
    default:
      return null;
  }
}
