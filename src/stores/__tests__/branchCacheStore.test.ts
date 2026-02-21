import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useBranchCacheStore } from '../branchCacheStore';
import type { BranchDTO } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  listBranches: vi.fn(),
}));

function makeBranch(overrides: Partial<BranchDTO> = {}): BranchDTO {
  return {
    name: 'origin/main',
    isRemote: true,
    isHead: false,
    lastCommitSha: 'abc123',
    lastCommitDate: '2025-01-01',
    lastCommitSubject: 'test commit',
    lastAuthor: 'dev',
    aheadMain: 0,
    behindMain: 0,
    ...overrides,
  };
}

let mockListBranches: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const api = await import('@/lib/api');
  mockListBranches = vi.mocked(api.listBranches);
  mockListBranches.mockReset();

  // Reset the store state
  useBranchCacheStore.setState({ cache: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// fetchBranches
// ============================================================================

describe('fetchBranches', () => {
  it('fetches branches from API on first call', async () => {
    const branches = [makeBranch({ name: 'origin/feature' })];
    mockListBranches.mockResolvedValue({
      sessionBranches: branches,
      otherBranches: [],
    });

    const result = await useBranchCacheStore.getState().fetchBranches('ws-1');

    expect(mockListBranches).toHaveBeenCalledWith('ws-1', {
      includeRemote: true,
      sortBy: 'date',
      limit: 100,
    });
    expect(result).toEqual(branches);
  });

  it('includes both local and remote branches', async () => {
    mockListBranches.mockResolvedValue({
      sessionBranches: [
        makeBranch({ name: 'origin/remote', isRemote: true }),
        makeBranch({ name: 'local-only', isRemote: false }),
      ],
      otherBranches: [],
    });

    const result = await useBranchCacheStore.getState().fetchBranches('ws-1');
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.name)).toEqual(['origin/remote', 'local-only']);
  });

  it('returns cached data on second call within TTL', async () => {
    vi.useFakeTimers();
    const branches = [makeBranch()];
    mockListBranches.mockResolvedValue({
      sessionBranches: branches,
      otherBranches: [],
    });

    const first = await useBranchCacheStore.getState().fetchBranches('ws-1');
    mockListBranches.mockClear();

    // Advance less than TTL (5 min)
    vi.advanceTimersByTime(2 * 60 * 1000);

    const second = await useBranchCacheStore.getState().fetchBranches('ws-1');
    expect(mockListBranches).not.toHaveBeenCalled();
    expect(second).toBe(first);
  });

  it('refetches when cache expires after TTL', async () => {
    vi.useFakeTimers();
    const oldBranches = [makeBranch({ name: 'origin/old' })];
    const newBranches = [makeBranch({ name: 'origin/new' })];

    mockListBranches.mockResolvedValueOnce({
      sessionBranches: oldBranches,
      otherBranches: [],
    });

    await useBranchCacheStore.getState().fetchBranches('ws-1');

    // Advance past TTL
    vi.advanceTimersByTime(6 * 60 * 1000);

    mockListBranches.mockResolvedValueOnce({
      sessionBranches: newBranches,
      otherBranches: [],
    });

    // Stale data exists, so it returns stale and refreshes in background
    const result = await useBranchCacheStore.getState().fetchBranches('ws-1');
    expect(result).toEqual(oldBranches); // Returns stale data
    expect(mockListBranches).toHaveBeenCalled(); // But triggers background refresh
  });

  it('force fetch bypasses cache', async () => {
    vi.useFakeTimers();
    const branches = [makeBranch()];
    mockListBranches.mockResolvedValue({
      sessionBranches: branches,
      otherBranches: [],
    });

    await useBranchCacheStore.getState().fetchBranches('ws-1');
    mockListBranches.mockClear();

    mockListBranches.mockResolvedValue({
      sessionBranches: [makeBranch({ name: 'origin/forced' })],
      otherBranches: [],
    });

    const result = await useBranchCacheStore.getState().fetchBranches('ws-1', true);
    expect(mockListBranches).toHaveBeenCalled();
    expect(result[0].name).toBe('origin/forced');
  });

  it('handles API errors gracefully', async () => {
    mockListBranches.mockRejectedValue(new Error('network error'));

    await expect(
      useBranchCacheStore.getState().fetchBranches('ws-1')
    ).rejects.toThrow('network error');

    // Loading state should be cleared
    const entry = useBranchCacheStore.getState().cache['ws-1'];
    expect(entry?.isLoading).toBe(false);
  });

  it('caches per workspace independently', async () => {
    mockListBranches
      .mockResolvedValueOnce({
        sessionBranches: [makeBranch({ name: 'origin/ws1-branch' })],
        otherBranches: [],
      })
      .mockResolvedValueOnce({
        sessionBranches: [makeBranch({ name: 'origin/ws2-branch' })],
        otherBranches: [],
      });

    const ws1 = await useBranchCacheStore.getState().fetchBranches('ws-1');
    const ws2 = await useBranchCacheStore.getState().fetchBranches('ws-2');

    expect(ws1[0].name).toBe('origin/ws1-branch');
    expect(ws2[0].name).toBe('origin/ws2-branch');
  });

  it('combines sessionBranches and otherBranches', async () => {
    mockListBranches.mockResolvedValue({
      sessionBranches: [makeBranch({ name: 'origin/session-br' })],
      otherBranches: [makeBranch({ name: 'origin/other-br' })],
    });

    const result = await useBranchCacheStore.getState().fetchBranches('ws-1');
    expect(result).toHaveLength(2);
  });
});

// ============================================================================
// invalidateAll
// ============================================================================

describe('invalidateAll', () => {
  it('resets timestamps to 0 for all cached workspaces', async () => {
    mockListBranches.mockResolvedValue({
      sessionBranches: [makeBranch()],
      otherBranches: [],
    });

    await useBranchCacheStore.getState().fetchBranches('ws-1');
    await useBranchCacheStore.getState().fetchBranches('ws-2');

    useBranchCacheStore.getState().invalidateAll();

    const cache = useBranchCacheStore.getState().cache;
    expect(cache['ws-1'].timestamp).toBe(0);
    expect(cache['ws-2'].timestamp).toBe(0);
  });

  it('preserves branch data after invalidation', async () => {
    mockListBranches.mockResolvedValue({
      sessionBranches: [makeBranch({ name: 'origin/keep-me' })],
      otherBranches: [],
    });

    await useBranchCacheStore.getState().fetchBranches('ws-1');
    useBranchCacheStore.getState().invalidateAll();

    const entry = useBranchCacheStore.getState().cache['ws-1'];
    expect(entry.branches[0].name).toBe('origin/keep-me');
  });

  it('handles empty cache gracefully', () => {
    useBranchCacheStore.getState().invalidateAll();
    expect(useBranchCacheStore.getState().cache).toEqual({});
  });
});
