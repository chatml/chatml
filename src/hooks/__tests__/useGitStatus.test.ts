import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGitStatus } from '../useGitStatus';
import { useAppStore } from '@/stores/appStore';

// Mock getGitStatus from the API module
vi.mock('@/lib/api', () => ({
  getGitStatus: vi.fn(),
}));

// Import after mock so we get the mocked version
import { getGitStatus } from '@/lib/api';

const mockedGetGitStatus = vi.mocked(getGitStatus);

function makeGitStatus(overrides = {}) {
  return {
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
      needsSync: false,
    },
    branch: {
      name: 'main',
      upstream: 'origin/main',
    },
    ...overrides,
  };
}

// Helper: flush microtasks + advance timers so resolved promises and React
// state updates (including the effect that calls fetchStatus) can complete.
async function flushAndAdvance(ms = 0) {
  await act(async () => {
    // Flush already-resolved promises (e.g. mockResolvedValue)
    await Promise.resolve();
    if (ms > 0) vi.advanceTimersByTime(ms);
    // Flush any promises that were created after advancing timers
    await Promise.resolve();
  });
}

describe('useGitStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useAppStore.setState({ lastFileChange: null });
    mockedGetGitStatus.mockResolvedValue(makeGitStatus());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches git status on mount', async () => {
    const { result } = renderHook(() => useGitStatus('ws-1', 'session-1'));

    // Flush the initial async fetchStatus
    await flushAndAdvance();

    expect(mockedGetGitStatus).toHaveBeenCalledWith('ws-1', 'session-1');
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it('refetches on matching workspace file change', async () => {
    const { result } = renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(result.current.loading).toBe(false);
    expect(mockedGetGitStatus).toHaveBeenCalledTimes(1);

    // Trigger a file change for the same workspace
    act(() => {
      useAppStore.getState().setLastFileChange({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/full/path/src/file.ts',
      });
    });

    // Advance past the 500ms debounce and flush the resulting fetchStatus
    await flushAndAdvance(600);

    expect(mockedGetGitStatus).toHaveBeenCalledTimes(2);
  });

  it('ignores file change for different workspace', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetGitStatus).toHaveBeenCalledTimes(1);

    // Trigger a file change for a different workspace
    act(() => {
      useAppStore.getState().setLastFileChange({
        workspaceId: 'ws-OTHER',
        path: 'src/file.ts',
        fullPath: '/full/path/src/file.ts',
      });
    });

    await flushAndAdvance(600);

    // Should NOT have refetched
    expect(mockedGetGitStatus).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when workspaceId is empty', async () => {
    const { result } = renderHook(() => useGitStatus(null, null));
    await flushAndAdvance();

    expect(mockedGetGitStatus).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it('debounces rapid file changes', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetGitStatus).toHaveBeenCalledTimes(1);

    // Fire multiple rapid file changes
    for (let i = 0; i < 5; i++) {
      act(() => {
        useAppStore.getState().setLastFileChange({
          workspaceId: 'ws-1',
          path: `src/file-${i}.ts`,
          fullPath: `/full/path/src/file-${i}.ts`,
        });
      });
      // Small gap between events (less than debounce window of 500ms)
      await flushAndAdvance(100);
    }

    // Advance past the debounce window after the last change
    await flushAndAdvance(600);

    // Initial fetch + one debounced refetch (not 5)
    expect(mockedGetGitStatus).toHaveBeenCalledTimes(2);
  });

  it('does not update state after unmount', async () => {
    let resolveDeferred: (value: ReturnType<typeof makeGitStatus>) => void;
    const deferred = new Promise<ReturnType<typeof makeGitStatus>>((resolve) => {
      resolveDeferred = resolve;
    });
    mockedGetGitStatus.mockReturnValue(deferred);

    const { result, unmount } = renderHook(() => useGitStatus('ws-1', 'session-1'));

    // Hook should be loading while the fetch is pending
    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBeNull();

    // Unmount before the fetch resolves
    unmount();

    // Now resolve the deferred fetch — state should NOT update
    await act(async () => {
      resolveDeferred!(makeGitStatus());
      await Promise.resolve();
    });

    // After unmount, last captured state should still show loading/null
    // (no state update occurred because isMountedRef was false)
    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('polls periodically', async () => {
    renderHook(() => useGitStatus('ws-1', 'session-1'));
    await flushAndAdvance();

    expect(mockedGetGitStatus).toHaveBeenCalledTimes(1);

    // Advance past one poll interval (30s)
    await flushAndAdvance(30_000);

    expect(mockedGetGitStatus).toHaveBeenCalledTimes(2);

    // Advance past another poll interval
    await flushAndAdvance(30_000);

    expect(mockedGetGitStatus).toHaveBeenCalledTimes(3);
  });
});
