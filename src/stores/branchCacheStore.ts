import { create } from 'zustand';
import { listBranches, type BranchDTO } from '@/lib/api';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — matches backend cache

interface BranchCacheEntry {
  branches: BranchDTO[];
  timestamp: number;
  isLoading: boolean;
}

interface BranchCacheState {
  cache: Record<string, BranchCacheEntry>;

  /** Fetch branches for a workspace, returning cached data if fresh. */
  fetchBranches: (workspaceId: string, force?: boolean) => Promise<BranchDTO[]>;

  /** Mark all caches stale so the next access triggers a re-fetch. */
  invalidateAll: () => void;
}

const inFlightFetches = new Map<string, Promise<BranchDTO[]>>();

export const useBranchCacheStore = create<BranchCacheState>((set, get) => ({
  cache: {},

  fetchBranches: async (workspaceId, force = false) => {
    const entry = get().cache[workspaceId];

    // Return cache if fresh and not forced
    if (entry && !force && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      return entry.branches;
    }

    // If we have cached data but it's stale, return it and refresh in background
    if (entry?.branches.length && !force) {
      if (!inFlightFetches.has(workspaceId)) {
        const promise = doFetch(workspaceId, set).finally(() => {
          inFlightFetches.delete(workspaceId);
        });
        inFlightFetches.set(workspaceId, promise);
        promise.catch(() => {}); // Prevent unhandled rejection for background refresh
      }
      return entry.branches;
    }

    // No cached data or forced — fetch and wait (deduplicated)
    const existing = inFlightFetches.get(workspaceId);
    if (existing && !force) {
      return existing;
    }

    set((state) => ({
      cache: {
        ...state.cache,
        [workspaceId]: { branches: entry?.branches ?? [], timestamp: entry?.timestamp ?? 0, isLoading: true },
      },
    }));

    const promise = doFetch(workspaceId, set).finally(() => {
      inFlightFetches.delete(workspaceId);
    });
    inFlightFetches.set(workspaceId, promise);
    return promise;
  },

  invalidateAll: () => {
    inFlightFetches.clear();
    set((state) => {
      const updated: Record<string, BranchCacheEntry> = {};
      for (const [id, entry] of Object.entries(state.cache)) {
        updated[id] = { ...entry, timestamp: 0 };
      }
      return { cache: updated };
    });
  },
}));

async function doFetch(
  workspaceId: string,
  set: (fn: (state: BranchCacheState) => Partial<BranchCacheState>) => void,
): Promise<BranchDTO[]> {
  try {
    const res = await listBranches(workspaceId, {
      includeRemote: true,
      sortBy: 'date',
      limit: 100,
    });
    const branches = [...res.sessionBranches, ...res.otherBranches];

    set((state) => ({
      cache: {
        ...state.cache,
        [workspaceId]: { branches, timestamp: Date.now(), isLoading: false },
      },
    }));

    return branches;
  } catch (error) {
    set((state) => ({
      cache: {
        ...state.cache,
        [workspaceId]: { ...state.cache[workspaceId], isLoading: false },
      },
    }));
    throw error;
  }
}
