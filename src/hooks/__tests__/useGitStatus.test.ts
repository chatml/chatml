import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGitStatus } from '../useGitStatus';
import { useAppStore } from '@/stores/appStore';

// Mock getSessionSnapshot (useGitStatus now delegates to useSessionSnapshot)
vi.mock('@/lib/api', () => ({
  getSessionSnapshot: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string | null;
    status: number;
    constructor(message: string, code: string | null = null, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  ErrorCode: { WORKTREE_NOT_FOUND: 'WORKTREE_NOT_FOUND' },
}));

// Mock sessionDataCache
vi.mock('@/lib/sessionDataCache', () => ({
  getSessionData: vi.fn().mockReturnValue(null),
  setSessionData: vi.fn(),
}));

import { getSessionSnapshot } from '@/lib/api';

const mockedGetSessionSnapshot = vi.mocked(getSessionSnapshot);

function makeSnapshot(overrides = {}) {
  return {
    gitStatus: {
      workingDirectory: {
        stagedCount: 0,
        unstagedCount: 1,
        untrackedCount: 0,
        totalUncommitted: 1,
        hasChanges: true,
      },
      sync: {
        aheadBy: 0,
        behindBy: 0,
        baseBranch: 'main',
        hasRemote: true,
        diverged: false,
        unpushedCommits: 0,
      },
      inProgress: { type: 'none' as const },
      conflicts: { hasConflicts: false, count: 0, files: [] },
      stash: { count: 0 },
    },
    changes: [],
    allChanges: [],
    commits: [],
    branchStats: undefined,
    ...overrides,
  };
}

async function flushAndAdvance(ms = 0) {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('useGitStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useAppStore.setState({ lastFileChange: null });
    mockedGetSessionSnapshot.mockResolvedValue(makeSnapshot());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns git status from snapshot', async () => {
    const { result } = renderHook(() => useGitStatus('ws-1', 'session-1'));

    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledWith('ws-1', 'session-1', expect.any(AbortSignal));
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeTruthy();
    expect(result.current.status?.workingDirectory.hasChanges).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns null status when ids are null', async () => {
    const { result } = renderHook(() => useGitStatus(null, null));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it('refetches on matching workspace file change', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().setLastFileChange({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/full/path/src/file.ts',
      });
    });

    await flushAndAdvance(600);

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('ignores file change for different workspace', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().setLastFileChange({
        workspaceId: 'ws-OTHER',
        path: 'src/file.ts',
        fullPath: '/full/path/src/file.ts',
      });
    });

    await flushAndAdvance(600);

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid file changes', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i++) {
      act(() => {
        useAppStore.getState().setLastFileChange({
          workspaceId: 'ws-1',
          path: `src/file-${i}.ts`,
          fullPath: `/full/path/src/file-${i}.ts`,
        });
      });
      await flushAndAdvance(100);
    }

    await flushAndAdvance(600);

    // Initial fetch + one debounced refetch
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not update state after unmount', async () => {
    let resolveDeferred: (value: ReturnType<typeof makeSnapshot>) => void;
    const deferred = new Promise<ReturnType<typeof makeSnapshot>>((resolve) => {
      resolveDeferred = resolve;
    });
    mockedGetSessionSnapshot.mockReturnValue(deferred);

    const { result, unmount } = renderHook(() => useGitStatus('ws-1', 'session-1'));

    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBeNull();

    unmount();

    await act(async () => {
      resolveDeferred!(makeSnapshot());
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('clears stale data when sessionId changes', async () => {
    const snapA = makeSnapshot();
    const snapB = makeSnapshot({
      gitStatus: {
        ...makeSnapshot().gitStatus,
        workingDirectory: { ...makeSnapshot().gitStatus.workingDirectory, stagedCount: 5 },
      },
    });

    mockedGetSessionSnapshot.mockResolvedValue(snapA);
    const { result, rerender } = renderHook(
      ({ sessionId }) => useGitStatus('ws-1', sessionId),
      { initialProps: { sessionId: 'session-a' } }
    );
    await flushAndAdvance();
    expect(result.current.status).toEqual(snapA.gitStatus);
    expect(result.current.loading).toBe(false);

    // Switch to session B
    let resolveB!: (value: ReturnType<typeof makeSnapshot>) => void;
    mockedGetSessionSnapshot.mockReturnValue(
      new Promise((resolve) => { resolveB = resolve; })
    );
    rerender({ sessionId: 'session-b' });

    await flushAndAdvance();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveB(snapB);
      await Promise.resolve();
    });
    await flushAndAdvance();

    expect(result.current.status?.workingDirectory.stagedCount).toBe(5);
    expect(result.current.loading).toBe(false);
  });

  it('polls periodically', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    await flushAndAdvance(30_000);
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);

    await flushAndAdvance(30_000);
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(3);
  });
});
