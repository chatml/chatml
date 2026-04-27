import { describe, it, expect } from 'vitest';
import {
  getCheckStatusInfo,
  formatDuration,
  computeJobDuration,
  formatCIFailureMessage,
  buildCIStatusNote,
  getCIStatusToast,
  type EmptyCISnapshotStatus,
} from '../check-utils';
import type { CIFailureContextDTO, CIFailureContextStatus } from '@/lib/api';

// ============================================================================
// getCheckStatusInfo
// ============================================================================

describe('getCheckStatusInfo', () => {
  describe('in_progress status', () => {
    it('returns Running with yellow color', () => {
      const info = getCheckStatusInfo('in_progress', '');
      expect(info.label).toBe('Running');
      expect(info.color).toBe('text-yellow-500');
    });
  });

  describe('queued/waiting/pending statuses', () => {
    it.each(['queued', 'waiting', 'pending'])('returns Queued for status "%s"', (status) => {
      const info = getCheckStatusInfo(status, '');
      expect(info.label).toBe('Queued');
      expect(info.color).toBe('text-muted-foreground');
    });
  });

  describe('completed status', () => {
    it('returns Passed for success conclusion', () => {
      const info = getCheckStatusInfo('completed', 'success');
      expect(info.label).toBe('Passed');
      expect(info.color).toBe('text-green-500');
    });

    it('returns Failed for failure conclusion', () => {
      const info = getCheckStatusInfo('completed', 'failure');
      expect(info.label).toBe('Failed');
      expect(info.color).toBe('text-red-500');
    });

    it('returns Timed out for timed_out conclusion', () => {
      const info = getCheckStatusInfo('completed', 'timed_out');
      expect(info.label).toBe('Timed out');
      expect(info.color).toBe('text-red-500');
    });

    it('returns Cancelled for cancelled conclusion', () => {
      const info = getCheckStatusInfo('completed', 'cancelled');
      expect(info.label).toBe('Cancelled');
      expect(info.color).toBe('text-muted-foreground');
    });

    it('returns Skipped for skipped conclusion', () => {
      const info = getCheckStatusInfo('completed', 'skipped');
      expect(info.label).toBe('Skipped');
      expect(info.color).toBe('text-muted-foreground');
    });

    it('returns Neutral for neutral conclusion', () => {
      const info = getCheckStatusInfo('completed', 'neutral');
      expect(info.label).toBe('Neutral');
      expect(info.color).toBe('text-muted-foreground');
    });

    it('returns Action required for action_required conclusion', () => {
      const info = getCheckStatusInfo('completed', 'action_required');
      expect(info.label).toBe('Action required');
      expect(info.color).toBe('text-red-500');
    });

    it('falls back to conclusion string for unknown conclusion', () => {
      const info = getCheckStatusInfo('completed', 'stale');
      expect(info.label).toBe('stale');
      expect(info.color).toBe('text-muted-foreground');
    });

    it('falls back to "Done" for empty conclusion', () => {
      const info = getCheckStatusInfo('completed', '');
      expect(info.label).toBe('Done');
    });
  });

  describe('unknown status', () => {
    it('falls back to status string as label', () => {
      const info = getCheckStatusInfo('requested', '');
      expect(info.label).toBe('requested');
      expect(info.color).toBe('text-muted-foreground');
    });
  });
});

// ============================================================================
// formatDuration
// ============================================================================

describe('formatDuration', () => {
  it('formats seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats exact minutes', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(120)).toBe('2m');
  });

  it('formats minutes with remaining seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats exact hours', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(7200)).toBe('2h');
  });

  it('formats hours with remaining minutes', () => {
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('drops remaining seconds in hour range', () => {
    // 1h 1m 30s -> 1h 1m (seconds dropped)
    expect(formatDuration(3690)).toBe('1h 1m');
  });
});

// ============================================================================
// computeJobDuration
// ============================================================================

