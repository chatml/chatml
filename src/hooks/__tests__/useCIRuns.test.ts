import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCIRuns } from '../useCIRuns';

// vi.mock is hoisted above imports by Vitest's transform, so the import
// below always receives the mocked module regardless of source order.
vi.mock('@/lib/api', () => ({
  getCIRuns: vi.fn(),
  getCIJobs: vi.fn(),
  getCIJobLogs: vi.fn(),
  rerunCI: vi.fn(),
  analyzeCIFailure: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public response?: string
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import {
  getCIRuns,
  getCIJobs,
  getCIJobLogs,
  rerunCI,
  analyzeCIFailure,
  ApiError,
} from '@/lib/api';
import type {
  WorkflowRunDTO,
  WorkflowJobDTO,
  CIAnalysisResult,
} from '@/lib/api';

const mockedGetCIRuns = vi.mocked(getCIRuns);
const mockedGetCIJobs = vi.mocked(getCIJobs);
const mockedGetCIJobLogs = vi.mocked(getCIJobLogs);
const mockedRerunCI = vi.mocked(rerunCI);
const mockedAnalyzeCIFailure = vi.mocked(analyzeCIFailure);

function makeRun(overrides: Partial<WorkflowRunDTO> = {}): WorkflowRunDTO {
  return {
    id: 1,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    headSha: 'abc123',
    headBranch: 'main',
    htmlUrl: 'https://github.com/repo/actions/runs/1',
    jobsUrl: 'https://api.github.com/repos/owner/repo/actions/runs/1/jobs',
    logsUrl: 'https://api.github.com/repos/owner/repo/actions/runs/1/logs',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:01:00Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<WorkflowJobDTO> = {}): WorkflowJobDTO {
  return {
    id: 100,
    runId: 1,
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T00:01:00Z',
    htmlUrl: 'https://github.com/repo/actions/runs/1/jobs/100',
    steps: [],
    ...overrides,
  };
}

function makeAnalysis(
  overrides: Partial<CIAnalysisResult> = {}
): CIAnalysisResult {
  return {
    errorType: 'build_failure',
    summary: 'TypeScript compilation failed',
    rootCause: 'Missing import in file.ts',
    affectedFiles: ['src/file.ts'],
    confidence: 0.9,
    ...overrides,
  };
}

// Helper: flush microtasks + advance timers so resolved promises and React
// state updates can complete.
async function flushAndAdvance(ms = 0) {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('useCIRuns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedGetCIRuns.mockResolvedValue([makeRun()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Initial fetch
  // ---------------------------------------------------------------------------

  describe('initial fetch', () => {
    it('fetches CI runs on mount when workspaceId and sessionId are provided', async () => {
      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledWith('ws-1', 'session-1');
      expect(result.current.runs).toHaveLength(1);
      expect(result.current.runs[0].id).toBe(1);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets loading to true during fetch', async () => {
      let resolveDeferred: (value: WorkflowRunDTO[]) => void;
      const deferred = new Promise<WorkflowRunDTO[]>((resolve) => {
        resolveDeferred = resolve;
      });
      mockedGetCIRuns.mockReturnValue(deferred);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      // Should be loading before fetch resolves
      expect(result.current.loading).toBe(true);
      expect(result.current.runs).toHaveLength(0);

      // Resolve the fetch
      await act(async () => {
        resolveDeferred!([makeRun()]);
        await Promise.resolve();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.runs).toHaveLength(1);
    });

    it('does not fetch when workspaceId is null', async () => {
      const { result } = renderHook(() =>
        useCIRuns(null, 'session-1')
      );

      await flushAndAdvance();

      expect(mockedGetCIRuns).not.toHaveBeenCalled();
      expect(result.current.runs).toHaveLength(0);
      expect(result.current.loading).toBe(false);
    });

    it('does not fetch when sessionId is null', async () => {
      const { result } = renderHook(() =>
        useCIRuns('ws-1', null)
      );

      await flushAndAdvance();

      expect(mockedGetCIRuns).not.toHaveBeenCalled();
      expect(result.current.runs).toHaveLength(0);
      expect(result.current.loading).toBe(false);
    });

    it('clears runs when workspaceId becomes null', async () => {
      const { result, rerender } = renderHook(
        ({ wsId, sessId }: { wsId: string | null; sessId: string | null }) =>
          useCIRuns(wsId, sessId),
        { initialProps: { wsId: 'ws-1', sessId: 'session-1' } }
      );

      await flushAndAdvance();
      expect(result.current.runs).toHaveLength(1);

      rerender({ wsId: null, sessId: 'session-1' });
      await flushAndAdvance();

      expect(result.current.runs).toHaveLength(0);
    });

    it('refetches when sessionId changes', async () => {
      const { rerender } = renderHook(
        ({ wsId, sessId }: { wsId: string | null; sessId: string | null }) =>
          useCIRuns(wsId, sessId),
        { initialProps: { wsId: 'ws-1', sessId: 'session-1' } }
      );

      await flushAndAdvance();
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);
      expect(mockedGetCIRuns).toHaveBeenCalledWith('ws-1', 'session-1');

      rerender({ wsId: 'ws-1', sessId: 'session-2' });
      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);
      expect(mockedGetCIRuns).toHaveBeenLastCalledWith('ws-1', 'session-2');
    });
  });

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  describe('polling', () => {
    it('polls every 30s when runs are in-progress', async () => {
      mockedGetCIRuns.mockResolvedValue([
        makeRun({ status: 'in_progress', conclusion: '' }),
      ]);

      renderHook(() => useCIRuns('ws-1', 'session-1'));
      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      // Advance past one poll interval (30s)
      await flushAndAdvance(30_000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);

      // Advance past another poll interval
      await flushAndAdvance(30_000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(3);
    });

    it('polls when runs are queued', async () => {
      mockedGetCIRuns.mockResolvedValue([
        makeRun({ status: 'queued', conclusion: '' }),
      ]);

      renderHook(() => useCIRuns('ws-1', 'session-1'));
      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      await flushAndAdvance(30_000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);
    });

    it('does not poll when all runs are completed', async () => {
      mockedGetCIRuns.mockResolvedValue([
        makeRun({ status: 'completed', conclusion: 'success' }),
      ]);

      renderHook(() => useCIRuns('ws-1', 'session-1'));
      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      // Advance past two poll intervals — no additional calls expected
      await flushAndAdvance(60_000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);
    });

    it('stops polling when in-progress runs complete', async () => {
      // First fetch returns in-progress, second returns completed
      mockedGetCIRuns
        .mockResolvedValueOnce([makeRun({ status: 'in_progress', conclusion: '' })])
        .mockResolvedValueOnce([makeRun({ status: 'completed', conclusion: 'success' })]);

      renderHook(() => useCIRuns('ws-1', 'session-1'));
      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      // First poll fires — returns completed
      await flushAndAdvance(30_000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);

      // Next interval — polling should have stopped
      await flushAndAdvance(30_000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);
    });

    it('does not poll when active is false', async () => {
      mockedGetCIRuns.mockResolvedValue([
        makeRun({ status: 'in_progress', conclusion: '' }),
      ]);

      renderHook(() => useCIRuns('ws-1', 'session-1', false));
      await flushAndAdvance();

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      await flushAndAdvance(30_000);
      // No additional poll because active=false
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);
    });

    it('does not poll when workspaceId or sessionId is null', async () => {
      mockedGetCIRuns.mockResolvedValue([
        makeRun({ status: 'in_progress', conclusion: '' }),
      ]);

      renderHook(() => useCIRuns(null, null));
      await flushAndAdvance();

      expect(mockedGetCIRuns).not.toHaveBeenCalled();

      await flushAndAdvance(30_000);
      expect(mockedGetCIRuns).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('sets error state on generic failure', async () => {
      mockedGetCIRuns.mockRejectedValue(new Error('Network failure'));

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      expect(result.current.error).toBe('Network failure');
      expect(result.current.runs).toHaveLength(0);
      expect(result.current.loading).toBe(false);
    });

    it('sets fallback error message for non-Error objects', async () => {
      mockedGetCIRuns.mockRejectedValue('string error');

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      expect(result.current.error).toBe('Failed to fetch CI runs');
    });

    it('clears error on successful subsequent fetch', async () => {
      mockedGetCIRuns
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce([makeRun()]);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();
      expect(result.current.error).toBe('Temporary failure');

      // Trigger refetch
      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.runs).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Auth retry on 401
  // ---------------------------------------------------------------------------

  describe('auth retry on 401', () => {
    it('retries after 3s delay when getCIRuns returns 401', async () => {
      const apiError = new ApiError('Unauthorized', 401);
      mockedGetCIRuns
        .mockRejectedValueOnce(apiError)
        .mockResolvedValueOnce([makeRun()]);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      // First call fails with 401
      await flushAndAdvance();
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);
      // Error should NOT be set for 401 (silent retry)
      expect(result.current.error).toBeNull();

      // Advance past the 3s auth retry delay
      await flushAndAdvance(3000);

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);
      expect(result.current.runs).toHaveLength(1);
      expect(result.current.error).toBeNull();
    });

    it('does not retry 401 if aborted before delay fires', async () => {
      const apiError = new ApiError('Unauthorized', 401);
      mockedGetCIRuns.mockRejectedValue(apiError);

      const { unmount } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      // Unmount before the 3s retry fires
      unmount();
      await flushAndAdvance(3000);

      // Should NOT have retried because the effect was cleaned up (abort signal)
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);
    });

    // NOTE: The hook currently has no max retry limit for 401s. If a limit
    // is added in the future, this test should be updated to respect it.
    it('retries multiple 401s until auth succeeds', async () => {
      const apiError = new ApiError('Unauthorized', 401);
      mockedGetCIRuns
        .mockRejectedValueOnce(apiError)
        .mockRejectedValueOnce(apiError)
        .mockResolvedValueOnce([makeRun()]);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      // First 401
      await flushAndAdvance();
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      // Retry after 3s — second 401
      await flushAndAdvance(3000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);

      // Retry after another 3s — success
      await flushAndAdvance(3000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(3);
      expect(result.current.runs).toHaveLength(1);
      expect(result.current.error).toBeNull();
    });

    it('does not treat non-401 ApiError as auth retry', async () => {
      const apiError = new ApiError('Internal Server Error', 500);
      mockedGetCIRuns.mockRejectedValue(apiError);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();
      expect(result.current.error).toBe('Internal Server Error');

      // Advance past the retry delay — should NOT retry
      await flushAndAdvance(3000);
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Abort signal handling
  // ---------------------------------------------------------------------------

  describe('abort signal handling', () => {
    it('does not update state after unmount (abort signal)', async () => {
      let resolveDeferred: (value: WorkflowRunDTO[]) => void;
      const deferred = new Promise<WorkflowRunDTO[]>((resolve) => {
        resolveDeferred = resolve;
      });
      mockedGetCIRuns.mockReturnValue(deferred);

      const { result, unmount } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      expect(result.current.loading).toBe(true);

      // Unmount before the fetch resolves
      unmount();

      // Resolve the deferred fetch — state should NOT update
      await act(async () => {
        resolveDeferred!([makeRun()]);
        await Promise.resolve();
      });

      // Last captured state should still be loading with empty runs
      expect(result.current.loading).toBe(true);
      expect(result.current.runs).toHaveLength(0);
    });

    it('aborts previous fetch when session changes', async () => {
      let resolveFirst: (value: WorkflowRunDTO[]) => void;
      const firstDeferred = new Promise<WorkflowRunDTO[]>((resolve) => {
        resolveFirst = resolve;
      });

      const secondRuns = [makeRun({ id: 2, name: 'CI-2' })];

      mockedGetCIRuns
        .mockReturnValueOnce(firstDeferred)
        .mockResolvedValueOnce(secondRuns);

      const { result, rerender } = renderHook(
        ({ wsId, sessId }: { wsId: string | null; sessId: string | null }) =>
          useCIRuns(wsId, sessId),
        { initialProps: { wsId: 'ws-1', sessId: 'session-1' } }
      );

      // Switch to a different session before first fetch resolves
      rerender({ wsId: 'ws-1', sessId: 'session-2' });
      await flushAndAdvance();

      // Now resolve the first deferred — its result should be ignored (aborted)
      await act(async () => {
        resolveFirst!([makeRun({ id: 1, name: 'CI-1' })]);
        await Promise.resolve();
      });

      // Should have the second session's data, not the first
      expect(result.current.runs).toHaveLength(1);
      expect(result.current.runs[0].id).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // refetch
  // ---------------------------------------------------------------------------

  describe('refetch', () => {
    it('manually triggers a fetch and sets loading', async () => {
      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      const newRuns = [makeRun({ id: 5 })];
      mockedGetCIRuns.mockResolvedValueOnce(newRuns);

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);
      expect(result.current.runs[0].id).toBe(5);
      expect(result.current.loading).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getJobs
  // ---------------------------------------------------------------------------

  describe('getJobs', () => {
    it('returns jobs for a given run', async () => {
      const jobs = [makeJob({ id: 100 }), makeJob({ id: 101, name: 'test' })];
      mockedGetCIJobs.mockResolvedValue(jobs);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      let returnedJobs: WorkflowJobDTO[];
      await act(async () => {
        returnedJobs = await result.current.getJobs(1);
      });

      expect(mockedGetCIJobs).toHaveBeenCalledWith('ws-1', 'session-1', 1);
      expect(returnedJobs!).toHaveLength(2);
      expect(returnedJobs![0].id).toBe(100);
    });

    it('throws when workspaceId or sessionId is null', async () => {
      const { result } = renderHook(() =>
        useCIRuns(null, null)
      );

      await flushAndAdvance();

      await expect(
        act(async () => {
          await result.current.getJobs(1);
        })
      ).rejects.toThrow('No active session');
    });
  });

  // ---------------------------------------------------------------------------
  // getJobLogs
  // ---------------------------------------------------------------------------

  describe('getJobLogs', () => {
    it('returns logs for a given job', async () => {
      mockedGetCIJobLogs.mockResolvedValue({
        jobId: 100,
        logs: 'Build succeeded!\nAll tests passed.',
      });

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      let logs: string;
      await act(async () => {
        logs = await result.current.getJobLogs(100);
      });

      expect(mockedGetCIJobLogs).toHaveBeenCalledWith('ws-1', 'session-1', 100);
      expect(logs!).toBe('Build succeeded!\nAll tests passed.');
    });

    it('throws when workspaceId or sessionId is null', async () => {
      const { result } = renderHook(() =>
        useCIRuns(null, null)
      );

      await flushAndAdvance();

      await expect(
        act(async () => {
          await result.current.getJobLogs(100);
        })
      ).rejects.toThrow('No active session');
    });
  });

  // ---------------------------------------------------------------------------
  // rerunWorkflow
  // ---------------------------------------------------------------------------

  describe('rerunWorkflow', () => {
    it('calls rerunCI and refetches runs', async () => {
      mockedRerunCI.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(1);

      await act(async () => {
        await result.current.rerunWorkflow(1);
      });

      expect(mockedRerunCI).toHaveBeenCalledWith('ws-1', 'session-1', 1, false);
      // Should have refetched runs after rerun
      expect(mockedGetCIRuns).toHaveBeenCalledTimes(2);
    });

    it('passes failedOnly flag to rerunCI', async () => {
      mockedRerunCI.mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      await act(async () => {
        await result.current.rerunWorkflow(1, true);
      });

      expect(mockedRerunCI).toHaveBeenCalledWith('ws-1', 'session-1', 1, true);
    });

    it('throws when workspaceId or sessionId is null', async () => {
      const { result } = renderHook(() =>
        useCIRuns(null, null)
      );

      await flushAndAdvance();

      await expect(
        act(async () => {
          await result.current.rerunWorkflow(1);
        })
      ).rejects.toThrow('No active session');
    });
  });

  // ---------------------------------------------------------------------------
  // analyzeFailure
  // ---------------------------------------------------------------------------

  describe('analyzeFailure', () => {
    it('returns analysis result for a failed run/job', async () => {
      const analysis = makeAnalysis();
      mockedAnalyzeCIFailure.mockResolvedValue(analysis);

      const { result } = renderHook(() =>
        useCIRuns('ws-1', 'session-1')
      );

      await flushAndAdvance();

      let returnedAnalysis: CIAnalysisResult;
      await act(async () => {
        returnedAnalysis = await result.current.analyzeFailure(1, 100);
      });

      expect(mockedAnalyzeCIFailure).toHaveBeenCalledWith(
        'ws-1',
        'session-1',
        1,
        100
      );
      expect(returnedAnalysis!.errorType).toBe('build_failure');
      expect(returnedAnalysis!.rootCause).toBe('Missing import in file.ts');
    });

    it('throws when workspaceId or sessionId is null', async () => {
      const { result } = renderHook(() =>
        useCIRuns(null, null)
      );

      await flushAndAdvance();

      await expect(
        act(async () => {
          await result.current.analyzeFailure(1, 100);
        })
      ).rejects.toThrow('No active session');
    });
  });
});
