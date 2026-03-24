import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionSnapshot } from '../useSessionSnapshot';
import { useAppStore } from '@/stores/appStore';

// Mock getSessionSnapshot from the API module
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
import { getSessionData, setSessionData } from '@/lib/sessionDataCache';

const mockedGetSessionSnapshot = vi.mocked(getSessionSnapshot);
const mockedGetSessionData = vi.mocked(getSessionData);
const mockedSetSessionData = vi.mocked(setSessionData);

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
        aheadBy: 1,
        behindBy: 0,
        baseBranch: 'main',
        remoteBranch: 'origin/feature',
        hasRemote: true,
        diverged: false,
        unpushedCommits: 1,
      },
      inProgress: { type: 'none' as const },
      conflicts: { hasConflicts: false, count: 0, files: [] },
      stash: { count: 0 },
    },
    changes: [{ path: 'src/main.ts', additions: 5, deletions: 2, status: 'modified' as const }],
    allChanges: [
      { path: 'src/main.ts', additions: 5, deletions: 2, status: 'modified' as const },
      { path: 'src/util.ts', additions: 10, deletions: 0, status: 'added' as const },
    ],
    commits: [{ sha: 'abc123', shortSha: 'abc', message: 'test commit', author: 'test', email: 'test@test.com', timestamp: '2024-01-01', files: [] }],
    branchStats: { totalFiles: 2, totalAdditions: 15, totalDeletions: 2 },
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

describe('useSessionSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useAppStore.setState({ lastFileChange: null });
    mockedGetSessionSnapshot.mockResolvedValue(makeSnapshot());
    mockedGetSessionData.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches snapshot on mount', async () => {
    const { result } = renderHook(() => useSessionSnapshot('ws-1', 'session-1'));

    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledWith('ws-1', 'session-1');
    expect(result.current.loading).toBe(false);
    expect(result.current.gitStatus).toBeTruthy();
    expect(result.current.changes).toHaveLength(1);
    expect(result.current.allChanges).toHaveLength(2);
    expect(result.current.branchCommits).toHaveLength(1);
    expect(result.current.branchStats).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it('returns empty state when ids are null', async () => {
    const { result } = renderHook(() => useSessionSnapshot(null, null));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.gitStatus).toBeNull();
    expect(result.current.changes).toEqual([]);
    expect(result.current.allChanges).toEqual([]);
  });

  it('updates session data cache after fetch', async () => {
    renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedSetSessionData).toHaveBeenCalledWith(
      'ws-1',
      'session-1',
      expect.objectContaining({
        changes: expect.any(Array),
        allChanges: expect.any(Array),
        branchStats: expect.any(Object),
        gitStatus: expect.any(Object),
      })
    );
  });

  it('restores cached data on session switch', async () => {
    const cachedData = {
      files: [],
      changes: [{ path: 'cached.ts', additions: 1, deletions: 0, status: 'added' as const }],
      allChanges: [{ path: 'cached.ts', additions: 1, deletions: 0, status: 'added' as const }],
      branchStats: { totalFiles: 1, totalAdditions: 1, totalDeletions: 0 },
      gitStatus: makeSnapshot().gitStatus,
    };
    mockedGetSessionData.mockReturnValue(cachedData);

    // Make the API call hang so cached data is visible before network responds
    mockedGetSessionSnapshot.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSessionSnapshot('ws-1', 'session-cached'));

    // Cached data should be available synchronously (no flushAndAdvance needed)
    expect(result.current.changes).toHaveLength(1);
    expect(result.current.changes[0].path).toBe('cached.ts');
    expect(result.current.loading).toBe(false);
  });

  it('refetches on matching workspace file change', async () => {
    renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      useAppStore.getState().setLastFileChange({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/full/path/src/file.ts',
      });
    });

    // Advance past 500ms debounce
    await flushAndAdvance(600);

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('ignores file change for different workspace', async () => {
    renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
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
    renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    // Fire multiple rapid file changes
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

    // Advance past debounce after last change
    await flushAndAdvance(600);

    // Initial fetch + one debounced refetch (not 5)
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('polls periodically', async () => {
    renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    // Advance past one poll interval (30s)
    await flushAndAdvance(30_000);
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);

    // Advance past another poll interval
    await flushAndAdvance(30_000);
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(3);
  });

  it('does not fetch when not active', async () => {
    renderHook(() => useSessionSnapshot('ws-1', 'session-1', false));
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).not.toHaveBeenCalled();
  });

  it('does not poll when not active', async () => {
    renderHook(() => useSessionSnapshot('ws-1', 'session-1', false));
    await flushAndAdvance();

    // Advance past poll interval
    await flushAndAdvance(30_000);

    expect(mockedGetSessionSnapshot).not.toHaveBeenCalled();
  });

  it('does not update state after unmount', async () => {
    let resolveDeferred: (value: ReturnType<typeof makeSnapshot>) => void;
    const deferred = new Promise<ReturnType<typeof makeSnapshot>>((resolve) => {
      resolveDeferred = resolve;
    });
    mockedGetSessionSnapshot.mockReturnValue(deferred);

    const { result, unmount } = renderHook(() => useSessionSnapshot('ws-1', 'session-1'));

    expect(result.current.loading).toBe(true);
    expect(result.current.gitStatus).toBeNull();

    unmount();

    await act(async () => {
      resolveDeferred!(makeSnapshot());
      await Promise.resolve();
    });

    // State should not have been updated after unmount
    expect(result.current.loading).toBe(true);
    expect(result.current.gitStatus).toBeNull();
  });

  it('handles API errors gracefully', async () => {
    mockedGetSessionSnapshot.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Network error');
    expect(result.current.gitStatus).toBeNull();
  });

  it('exposes refetch that sets loading', async () => {
    const { result } = renderHook(() => useSessionSnapshot('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(result.current.loading).toBe(false);
    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(1);

    // Call refetch
    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
    });
    await flushAndAdvance();

    expect(mockedGetSessionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('clears state when session changes and no cache available', async () => {
    const snapA = makeSnapshot({ changes: [{ path: 'a.ts', additions: 1, deletions: 0, status: 'added' as const }] });
    const snapB = makeSnapshot({ changes: [{ path: 'b.ts', additions: 2, deletions: 0, status: 'added' as const }] });

    mockedGetSessionSnapshot.mockResolvedValue(snapA);

    const { result, rerender } = renderHook(
      ({ sessionId }) => useSessionSnapshot('ws-1', sessionId),
      { initialProps: { sessionId: 'session-a' } }
    );
    await flushAndAdvance();
    expect(result.current.changes[0].path).toBe('a.ts');

    // Switch to session B — no cache
    let resolveB!: (value: ReturnType<typeof makeSnapshot>) => void;
    mockedGetSessionSnapshot.mockReturnValue(
      new Promise((resolve) => { resolveB = resolve; })
    );
    mockedGetSessionData.mockReturnValue(null);
    rerender({ sessionId: 'session-b' });

    await flushAndAdvance();
    // Before API responds, state should be cleared
    expect(result.current.loading).toBe(true);
    expect(result.current.changes).toEqual([]);

    // Resolve the fetch
    await act(async () => {
      resolveB(snapB);
      await Promise.resolve();
    });
    await flushAndAdvance();

    expect(result.current.changes[0].path).toBe('b.ts');
    expect(result.current.loading).toBe(false);
  });
});
