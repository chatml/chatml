import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ContentView } from './settingsStore';

const DEFAULT_TAB_ID = 'default';
const MAX_TABS = 20;

export interface BrowserTab {
  id: string;
  label: string;
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  selectedConversationId: string | null;
  contentView: ContentView;
  selectedFileTabId: string | null;
  createdAt: number;
}

function createDefaultTab(): BrowserTab {
  return {
    id: DEFAULT_TAB_ID,
    label: 'New Tab',
    selectedWorkspaceId: null,
    selectedSessionId: null,
    selectedConversationId: null,
    contentView: { type: 'conversation' },
    selectedFileTabId: null,
    createdAt: Date.now(),
  };
}

function generateTabId(): string {
  return crypto.randomUUID().slice(0, 8);
}

interface TabStoreState {
  tabs: Record<string, BrowserTab>;
  tabOrder: string[];
  activeTabId: string;

  /** Create a new browser tab. Returns the new tab ID. */
  createTab: (initialState?: Partial<Pick<BrowserTab,
    'selectedWorkspaceId' | 'selectedSessionId' | 'selectedConversationId' |
    'contentView' | 'selectedFileTabId' | 'label'
  >>) => string;

  /** Close a browser tab. If it's the last tab, creates a fresh empty tab. */
  closeTab: (tabId: string) => void;

  /** Switch to a different browser tab. */
  activateTab: (tabId: string) => void;

  /** Update the active tab's view state (partial update). */
  updateActiveTab: (updates: Partial<Pick<BrowserTab,
    'selectedWorkspaceId' | 'selectedSessionId' | 'selectedConversationId' |
    'contentView' | 'selectedFileTabId' | 'label'
  >>) => void;

  /** Update a specific tab's view state (partial update). */
  updateTab: (tabId: string, updates: Partial<Pick<BrowserTab,
    'selectedWorkspaceId' | 'selectedSessionId' | 'selectedConversationId' |
    'contentView' | 'selectedFileTabId' | 'label'
  >>) => void;

  /** Reorder tabs by moving a tab from one index to another. */
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  /** Duplicate a tab, placing the copy after the original. Returns new tab ID. */
  duplicateTab: (tabId: string) => string;

  /** Close all tabs except the specified one. */
  closeOtherTabs: (tabId: string) => void;

  /** Close all tabs to the right of the specified one. */
  closeTabsToRight: (tabId: string) => void;
}

