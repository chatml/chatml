import { useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useDismissedAttentionStore, getActiveDismissedIds, attentionId } from '@/stores/dismissedAttentionStore';

/**
 * Returns the count of P0+P1 attention items for the dashboard badge.
 * Respects dismissed items from the shared store.
 */
export function useAttentionCount(): number {
  const sessions = useAppStore((s) => s.sessions);
  const dismissedEntries = useDismissedAttentionStore((s) => s.entries);

  return useMemo(() => {
    const dismissed = getActiveDismissedIds(dismissedEntries);

    let count = 0;
    for (const s of sessions) {
      if (s.archived) continue;
      if (s.status === 'error' && !dismissed.has(attentionId.error(s.id))) count++;
      if (s.checkStatus === 'failure' && s.prStatus === 'open' && !dismissed.has(attentionId.ci(s.id))) count++;
      if (s.hasMergeConflict && !dismissed.has(attentionId.conflict(s.id))) count++;
    }
    return count;
  }, [sessions, dismissedEntries]);
}
