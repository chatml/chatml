'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { getConversationMessages, toStoreMessage } from '@/lib/api';

const BATCH_SIZE = 3;

/**
 * Background prefetch hook that loads messages for all visible conversations
 * after initial boot, so switching sessions is instant instead of requiring
 * a network round trip on first click.
 */
export function useMessagePrefetch(enabled: boolean) {
  const abortRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    abortRef.current = false;

    async function prefetch() {
      const state = useAppStore.getState();
      const initialConvId = state.selectedConversationId;

      // Wait until the initial conversation's messages are loaded
      if (initialConvId && !state.messagePagination[initialConvId]) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (useAppStore.getState().messagePagination[initialConvId!] || abortRef.current) {
              resolve();
            } else {
              setTimeout(check, 200);
            }
          };
          check();
        });
      }

      if (abortRef.current) return;

      // Collect all conversation IDs that need prefetching
      const { conversations, sessions, messagePagination, messages,
        selectedWorkspaceId } = useAppStore.getState();

      const archivedSessionIds = new Set(
        sessions.filter(s => s.archived).map(s => s.id)
      );

      // Build a set of conversation IDs that already have messages loaded
      const convsWithMessages = new Set(messages.map(m => m.conversationId));

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
        if (abortRef.current) return;

        const batch = ordered.slice(i, i + BATCH_SIZE);

        await Promise.allSettled(
          batch.map(async (conv) => {
            if (abortRef.current) return;
            // Re-check in case ConversationArea already loaded this
            if (useAppStore.getState().messagePagination[conv.id]) return;

            try {
              const page = await getConversationMessages(conv.id, { limit: 50 });
              if (abortRef.current) return;
              const msgs = page.messages.map(m => toStoreMessage(m, conv.id));
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
      idleHandle = requestIdleCallback(() => { prefetch(); }, { timeout: 5000 });
    } else {
      timeoutHandle = setTimeout(() => { prefetch(); }, 2000);
    }

    return () => {
      abortRef.current = true;
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [enabled]);
}
