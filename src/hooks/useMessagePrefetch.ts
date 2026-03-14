'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { getConversationMessages, toStoreMessage } from '@/lib/api';

const BATCH_SIZE = 3;

/**
 * Background prefetch hook that loads messages for all visible conversations
 * after initial boot, so switching sessions is instant instead of requiring
 * a network round trip on first click.
 *
 * Re-triggers when conversationsVersion changes (e.g., when lazy-loaded
 * workspace conversations are added to the store).
 */
export function useMessagePrefetch(enabled: boolean) {
  const hasRunInitialRef = useRef(false);
  const runIdRef = useRef(0);
  const conversationsVersion = useAppStore((s) => s.conversationsVersion);

  useEffect(() => {
    if (!enabled) return;
    const currentRun = ++runIdRef.current;
    const isAborted = () => currentRun !== runIdRef.current;

    async function prefetch() {
      const state = useAppStore.getState();
      const initialConvId = state.selectedConversationId;

      // On first run, wait until the initial conversation's messages are loaded.
      // On subsequent runs (triggered by conversationsVersion), skip the wait.
      if (!hasRunInitialRef.current && initialConvId && !state.messagePagination[initialConvId]) {
        if (isAborted()) return;
        await new Promise<void>((resolve) => {
          const unsub = useAppStore.subscribe((s) => {
            if (s.messagePagination[initialConvId!] || isAborted()) {
              unsub();
              resolve();
            }
          });
          // Immediate post-subscribe check closes the race window where state
          // changed or abort fired between getState() above and subscribe()
          if (useAppStore.getState().messagePagination[initialConvId] || isAborted()) {
            unsub();
            resolve();
          }
        });
      }

      if (isAborted()) return;
      hasRunInitialRef.current = true;

      // Collect all conversation IDs that need prefetching
      const { conversations, sessions, messagePagination, messagesByConversation,
        selectedWorkspaceId } = useAppStore.getState();

      const archivedSessionIds = new Set(
        sessions.filter(s => s.archived).map(s => s.id)
      );

      // Build a set of conversation IDs that already have messages loaded
      const convsWithMessages = new Set(Object.keys(messagesByConversation).filter(id => messagesByConversation[id].length > 0));

      const needsFetch = conversations.filter(c => {
        if (archivedSessionIds.has(c.sessionId)) return false;
        if (messagePagination[c.id]) return false;
        if (convsWithMessages.has(c.id)) return false;
        return true;
      });

      // Build session lookup map for O(1) access
      const sessionById = new Map(sessions.map(s => [s.id, s]));

      // Prioritize: same workspace first
      const sameWorkspace: typeof needsFetch = [];
      const otherWorkspaces: typeof needsFetch = [];
      for (const conv of needsFetch) {
        const session = sessionById.get(conv.sessionId);
        if (session?.workspaceId === selectedWorkspaceId) {
          sameWorkspace.push(conv);
        } else {
          otherWorkspaces.push(conv);
        }
      }
      const ordered = [...sameWorkspace, ...otherWorkspaces];

      // Process in batches
      for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
        if (isAborted()) return;

        const batch = ordered.slice(i, i + BATCH_SIZE);

        await Promise.allSettled(
          batch.map(async (conv) => {
            if (isAborted()) return;
            // Re-check in case ConversationArea already loaded this
            if (useAppStore.getState().messagePagination[conv.id]) return;

            try {
              const page = await getConversationMessages(conv.id, { limit: 50, compact: true });
              if (isAborted()) return;
              const msgs = page.messages.map(m => toStoreMessage(m, conv.id, { compacted: true }));
              useAppStore.getState().setMessagePage(
                conv.id, msgs, page.hasMore,
                page.oldestPosition ?? 0, page.totalCount
              );
            } catch {
              // Silently ignore — ConversationArea will retry on demand
            }
          })
        );

        // Yield to main thread between batches
        if (i + BATCH_SIZE < ordered.length) {
          await new Promise<void>((resolve) => {
            if (typeof requestIdleCallback === 'function') {
              requestIdleCallback(() => resolve(), { timeout: 2000 });
            } else {
              setTimeout(resolve, 100);
            }
          });
        }
      }
    }

    // Defer the entire prefetch to idle time
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => { prefetch(); }, { timeout: 3000 });
    } else {
      timeoutHandle = setTimeout(() => { prefetch(); }, 500);
    }

    return () => {
      runIdRef.current++;
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [enabled, conversationsVersion]);
}
