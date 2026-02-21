import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBranchSync } from '../useBranchSync';
import { useAppStore } from '@/stores/appStore';
import type { BranchSyncStatusDTO, BranchSyncResultDTO } from '@/lib/api';

// vi.mock is hoisted above imports by Vitest's transform, so the import
// below always receives the mocked module regardless of source order.
vi.mock('@/lib/api', () => ({
  getBranchSyncStatus: vi.fn(),
  syncBranch: vi.fn(),
  abortBranchSync: vi.fn(),
}));

import { getBranchSyncStatus, syncBranch, abortBranchSync } from '@/lib/api';

const mockedGetBranchSyncStatus = vi.mocked(getBranchSyncStatus);
const mockedSyncBranch = vi.mocked(syncBranch);
const mockedAbortBranchSync = vi.mocked(abortBranchSync);

// --- Helpers ---

function makeSyncStatus(overrides: Partial<BranchSyncStatusDTO> = {}): BranchSyncStatusDTO {
  return {
    behindBy: 3,
    commits: [
      { sha: 'abc123', message: 'fix: something', author: 'dev', date: '2026-01-01T00:00:00Z' },
    ],
    baseBranch: 'origin/main',
    lastChecked: new Date().toISOString(),
    ...overrides,
  };
}

function makeSyncResult(overrides: Partial<BranchSyncResultDTO> = {}): BranchSyncResultDTO {
  return {
    success: true,
    ...overrides,
  };
}

/**
 * Flush microtasks and advance fake timers so resolved promises and
 * React state updates (including deferred effects) can complete.
 */