describe('computeJobDuration', () => {
  it('computes duration in seconds from ISO timestamps', () => {
    const result = computeJobDuration({
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T00:01:30Z',
    });
    expect(result).toBe(90);
  });

  it('returns 0 for same start and end time', () => {
    const result = computeJobDuration({
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: '2025-01-01T00:00:00Z',
    });
    expect(result).toBe(0);
  });

  it('returns undefined for invalid start date', () => {
    const result = computeJobDuration({
      startedAt: 'not-a-date',
      completedAt: '2025-01-01T00:00:00Z',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid end date', () => {
    const result = computeJobDuration({
      startedAt: '2025-01-01T00:00:00Z',
      completedAt: 'invalid',
    });
    expect(result).toBeUndefined();
  });

  it('clamps negative durations to 0', () => {
    const result = computeJobDuration({
      startedAt: '2025-01-01T00:01:00Z',
      completedAt: '2025-01-01T00:00:00Z',
    });
    expect(result).toBe(0);
  });

  it('rounds to nearest second', () => {
    const result = computeJobDuration({
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:00:01.600Z',
    });
    expect(result).toBe(2);
  });
});

// ============================================================================
// formatCIFailureMessage
// ============================================================================

describe('formatCIFailureMessage', () => {
  it('formats a single failed run with a single failed job', () => {
    const context: CIFailureContextDTO = {
      branch: 'main',
      status: 'has_failures',
      failedRuns: [{
        runId: 1,
        runName: 'CI',
        runUrl: 'https://github.com/run/1',
        failedJobs: [{
          jobId: 10,
          jobName: 'test',
          jobUrl: 'https://github.com/job/10',
          failedSteps: ['Run tests'],
          logs: 'Error: test failed',
          logLines: 1,
          truncated: false,
        }],
      }],
      totalFailed: 1,
      truncated: false,
    };

    const msg = formatCIFailureMessage(context);
    expect(msg).toContain('Fix the failing CI checks');
    expect(msg).toContain('## Workflow: "CI"');
    expect(msg).toContain('### Job: "test" - FAILED');
    expect(msg).toContain('Failed steps: Run tests');
    expect(msg).toContain('<logs>');
    expect(msg).toContain('Error: test failed');
    expect(msg).toContain('</logs>');
  });

  it('shows truncation notice for log output', () => {
    const context: CIFailureContextDTO = {
      branch: 'main',
      status: 'has_failures',
      failedRuns: [{
        runId: 1,
        runName: 'CI',
        runUrl: 'https://github.com/run/1',
        failedJobs: [{
          jobId: 10,
          jobName: 'build',
          jobUrl: 'https://github.com/job/10',
          failedSteps: [],
          logs: 'truncated log output',
          logLines: 500,
          truncated: true,
        }],
      }],
      totalFailed: 1,
      truncated: false,
    };

    const msg = formatCIFailureMessage(context);
    expect(msg).toContain('log truncated, showing tail of 500 total lines');
  });

  it('shows unavailable message when logs are missing', () => {
    const context: CIFailureContextDTO = {
      branch: 'main',
      status: 'has_failures',
      failedRuns: [{
        runId: 1,
        runName: 'CI',
        runUrl: 'https://github.com/run/1',
        failedJobs: [{
          jobId: 10,
          jobName: 'deploy',
          jobUrl: 'https://github.com/job/10',
          failedSteps: [],
          logs: '(logs unavailable)',
          logLines: 0,
          truncated: false,
        }],
      }],
      totalFailed: 1,
      truncated: false,
    };

    const msg = formatCIFailureMessage(context);
    expect(msg).toContain('(logs unavailable)');
    expect(msg).not.toContain('<logs>');
  });

  it('shows truncation note when total failures are truncated', () => {
    const context: CIFailureContextDTO = {
      branch: 'main',
      status: 'has_failures',
      failedRuns: [{
        runId: 1,
        runName: 'CI',
        runUrl: 'https://github.com/run/1',
        failedJobs: [{
          jobId: 10,
          jobName: 'test',
          jobUrl: 'https://github.com/job/10',
          failedSteps: [],
          logs: 'error',
          logLines: 1,
          truncated: false,
        }],
      }],
      totalFailed: 12,
      truncated: true,
    };

    const msg = formatCIFailureMessage(context);
    expect(msg).toContain('12 total jobs failed');
    expect(msg).toContain('Only the first 5 are shown');
  });

  it('handles multiple failed steps', () => {
    const context: CIFailureContextDTO = {
      branch: 'main',
      status: 'has_failures',
      failedRuns: [{
        runId: 1,
        runName: 'CI',
        runUrl: 'https://github.com/run/1',
        failedJobs: [{
          jobId: 10,
          jobName: 'test',
          jobUrl: 'https://github.com/job/10',
          failedSteps: ['Lint', 'Build', 'Test'],
          logs: 'errors',
          logLines: 1,
          truncated: false,
        }],
      }],
      totalFailed: 1,
      truncated: false,
    };

    const msg = formatCIFailureMessage(context);
    expect(msg).toContain('Failed steps: Lint, Build, Test');
  });

  it('omits failed steps line when no steps provided', () => {
    const context: CIFailureContextDTO = {
      branch: 'main',
      status: 'has_failures',
      failedRuns: [{
        runId: 1,
        runName: 'CI',
        runUrl: 'https://github.com/run/1',
        failedJobs: [{
          jobId: 10,
          jobName: 'test',
          jobUrl: 'https://github.com/job/10',
          failedSteps: [],
          logs: 'error',
          logLines: 1,
          truncated: false,
        }],
      }],
      totalFailed: 1,
      truncated: false,
    };

    const msg = formatCIFailureMessage(context);
    expect(msg).not.toContain('Failed steps:');
  });
});

// ============================================================================
// buildCIStatusNote / getCIStatusToast
//
// These guard the "Fix Issues" handler regression — when the backend snapshot
// was empty, the UI used to fake a hardcoded assistant reply. The handler now
// always sends to the agent, but uses these helpers to give the agent and the
// user an honest status note instead of "no failures found."
// ============================================================================

describe('buildCIStatusNote', () => {
  // has_failures is intentionally excluded by the `EmptyCISnapshotStatus`
  // type — buildCIStatusNote is only called when the snapshot has no failed
  // jobs, so testing the failure case here would assert against a code path
  // that is structurally unreachable.
  const emptyStatuses: EmptyCISnapshotStatus[] = ['all_passed', 'in_progress', 'no_runs'];

  it.each(emptyStatuses)('includes branch and verification commands for status "%s"', (status) => {
    const note = buildCIStatusNote(status, 'feature/x');
    expect(note).toContain('feature/x');
    // Always tells the agent how to verify with `gh`, regardless of status.
    expect(note).toContain('gh run list');
    expect(note).toContain('gh run view');
  });

  it('falls back to (unknown) when branch is empty', () => {
    const note = buildCIStatusNote('all_passed', '');
    expect(note).toContain('(unknown)');
  });

  it('uses a status-specific headline so the agent can tell snapshots apart', () => {
    expect(buildCIStatusNote('all_passed', 'b')).toContain('all checks');
    expect(buildCIStatusNote('in_progress', 'b')).toContain('in progress');
    expect(buildCIStatusNote('no_runs', 'b')).toContain('no workflow runs');
  });
});

describe('getCIStatusToast', () => {
  it('returns null for has_failures so the failure attachment speaks for itself', () => {
    expect(getCIStatusToast('has_failures')).toBeNull();
  });

  it.each<[CIFailureContextStatus, string]>([
    ['all_passed', 'passed'],
    ['in_progress', 'still running'],
    ['no_runs', 'No workflow runs'],
  ])('returns a non-null toast describing status "%s"', (status, fragment) => {
    const toast = getCIStatusToast(status);
    expect(toast).not.toBeNull();
    expect(toast).toContain(fragment);
  });
});
