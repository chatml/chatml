import type { PRDashboardItem } from '@/lib/api';

// PR Status categories for grouping
export type PRStatusCategory = 'ready' | 'pending' | 'failures' | 'conflicts' | 'draft';

export const STATUS_ORDER: PRStatusCategory[] = ['ready', 'failures', 'conflicts', 'pending', 'draft'];

export const STATUS_LABELS: Record<PRStatusCategory, string> = {
  ready: 'Ready to Merge',
  pending: 'Checks Pending',
  failures: 'Check Failures',
  conflicts: 'Merge Conflicts',
  draft: 'Draft',
};

// Extended PR item with computed status
export interface PRWithStatus extends PRDashboardItem {
  statusCategory: PRStatusCategory;
  pendingCount: number;
  hasConflicts: boolean;
  allPassed: boolean;
}

// Compute PR status category
export function computePRStatus(pr: PRDashboardItem): PRWithStatus {
  const hasChecks = pr.checksTotal > 0;
  const hasFailures = pr.checksFailed > 0;
  const pendingCount = pr.checksTotal - pr.checksPassed - pr.checksFailed;
  const hasPending = pendingCount > 0;
  const allPassed = hasChecks && !hasFailures && !hasPending;
  const hasConflicts = pr.mergeableState === 'dirty' || pr.mergeable === false;

  let statusCategory: PRStatusCategory;

  if (pr.isDraft) {
    statusCategory = 'draft';
  } else if (hasConflicts) {
    statusCategory = 'conflicts';
  } else if (hasFailures) {
    statusCategory = 'failures';
  } else if (hasPending) {
    statusCategory = 'pending';
  } else {
    statusCategory = 'ready';
  }

  return {
    ...pr,
    statusCategory,
    pendingCount,
    hasConflicts,
    allPassed,
  };
}
