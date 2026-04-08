/**
 * Pre-warm session data on sidebar hover so clicking is instant.
 *
 * On hover, prefetches the session snapshot (git status, changes, stats)
 * and the target conversation's messages. By the time the user clicks,
 * hasSessionMessagesCached() returns true and the switch is synchronous.
 *
 * Features:
 * - Debounced (100ms) so rapid hover-across doesn't spam requests
 * - AbortController cancels previous prefetch when hovering a new item
 * - Skips if data is already cached
 */

import { getSessionSnapshot, getConversationMessages, toStoreMessage } from '@/lib/api';
import { getSessionData, setSessionData } from '@/lib/sessionDataCache';
import { useAppStore } from '@/stores/appStore';

let pendingController: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function prefetchSessionData(workspaceId: string, sessionId: string): void {
  // Cancel any pending prefetch
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingController?.abort();

  debounceTimer = setTimeout(() => {
    const controller = new AbortController();
    pendingController = controller;

    doPrefetch(workspaceId, sessionId, controller.signal).catch(() => {
      // Silently ignore — prefetch is best-effort
    });
  }, 100);
}

/** Cancel any in-flight prefetch (e.g. on mouse leave or click). */
export function cancelPrefetch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingController?.abort();
  pendingController = null;
}

async function doPrefetch(
  workspaceId: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<void> {
  // 1. Prefetch snapshot (git status, changes, stats) if not cached
  const cached = getSessionData(workspaceId, sessionId);
  if (!cached) {
    try {
      const snap = await getSessionSnapshot(workspaceId, sessionId, signal);
      if (signal.aborted) return;
      setSessionData(workspaceId, sessionId, {
        files: [],
        changes: snap.changes || [],
        allChanges: snap.allChanges || [],
        branchStats: snap.branchStats || null,
        gitStatus: snap.gitStatus,
        commits: snap.commits || [],
      });
    } catch {
      if (signal.aborted) return;
      // Best-effort — don't block on failure
    }
  }

  if (signal.aborted) return;

  // 2. Prefetch messages for the target conversation
  const state = useAppStore.getState();
  const conversations = state.conversations.filter(c => c.sessionId === sessionId);
  const lastActiveId = state.lastActiveConversationPerSession?.[sessionId];
  const targetConv = (lastActiveId && conversations.find(c => c.id === lastActiveId)) || conversations[0];

  if (!targetConv) return;

  // Skip if messages already loaded
  const existingMessages = state.messagesByConversation[targetConv.id];
  if (existingMessages && existingMessages.length > 0) return;
  if (state.messagePagination[targetConv.id]) return;

  try {
    const page = await getConversationMessages(targetConv.id, {
      limit: 50,
      compact: true,
      signal,
    });
    if (signal.aborted) return;

    const messages = page.messages.map(m => toStoreMessage(m, targetConv.id, { compacted: true }));
    useAppStore.getState().setMessagePage(
      targetConv.id,
      messages,
      page.hasMore,
      page.oldestPosition ?? 0,
      page.totalCount,
    );
  } catch {
    // Best-effort — the real load will happen on click anyway
  }
}
