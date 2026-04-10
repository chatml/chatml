import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Shared attention ID builders — used by AttentionQueue and useAttentionCount
export const attentionId = {
  error: (sessionId: string) => `error-${sessionId}`,
  ci: (sessionId: string) => `ci-${sessionId}`,
  conflict: (sessionId: string) => `conflict-${sessionId}`,
  merge: (sessionId: string) => `merge-${sessionId}`,
  stale: (sessionId: string) => `stale-${sessionId}`,
  task: (runId: string) => `task-${runId}`,
} as const;

interface DismissEntry {
  id: string;
  at: number;
}

/** Returns the set of currently-active (non-expired) dismissed IDs. */
export function getActiveDismissedIds(entries: DismissEntry[], now?: number): Set<string> {
  const t = now ?? Date.now();
  return new Set(entries.filter((e) => t - e.at < DISMISS_TTL_MS).map((e) => e.id));
}

interface DismissedAttentionState {
  entries: DismissEntry[];
  dismiss: (id: string) => void;
}

export const useDismissedAttentionStore = create<DismissedAttentionState>()(
  persist(
    (set) => ({
      entries: [],

      dismiss: (id: string) => {
        const now = Date.now();
        set((state) => ({
          entries: [
            ...state.entries.filter((e) => e.id !== id && now - e.at < DISMISS_TTL_MS),
            { id, at: now },
          ],
        }));
      },
    }),
    {
      name: 'chatml-dismissed-attention',
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
