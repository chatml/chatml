import { useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useRecentlyClosedStore } from '@/stores/recentlyClosedStore';
import { getConversation, getConversationMessages, deleteConversation, toStoreMessage } from '@/lib/api';
import type { Conversation } from '@/lib/types';

/**
 * Captures a conversation's metadata into the recently-closed store.
 * Call this before removing a conversation from the app store.
 */
export function captureClosedConversation(conv: Conversation, workspaceId: string) {
  useRecentlyClosedStore.getState().addClosedConversation({
    id: conv.id,
    sessionId: conv.sessionId,
    workspaceId,
    name: conv.name,
    type: conv.type,
    closedAt: Date.now(),
    // messageCount is set by lazy loading; messages.length is accurate when loaded eagerly.
    // If neither is available, we store 0 (popover hides "0 msgs").
    messageCount: conv.messageCount ?? conv.messages?.length ?? 0,
    model: conv.model,
  });
}

/**
 * Permanently delete conversations from the backend. Fire-and-forget; errors are logged.
 */
export async function deleteClosedConversations(ids: string[]) {
  await Promise.allSettled(
    ids.map((id) => deleteConversation(id).catch((err) => {
      console.warn(`Failed to delete closed conversation ${id}:`, err);
    })),
  );
}

/**
 * Hook that returns a stable callback for restoring a recently-closed conversation
 * from the backend into the app store.
 */
export function useRestoreConversation(showError: (msg: string) => void) {
  return useCallback(async (convId: string) => {
    try {
      const convDTO = await getConversation(convId);
      const messagesPage = await getConversationMessages(convId, { limit: 50, compact: true });
      const messages = messagesPage.messages.map((m) => toStoreMessage(m, convDTO.id, { compacted: true }));

      const store = useAppStore.getState();
      store.addConversation({
        id: convDTO.id,
        sessionId: convDTO.sessionId,
        type: convDTO.type,
        name: convDTO.name,
        status: convDTO.status,
        model: convDTO.model,
        messages,
        toolSummary: convDTO.toolSummary?.map((t) => ({
          id: t.id,
          tool: t.tool,
          target: t.target,
          success: t.success,
        })) ?? [],
        createdAt: convDTO.createdAt,
        updatedAt: convDTO.updatedAt,
      });
      store.setMessagePage(
        convDTO.id,
        messages,
        messagesPage.hasMore,
        messagesPage.oldestPosition ?? 0,
        messagesPage.totalCount,
      );
      store.selectConversation(convDTO.id);
      useRecentlyClosedStore.getState().removeClosedConversation(convId);
    } catch {
      showError('Could not restore conversation. It may have been deleted.');
      useRecentlyClosedStore.getState().removeClosedConversation(convId);
    }
  }, [showError]);
}
