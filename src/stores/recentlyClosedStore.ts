import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_PER_SESSION = 10;

export interface ClosedConversation {
  id: string;
  sessionId: string;
  workspaceId: string;
  name: string;
  type: 'task' | 'review' | 'chat';
  closedAt: number;
  messageCount: number;
  model?: string;
}

interface RecentlyClosedState {
  closedConversations: ClosedConversation[];

  addClosedConversation: (conv: ClosedConversation) => void;
  removeClosedConversation: (id: string) => void;
  clearForSession: (sessionId: string) => void;
  getClosedForSession: (sessionId: string) => ClosedConversation[];
}

export const useRecentlyClosedStore = create<RecentlyClosedState>()(
  persist(
    (set, get) => ({
      closedConversations: [],

      addClosedConversation: (conv) => {
        const state = get();

        // Dedup: remove any existing entry for this conversation (e.g. close → restore → close)
        const withoutDup = state.closedConversations.filter((c) => c.id !== conv.id);

        let updated = [conv, ...withoutDup];

        // Evict oldest for this session if over the cap (drop from list only — no backend deletion)
        const sessionItems = updated.filter((c) => c.sessionId === conv.sessionId);
        if (sessionItems.length > MAX_PER_SESSION) {
          const oldest = sessionItems[sessionItems.length - 1];
          updated = updated.filter((c) => c.id !== oldest.id);
        }

        set({ closedConversations: updated });
      },

      removeClosedConversation: (id) => {
        set((state) => ({
          closedConversations: state.closedConversations.filter((c) => c.id !== id),
        }));
      },

      clearForSession: (sessionId) => {
        set((state) => ({
          closedConversations: state.closedConversations.filter(
            (c) => c.sessionId !== sessionId,
          ),
        }));
      },

      getClosedForSession: (sessionId) => {
        return get().closedConversations.filter((c) => c.sessionId === sessionId);
      },
    }),
    {
      name: 'chatml-recently-closed',
      partialize: (state) => ({
        closedConversations: state.closedConversations,
      }),
    },
  ),
);
