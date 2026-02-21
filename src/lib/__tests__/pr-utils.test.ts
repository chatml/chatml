import { describe, it, expect } from 'vitest';
import { computePRStatus, STATUS_ORDER, STATUS_LABELS } from '../pr-utils';
import type { PRDashboardItem } from '@/lib/api';

function makePR(overrides: Partial<PRDashboardItem> = {}): PRDashboardItem {
  return {
    number: 1,
    title: 'Test PR',
    state: 'open',
    htmlUrl: 'https://github.com/org/repo/pull/1',
    isDraft: false,
    mergeable: true,
    mergeableState: 'clean',
    checkStatus: 'success',
    checkDetails: [],
    labels: [],
    branch: 'feature',
    baseBranch: 'main',
    workspaceId: 'ws-1',
    workspaceName: 'project',
    repoOwner: 'org',
    repoName: 'repo',
    checksTotal: 3,
    checksPassed: 3,
    checksFailed: 0,
    ...overrides,
  };
}

// ============================================================================
// computePRStatus
// ============================================================================

describe('computePRStatus', () => {
  describe('ready status', () => {
    it('returns ready when all checks pass and no conflicts', () => {
      const result = computePRStatus(makePR());
      expect(result.statusCategory).toBe('ready');
      expect(result.allPassed).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.pendingCount).toBe(0);
    });

    it('returns ready when there are no checks', () => {
      const result = computePRStatus(makePR({
        checksTotal: 0,
        checksPassed: 0,
        checksFailed: 0,
      }));
      expect(result.statusCategory).toBe('ready');
      // allPassed is false when there are no checks
      expect(result.allPassed).toBe(false);
    });
  });

  describe('draft status', () => {
    it('returns draft for draft PRs', () => {
      const result = computePRStatus(makePR({ isDraft: true }));
      expect(result.statusCategory).toBe('draft');
    });

    it('draft takes priority over conflicts', () => {
      const result = computePRStatus(makePR({
        isDraft: true,
        mergeableState: 'dirty',
      }));
      expect(result.statusCategory).toBe('draft');
    });

    it('draft takes priority over failures', () => {
      const result = computePRStatus(makePR({
        isDraft: true,
        checksFailed: 1,
      }));
      expect(result.statusCategory).toBe('draft');
    });
  });

  describe('conflicts status', () => {
    it('returns conflicts for dirty mergeable state', () => {
      const result = computePRStatus(makePR({ mergeableState: 'dirty' }));
      expect(result.statusCategory).toBe('conflicts');
      expect(result.hasConflicts).toBe(true);
    });

    it('returns conflicts when mergeable is false', () => {
      const result = computePRStatus(makePR({ mergeable: false }));
      expect(result.statusCategory).toBe('conflicts');
      expect(result.hasConflicts).toBe(true);
    });

    it('conflicts takes priority over failures', () => {
      const result = computePRStatus(makePR({
        mergeableState: 'dirty',
        checksFailed: 2,
      }));
      expect(result.statusCategory).toBe('conflicts');
    });
  });

  describe('failures status', () => {
    it('returns failures when checks have failed', () => {
      const result = computePRStatus(makePR({
        checksTotal: 5,
        checksPassed: 3,
        checksFailed: 2,
      }));
      expect(result.statusCategory).toBe('failures');
    });

    it('failures takes priority over pending', () => {
      const result = computePRStatus(makePR({
        checksTotal: 5,
        checksPassed: 2,
        checksFailed: 1,
        // pending = 5 - 2 - 1 = 2
      }));
      expect(result.statusCategory).toBe('failures');
    });
  });

  describe('pending status', () => {
    it('returns pending when checks are still running', () => {
      const result = computePRStatus(makePR({
        checksTotal: 5,
        checksPassed: 3,
        checksFailed: 0,
      }));
      expect(result.statusCategory).toBe('pending');
      expect(result.pendingCount).toBe(2);
    });
  });

  describe('computed fields', () => {
    it('computes pendingCount correctly', () => {
      const result = computePRStatus(makePR({
        checksTotal: 10,
        checksPassed: 6,
        checksFailed: 1,
      }));
      expect(result.pendingCount).toBe(3);
    });

    it('preserves all original PR fields', () => {
      const pr = makePR({ title: 'My PR', number: 42 });
      const result = computePRStatus(pr);
      expect(result.title).toBe('My PR');
      expect(result.number).toBe(42);
    });

    it('allPassed is true only when checks exist and all pass', () => {
      const allPass = computePRStatus(makePR({
        checksTotal: 3, checksPassed: 3, checksFailed: 0,
      }));
      expect(allPass.allPassed).toBe(true);

      const someFail = computePRStatus(makePR({
        checksTotal: 3, checksPassed: 2, checksFailed: 1,
      }));
      expect(someFail.allPassed).toBe(false);

      const somePending = computePRStatus(makePR({
        checksTotal: 3, checksPassed: 2, checksFailed: 0,
      }));
      expect(somePending.allPassed).toBe(false);
    });
  });
});

// ============================================================================
// Constants
// ============================================================================

describe('STATUS_ORDER', () => {
  it('lists statuses in display order', () => {
    expect(STATUS_ORDER).toEqual(['ready', 'failures', 'conflicts', 'pending', 'draft']);
  });
});

describe('STATUS_LABELS', () => {
  it('has labels for all status categories', () => {
    expect(STATUS_LABELS.ready).toBe('Ready to Merge');
    expect(STATUS_LABELS.pending).toBe('Checks Pending');
    expect(STATUS_LABELS.failures).toBe('Check Failures');
    expect(STATUS_LABELS.conflicts).toBe('Merge Conflicts');
    expect(STATUS_LABELS.draft).toBe('Draft');
  });
});
