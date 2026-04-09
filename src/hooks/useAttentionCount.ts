import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';

/**
 * Returns the count of P0+P1 attention items for the dashboard badge.
 * Derives from existing session data — no new API calls.
 */
export function useAttentionCount(): number {
  const sessions = useAppStore((s) => s.sessions);

  return useMemo(() => {
    let count = 0;
    for (const s of sessions) {
      if (s.archived) continue;
      // P0: Session errors
      if (s.status === 'error') count++;
      // P0: CI failures
      if (s.checkStatus === 'failure' && s.prStatus === 'open') count++;
      // P1: Merge conflicts
      if (s.hasMergeConflict) count++;
    }
    return count;
  }, [sessions]);
}