export const useTabStore = create<TabStoreState>()(
  persist(
    (set, get) => ({
      tabs: { [DEFAULT_TAB_ID]: createDefaultTab() },
      tabOrder: [DEFAULT_TAB_ID],
      activeTabId: DEFAULT_TAB_ID,

      createTab: (initialState) => {
        const state = get();
        if (state.tabOrder.length >= MAX_TABS) {
          // At max tabs, just return the active tab
          return state.activeTabId;
        }

        const id = generateTabId();
        const activeTab = state.tabs[state.activeTabId];

        const newTab: BrowserTab = {
          id,
          label: initialState?.label ?? 'New Tab',
          selectedWorkspaceId: initialState?.selectedWorkspaceId ?? activeTab?.selectedWorkspaceId ?? null,
          selectedSessionId: initialState?.selectedSessionId ?? null,
          selectedConversationId: initialState?.selectedConversationId ?? null,
          contentView: initialState?.contentView ?? { type: 'conversation' },
          selectedFileTabId: initialState?.selectedFileTabId ?? null,
          createdAt: Date.now(),
        };

        // Insert after the active tab
        const activeIndex = state.tabOrder.indexOf(state.activeTabId);
        const newOrder = [...state.tabOrder];
        newOrder.splice(activeIndex + 1, 0, id);

        set({
          tabs: { ...state.tabs, [id]: newTab },
          tabOrder: newOrder,
        });

        return id;
      },

      closeTab: (tabId) => {
        const state = get();
        const { tabs, tabOrder, activeTabId } = state;

        if (!(tabId in tabs)) return;

        // If this is the last tab, replace with a fresh empty tab
        if (tabOrder.length <= 1) {
          const freshTab = createDefaultTab();
          freshTab.id = generateTabId();
          freshTab.contentView = { type: 'repositories' };
          freshTab.label = 'Repositories';
          set({
            tabs: { [freshTab.id]: freshTab },
            tabOrder: [freshTab.id],
            activeTabId: freshTab.id,
          });
          return;
        }

        // Remove the tab
        const newTabs = { ...tabs };
        delete newTabs[tabId];
        const newOrder = tabOrder.filter((id) => id !== tabId);

        // If closing the active tab, activate the adjacent one
        let newActiveId = activeTabId;
        if (activeTabId === tabId) {
          const closedIndex = tabOrder.indexOf(tabId);
          // Prefer the tab to the right, fall back to the left
          const newIndex = Math.min(closedIndex, newOrder.length - 1);
          newActiveId = newOrder[newIndex];
        }

        set({
          tabs: newTabs,
          tabOrder: newOrder,
          activeTabId: newActiveId,
        });
      },

      activateTab: (tabId) => {
        const state = get();
        if (!(tabId in state.tabs) || tabId === state.activeTabId) return;
        set({ activeTabId: tabId });
      },

      updateActiveTab: (updates) => {
        const state = get();
        const tab = state.tabs[state.activeTabId];
        if (!tab) return;
        set({
          tabs: {
            ...state.tabs,
            [state.activeTabId]: { ...tab, ...updates },
          },
        });
      },

      updateTab: (tabId, updates) => {
        const state = get();
        const tab = state.tabs[tabId];
        if (!tab) return;
        set({
          tabs: {
            ...state.tabs,
            [tabId]: { ...tab, ...updates },
          },
        });
      },

      reorderTabs: (fromIndex, toIndex) => {
        const state = get();
        const newOrder = [...state.tabOrder];
        const [moved] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, moved);
        set({ tabOrder: newOrder });
      },

      duplicateTab: (tabId) => {
        const state = get();
        const source = state.tabs[tabId];
        if (!source || state.tabOrder.length >= MAX_TABS) {
          return state.activeTabId;
        }

        const id = generateTabId();
        const newTab: BrowserTab = {
          ...source,
          id,
          label: source.label,
          createdAt: Date.now(),
        };

        const sourceIndex = state.tabOrder.indexOf(tabId);
        const newOrder = [...state.tabOrder];
        newOrder.splice(sourceIndex + 1, 0, id);

        set({
          tabs: { ...state.tabs, [id]: newTab },
          tabOrder: newOrder,
        });

        return id;
      },

      closeOtherTabs: (tabId) => {
        const state = get();
        const tab = state.tabs[tabId];
        if (!tab) return;
        set({
          tabs: { [tabId]: tab },
          tabOrder: [tabId],
          activeTabId: tabId,
        });
      },

      closeTabsToRight: (tabId) => {
        const state = get();
        const index = state.tabOrder.indexOf(tabId);
        if (index === -1) return;

        const keepOrder = state.tabOrder.slice(0, index + 1);
        const newTabs: Record<string, BrowserTab> = {};
        for (const id of keepOrder) {
          newTabs[id] = state.tabs[id];
        }

        // If active tab was to the right, activate the specified tab
        const newActiveId = keepOrder.includes(state.activeTabId)
          ? state.activeTabId
          : tabId;

        set({
          tabs: newTabs,
          tabOrder: keepOrder,
          activeTabId: newActiveId,
        });
      },
    }),
    {
      name: 'chatml-browser-tabs',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<TabStoreState>;

        // Validate persisted data integrity
        if (
          !persisted.tabs || typeof persisted.tabs !== 'object' ||
          !Array.isArray(persisted.tabOrder) ||
          !persisted.activeTabId
        ) {
          return currentState;
        }

        // Filter out any orphaned tab IDs from tabOrder
        const validOrder = persisted.tabOrder.filter((id) => id in persisted.tabs!);
        if (validOrder.length === 0) {
          return currentState;
        }

        // Ensure activeTabId is valid
        const activeTabId = validOrder.includes(persisted.activeTabId)
          ? persisted.activeTabId
          : validOrder[0];

        // Build clean tabs map (only tabs in the order)
        const tabs: Record<string, BrowserTab> = {};
        for (const id of validOrder) {
          const tab = { ...persisted.tabs[id] };
          // Migrate removed contentView types
          const cvType = (tab.contentView as { type: string })?.type;
          if (cvType === 'global-dashboard') {
            tab.contentView = { type: 'repositories' };
          } else if (cvType === 'workspace-dashboard') {
            const workspaceId = (tab.contentView as { workspaceId?: string }).workspaceId;
            if (workspaceId) {
              tab.contentView = { type: 'branches', workspaceId };
            } else {
              tab.contentView = { type: 'repositories' };
            }
          }
          tabs[id] = tab;
        }

        return {
          ...currentState,
          tabs,
          tabOrder: validOrder,
          activeTabId,
        };
      },
    },
  ),
);