async function flushAndAdvance(ms = 0) {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

// --- Test suite ---

describe('useBranchSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Reset the store slices used by the hook
    useAppStore.setState({
      branchSyncStatus: {},
      branchSyncLoading: {},
      branchSyncDismissed: {},
      branchSyncCompletedAt: {},
    });

    // Default: API returns a status behind by 3 commits
    mockedGetBranchSyncStatus.mockResolvedValue(makeSyncStatus());
    mockedSyncBranch.mockResolvedValue(makeSyncResult());
    mockedAbortBranchSync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =====================================================
  // Initial state & deferred fetch
  // =====================================================

  it('returns null/false defaults before any fetch', () => {
    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.syncing).toBe(false);
    expect(result.current.aborting).toBe(false);
    expect(result.current.dismissed).toBe(false);
    expect(result.current.conflictFiles).toEqual([]);
    expect(result.current.lastOperation).toBeNull();
  });

  it('defers initial status check via setTimeout fallback (jsdom has no requestIdleCallback)', async () => {
    renderHook(() => useBranchSync('ws-1', 'session-1'));

    // Before the 2000ms timeout fires, no fetch should have happened
    await flushAndAdvance(500);
    expect(mockedGetBranchSyncStatus).not.toHaveBeenCalled();

    // After 2000ms the deferred check fires
    await flushAndAdvance(1600);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledWith('ws-1', 'session-1');
  });

  it('does not fetch when workspaceId or sessionId is null', async () => {
    const { result } = renderHook(() => useBranchSync(null, null));
    await flushAndAdvance(3000);

    expect(mockedGetBranchSyncStatus).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch when workspaceId is null', async () => {
    renderHook(() => useBranchSync(null, 'session-1'));
    await flushAndAdvance(3000);

    expect(mockedGetBranchSyncStatus).not.toHaveBeenCalled();
  });

  it('stores status in the app store after successful fetch', async () => {
    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    expect(result.current.status).not.toBeNull();
    expect(result.current.status!.behindBy).toBe(3);
    expect(result.current.loading).toBe(false);
  });

  it('clears dismissed state when behind by > 0 commits', async () => {
    // Pre-dismiss the session
    useAppStore.setState({
      branchSyncDismissed: { 'session-1': true },
    });

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    expect(result.current.dismissed).toBe(true);

    // Trigger the deferred fetch which returns behindBy: 3
    await flushAndAdvance(2100);

    expect(result.current.dismissed).toBe(false);
  });

  // =====================================================
  // Cache TTL (30 seconds per session)
  // =====================================================

  it('forceCheck (public checkStatus) always calls API regardless of cache TTL', async () => {
    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    // Fire initial deferred check
    await flushAndAdvance(2100);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);

    // The public checkStatus is forceCheck which bypasses cache.
    // Verify it always calls the API even within the 30s TTL window.
    await act(async () => {
      await result.current.checkStatus();
      await Promise.resolve();
    });

    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when session changes', async () => {
    const { rerender, result } = renderHook(
      ({ wsId, sessId }) => useBranchSync(wsId, sessId),
      { initialProps: { wsId: 'ws-1', sessId: 'session-1' } }
    );

    await flushAndAdvance(2100);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledWith('ws-1', 'session-1');

    // Switch to a different session
    rerender({ wsId: 'ws-1', sessId: 'session-2' });
    await flushAndAdvance(2100);

    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(2);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledWith('ws-1', 'session-2');

    // The returned status should reflect the new session (null until fetched,
    // but since the mock resolves instantly it should be populated)
    expect(result.current.status).not.toBeNull();
  });

  // =====================================================
  // Rebase
  // =====================================================

  it('performs rebase and updates state on success', async () => {
    mockedSyncBranch.mockResolvedValue(makeSyncResult({ success: true }));

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    let rebaseResult: BranchSyncResultDTO | null = null;
    await act(async () => {
      rebaseResult = await result.current.rebase();
    });

    expect(mockedSyncBranch).toHaveBeenCalledWith('ws-1', 'session-1', 'rebase');
    expect(rebaseResult).not.toBeNull();
    expect(rebaseResult!.success).toBe(true);
    expect(result.current.syncing).toBe(false);
    expect(result.current.dismissed).toBe(true);

    // Status should be reset to behindBy: 0
    const storeStatus = useAppStore.getState().branchSyncStatus['session-1'];
    expect(storeStatus).not.toBeNull();
    expect(storeStatus!.behindBy).toBe(0);

    // completedAt timestamp should have been set
    const completedAt = useAppStore.getState().branchSyncCompletedAt['session-1'];
    expect(completedAt).toBeGreaterThan(0);
  });

  it('sets conflictFiles on rebase conflict', async () => {
    mockedSyncBranch.mockResolvedValue(
      makeSyncResult({
        success: false,
        conflictFiles: ['src/a.ts', 'src/b.ts'],
      })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    await act(async () => {
      await result.current.rebase();
    });

    expect(result.current.conflictFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.current.lastOperation).toBe('rebase');
    expect(result.current.syncing).toBe(false);
  });

  it('returns null and keeps syncing=false when rebase throws', async () => {
    mockedSyncBranch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    let rebaseResult: BranchSyncResultDTO | null = null;
    await act(async () => {
      rebaseResult = await result.current.rebase();
    });

    expect(rebaseResult).toBeNull();
    expect(result.current.syncing).toBe(false);
  });

  it('returns null when rebase called without session', async () => {
    const { result } = renderHook(() => useBranchSync(null, null));

    let rebaseResult: BranchSyncResultDTO | null = null;
    await act(async () => {
      rebaseResult = await result.current.rebase();
    });

    expect(rebaseResult).toBeNull();
    expect(mockedSyncBranch).not.toHaveBeenCalled();
  });

  // =====================================================
  // Merge
  // =====================================================

  it('performs merge and updates state on success', async () => {
    mockedSyncBranch.mockResolvedValue(makeSyncResult({ success: true }));

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    let mergeResult: BranchSyncResultDTO | null = null;
    await act(async () => {
      mergeResult = await result.current.merge();
    });

    expect(mockedSyncBranch).toHaveBeenCalledWith('ws-1', 'session-1', 'merge');
    expect(mergeResult).not.toBeNull();
    expect(mergeResult!.success).toBe(true);
    expect(result.current.syncing).toBe(false);
    expect(result.current.dismissed).toBe(true);
  });

  it('sets conflictFiles on merge conflict', async () => {
    mockedSyncBranch.mockResolvedValue(
      makeSyncResult({
        success: false,
        conflictFiles: ['package.json'],
      })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    await act(async () => {
      await result.current.merge();
    });

    expect(result.current.conflictFiles).toEqual(['package.json']);
    expect(result.current.lastOperation).toBe('merge');
  });

  it('returns null when merge throws', async () => {
    mockedSyncBranch.mockRejectedValue(new Error('server 500'));

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    let mergeResult: BranchSyncResultDTO | null = null;
    await act(async () => {
      mergeResult = await result.current.merge();
    });

    expect(mergeResult).toBeNull();
    expect(result.current.syncing).toBe(false);
  });

  // =====================================================
  // "Just synced" flag prevents re-fetch
  // =====================================================

  it('skips auto-refresh after a successful rebase (justSynced flag)', async () => {
    mockedSyncBranch.mockResolvedValue(makeSyncResult({ success: true }));

    const { result, rerender } = renderHook(
      ({ wsId, sessId }) => useBranchSync(wsId, sessId),
      { initialProps: { wsId: 'ws-1', sessId: 'session-1' } }
    );

    // Let the initial deferred check fire
    await flushAndAdvance(2100);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);

    // Perform a successful rebase -- this sets the justSynced flag
    await act(async () => {
      await result.current.rebase();
    });

    // Clear call count to isolate next check
    mockedGetBranchSyncStatus.mockClear();

    // Simulate a re-mount / session switch that causes the deferred effect to re-fire
    // by switching away and back to the same session.
    rerender({ wsId: 'ws-1', sessId: 'session-2' });
    await flushAndAdvance(2100);

    // session-2 should get a fetch
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledWith('ws-1', 'session-2');

    mockedGetBranchSyncStatus.mockClear();

    // Switch back to session-1. The justSynced flag was set for session-1,
    // so the deferred check should be skipped.
    rerender({ wsId: 'ws-1', sessId: 'session-1' });
    await flushAndAdvance(2100);

    // The justSynced flag consumes itself on first check, so the fetch is skipped
    expect(mockedGetBranchSyncStatus).not.toHaveBeenCalled();
  });

  it('skips auto-refresh after a successful merge (justSynced flag)', async () => {
    mockedSyncBranch.mockResolvedValue(makeSyncResult({ success: true }));

    const { result, rerender } = renderHook(
      ({ wsId, sessId }) => useBranchSync(wsId, sessId),
      { initialProps: { wsId: 'ws-1', sessId: 'session-1' } }
    );

    await flushAndAdvance(2100);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.merge();
    });

    mockedGetBranchSyncStatus.mockClear();

    // Switch away and back
    rerender({ wsId: 'ws-1', sessId: 'session-2' });
    await flushAndAdvance(2100);
    mockedGetBranchSyncStatus.mockClear();

    rerender({ wsId: 'ws-1', sessId: 'session-1' });
    await flushAndAdvance(2100);

    expect(mockedGetBranchSyncStatus).not.toHaveBeenCalled();
  });

  // =====================================================
  // Abort
  // =====================================================

  it('aborts in-progress operation and refreshes status', async () => {
    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    // Simulate a conflict so there is something to abort
    mockedSyncBranch.mockResolvedValue(
      makeSyncResult({ success: false, conflictFiles: ['file.ts'] })
    );
    await act(async () => {
      await result.current.rebase();
    });
    expect(result.current.conflictFiles).toEqual(['file.ts']);

    mockedGetBranchSyncStatus.mockClear();

    // Now abort
    await act(async () => {
      await result.current.abort();
    });

    expect(mockedAbortBranchSync).toHaveBeenCalledWith('ws-1', 'session-1');
    expect(result.current.conflictFiles).toEqual([]);
    expect(result.current.lastOperation).toBeNull();
    expect(result.current.aborting).toBe(false);

    // abort calls forceCheck, which should have re-fetched
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);
  });

  it('handles abort failure gracefully', async () => {
    mockedAbortBranchSync.mockRejectedValue(new Error('abort failed'));

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    await act(async () => {
      await result.current.abort();
    });

    // Should not throw; aborting should be reset
    expect(result.current.aborting).toBe(false);
  });

  it('does not call abort API when session is null', async () => {
    const { result } = renderHook(() => useBranchSync(null, null));

    await act(async () => {
      await result.current.abort();
    });

    expect(mockedAbortBranchSync).not.toHaveBeenCalled();
  });

  // =====================================================
  // Dismiss & clearConflicts
  // =====================================================

  it('dismiss sets dismissed state in store', async () => {
    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    expect(result.current.dismissed).toBe(false);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.dismissed).toBe(true);
    expect(useAppStore.getState().branchSyncDismissed['session-1']).toBe(true);
  });

  it('dismiss is a no-op when sessionId is null', () => {
    const { result } = renderHook(() => useBranchSync('ws-1', null));

    act(() => {
      result.current.dismiss();
    });

    // No crash, dismissed remains false
    expect(result.current.dismissed).toBe(false);
  });

  it('clearConflicts resets conflict state', async () => {
    mockedSyncBranch.mockResolvedValue(
      makeSyncResult({ success: false, conflictFiles: ['a.ts'] })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    await act(async () => {
      await result.current.rebase();
    });

    expect(result.current.conflictFiles).toEqual(['a.ts']);
    expect(result.current.lastOperation).toBe('rebase');

    act(() => {
      result.current.clearConflicts();
    });

    expect(result.current.conflictFiles).toEqual([]);
    expect(result.current.lastOperation).toBeNull();
  });

  // =====================================================
  // Mount / unmount lifecycle
  // =====================================================

  it('does not update state after unmount', async () => {
    let resolveDeferred!: (value: BranchSyncStatusDTO) => void;
    const deferred = new Promise<BranchSyncStatusDTO>((resolve) => {
      resolveDeferred = resolve;
    });
    mockedGetBranchSyncStatus.mockReturnValue(deferred);

    const { result, unmount } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    // Trigger the deferred setTimeout
    await flushAndAdvance(2100);

    // The API was called but hasn't resolved yet
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);

    // Unmount before the deferred fetch resolves
    unmount();

    // Now resolve -- state should NOT update because isMountedRef is false
    await act(async () => {
      resolveDeferred(makeSyncStatus({ behindBy: 5 }));
      await Promise.resolve();
    });

    // Status should remain null in the store for this session because the
    // isMountedRef guard prevented the update
    const storeStatus = useAppStore.getState().branchSyncStatus['session-1'];
    expect(storeStatus).toBeUndefined();
  });

  it('cleans up deferred setTimeout on unmount', async () => {
    const { unmount } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    // Unmount before the 2000ms deferred check fires
    unmount();

    // Advance past the deferred timeout -- should NOT trigger a fetch
    await flushAndAdvance(3000);

    expect(mockedGetBranchSyncStatus).not.toHaveBeenCalled();
  });

  // =====================================================
  // Error handling
  // =====================================================

  it('handles getBranchSyncStatus failure gracefully', async () => {
    mockedGetBranchSyncStatus.mockRejectedValue(new Error('API error'));

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    // Should not crash; loading should be reset to false
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBeNull();
  });

  // =====================================================
  // forceCheck (public checkStatus)
  // =====================================================

  it('forceCheck bypasses cache TTL', async () => {
    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    // Let the initial deferred check fire
    await flushAndAdvance(2100);
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(1);

    // Immediately call forceCheck (well within 30s TTL)
    await act(async () => {
      await result.current.checkStatus();
    });

    // Should have been called again because force=true bypasses the cache
    expect(mockedGetBranchSyncStatus).toHaveBeenCalledTimes(2);
  });

  // =====================================================
  // requestIdleCallback path
  // =====================================================

  it('uses requestIdleCallback when available', async () => {
    const mockIdleCallback = vi.fn((cb: IdleRequestCallback) => {
      // Execute the callback synchronously for testing
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    const mockCancelIdleCallback = vi.fn();

    // Install the polyfill
    globalThis.requestIdleCallback = mockIdleCallback;
    globalThis.cancelIdleCallback = mockCancelIdleCallback;

    try {
      const { unmount } = renderHook(() => useBranchSync('ws-1', 'session-1'));

      // The hook should have used requestIdleCallback
      await flushAndAdvance(0);

      expect(mockIdleCallback).toHaveBeenCalled();
      expect(mockedGetBranchSyncStatus).toHaveBeenCalledWith('ws-1', 'session-1');

      // Unmount while polyfill is still installed so cleanup can call cancelIdleCallback
      unmount();
    } finally {
      // Clean up -- remove the polyfill
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).requestIdleCallback;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).cancelIdleCallback;
    }
  });

  it('cancels requestIdleCallback on unmount', async () => {
    const mockCancelIdleCallback = vi.fn();
    globalThis.requestIdleCallback = vi.fn(() => 42);
    globalThis.cancelIdleCallback = mockCancelIdleCallback;

    try {
      const { unmount } = renderHook(() => useBranchSync('ws-1', 'session-1'));

      unmount();

      expect(mockCancelIdleCallback).toHaveBeenCalledWith(42);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).requestIdleCallback;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).cancelIdleCallback;
    }
  });

  // =====================================================
  // Loading state transitions
  // =====================================================

  it('sets loading=true while fetching and false after', async () => {
    let resolveDeferred!: (value: BranchSyncStatusDTO) => void;
    mockedGetBranchSyncStatus.mockImplementation(
      () =>
        new Promise<BranchSyncStatusDTO>((resolve) => {
          resolveDeferred = resolve;
        })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));

    // Trigger the deferred check
    await flushAndAdvance(2100);

    // Loading should be true while the API call is pending
    expect(result.current.loading).toBe(true);

    // Resolve the fetch
    await act(async () => {
      resolveDeferred(makeSyncStatus());
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
  });

  // =====================================================
  // Syncing state transitions
  // =====================================================

  it('sets syncing=true during rebase and false after', async () => {
    let resolveSync!: (value: BranchSyncResultDTO) => void;
    mockedSyncBranch.mockImplementation(
      () =>
        new Promise<BranchSyncResultDTO>((resolve) => {
          resolveSync = resolve;
        })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    // Start rebase (don't await yet)
    let rebasePromise: Promise<BranchSyncResultDTO | null>;
    act(() => {
      rebasePromise = result.current.rebase();
    });

    // syncing should be true while the operation is in progress
    expect(result.current.syncing).toBe(true);
    expect(result.current.lastOperation).toBe('rebase');

    // Resolve the sync
    await act(async () => {
      resolveSync(makeSyncResult());
      await rebasePromise!;
    });

    expect(result.current.syncing).toBe(false);
  });

  it('sets syncing=true during merge and false after', async () => {
    let resolveSync!: (value: BranchSyncResultDTO) => void;
    mockedSyncBranch.mockImplementation(
      () =>
        new Promise<BranchSyncResultDTO>((resolve) => {
          resolveSync = resolve;
        })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    let mergePromise: Promise<BranchSyncResultDTO | null>;
    act(() => {
      mergePromise = result.current.merge();
    });

    expect(result.current.syncing).toBe(true);
    expect(result.current.lastOperation).toBe('merge');

    await act(async () => {
      resolveSync(makeSyncResult());
      await mergePromise!;
    });

    expect(result.current.syncing).toBe(false);
  });

  // =====================================================
  // Aborting state transitions
  // =====================================================

  it('sets aborting=true during abort and false after', async () => {
    let resolveAbort!: () => void;
    mockedAbortBranchSync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAbort = resolve;
        })
    );

    const { result } = renderHook(() => useBranchSync('ws-1', 'session-1'));
    await flushAndAdvance(2100);

    let abortPromise: Promise<void>;
    act(() => {
      abortPromise = result.current.abort();
    });

    expect(result.current.aborting).toBe(true);

    await act(async () => {
      resolveAbort();
      await abortPromise;
    });

    expect(result.current.aborting).toBe(false);
  });
});
