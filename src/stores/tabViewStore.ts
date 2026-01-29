import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';
import type { TabView, TabViewState, TopPanelTab, AllBottomPanelTab } from '@/types/tabView';
import type { ContentView } from './settingsStore';

interface TabViewStore extends TabViewState {
  // Tab management
  createTab: (config?: Partial<TabView>) => string;  // Returns new tab ID
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<TabView>) => void;
  reorderTabs: (tabIds: string[]) => void;

  // Navigation (updates active tab's state)
  setContentView: (view: ContentView) => void;
  selectWorkspace: (id: string | null) => void;
  selectSession: (id: string | null) => void;
  selectConversation: (id: string | null) => void;
  selectFileTab: (id: string | null) => void;

  // Panel state (updates active tab's state)
  setRightSidebarVisible: (visible: boolean) => void;
  setActiveRightTab: (tab: TopPanelTab) => void;
  setBottomTerminalVisible: (visible: boolean) => void;
  setActiveBottomTab: (tab: AllBottomPanelTab) => void;
  setScrollPosition: (position: number) => void;

  // Helpers
  getActiveTab: () => TabView | undefined;
  findTabBySessionId: (sessionId: string) => TabView | undefined;
  generateTabLabel: (tab: TabView, sessionName?: string, workspaceName?: string) => string;

  // Internal initialization
  _ensureDefaultTab: () => void;
}

export const useTabViewStore = create<TabViewStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: '',

      _ensureDefaultTab: () => {
        const { tabs } = get();
        if (tabs.length === 0) {
          const defaultTab: TabView = {
            id: uuid(),
            label: 'Dashboard',
            icon: '📊',
            contentView: { type: 'global-dashboard' },
            selectedWorkspaceId: null,
            selectedSessionId: null,
            selectedConversationId: null,
            selectedFileTabId: null,
            rightSidebarVisible: true,
            activeRightTab: 'changes',
            bottomTerminalVisible: false,
            activeBottomTab: 'todos',
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
          };
          set({ tabs: [defaultTab], activeTabId: defaultTab.id });
        }
      },

      createTab: (config) => {
        const newId = uuid();
        const activeTab = get().getActiveTab();

        // Clone active tab or use defaults
        const newTab: TabView = {
          id: newId,
          label: config?.label || (activeTab ? get().generateTabLabel(activeTab) : 'New Tab'),
          icon: config?.icon ?? activeTab?.icon,
          contentView: config?.contentView ?? activeTab?.contentView ?? { type: 'global-dashboard' },
          selectedWorkspaceId: config?.selectedWorkspaceId ?? activeTab?.selectedWorkspaceId ?? null,
          selectedSessionId: config?.selectedSessionId ?? activeTab?.selectedSessionId ?? null,
          selectedConversationId: config?.selectedConversationId ?? activeTab?.selectedConversationId ?? null,
          selectedFileTabId: config?.selectedFileTabId ?? activeTab?.selectedFileTabId ?? null,
          rightSidebarVisible: config?.rightSidebarVisible ?? activeTab?.rightSidebarVisible ?? true,
          activeRightTab: config?.activeRightTab ?? activeTab?.activeRightTab ?? 'changes',
          bottomTerminalVisible: config?.bottomTerminalVisible ?? activeTab?.bottomTerminalVisible ?? false,
          activeBottomTab: config?.activeBottomTab ?? activeTab?.activeBottomTab ?? 'todos',
          scrollPosition: 0,
          createdAt: Date.now(),
          lastAccessedAt: Date.now(),
        };

        set(state => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newId,
        }));

        return newId;
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId } = get();
        if (tabs.length <= 1) return; // Prevent closing last tab

        const newTabs = tabs.filter(t => t.id !== tabId);
        let newActiveId = activeTabId;

        if (activeTabId === tabId) {
          // Switch to adjacent tab
          const closedIndex = tabs.findIndex(t => t.id === tabId);
          const nextTab = newTabs[closedIndex] || newTabs[closedIndex - 1];
          newActiveId = nextTab.id;
        }

        set({ tabs: newTabs, activeTabId: newActiveId });
      },

      setActiveTab: (tabId) => {
        set(state => ({
          activeTabId: tabId,
          tabs: state.tabs.map(t =>
            t.id === tabId
              ? { ...t, lastAccessedAt: Date.now() }
              : t
          ),
        }));
      },

      updateTab: (tabId, updates) => {
        set(state => ({
          tabs: state.tabs.map(t =>
            t.id === tabId
              ? { ...t, ...updates, lastAccessedAt: Date.now() }
              : t
          ),
        }));
      },

      reorderTabs: (tabIds) => {
        const { tabs } = get();
        const reordered = tabIds.map(id => tabs.find(t => t.id === id)!).filter(Boolean);
        set({ tabs: reordered });
      },

      // Navigation actions (update active tab)
      setContentView: (view) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { contentView: view });
      },

      selectWorkspace: (id) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { selectedWorkspaceId: id });
      },

      selectSession: (id) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { selectedSessionId: id });
      },

      selectConversation: (id) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { selectedConversationId: id });
      },

      selectFileTab: (id) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { selectedFileTabId: id });
      },

      // Panel state actions
      setRightSidebarVisible: (visible) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { rightSidebarVisible: visible });
      },

      setActiveRightTab: (tab) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { activeRightTab: tab });
      },

      setBottomTerminalVisible: (visible) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { bottomTerminalVisible: visible });
      },

      setActiveBottomTab: (tab) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { activeBottomTab: tab });
      },

      setScrollPosition: (position) => {
        const { activeTabId } = get();
        get().updateTab(activeTabId, { scrollPosition: position });
      },

      // Helpers
      getActiveTab: () => {
        const { tabs, activeTabId } = get();
        return tabs.find(t => t.id === activeTabId);
      },

      findTabBySessionId: (sessionId) => {
        const { tabs } = get();
        return tabs.find(t =>
          t.selectedSessionId === sessionId &&
          t.contentView.type === 'conversation'
        );
      },

      generateTabLabel: (tab, sessionName, workspaceName) => {
        // Generate label based on tab content
        if (tab.contentView.type === 'conversation' && sessionName) {
          return sessionName;
        }

        switch (tab.contentView.type) {
          case 'global-dashboard': return 'Dashboard';
          case 'repositories': return 'Repositories';
          case 'pr-dashboard': return 'Pull Requests';
          case 'session-manager': return 'Sessions';
          case 'workspace-dashboard':
            return workspaceName ? `${workspaceName}` : 'Workspace';
          case 'branches':
            return workspaceName ? `${workspaceName} - Branches` : 'Branches';
          default: return 'New Tab';
        }
      },
    }),
    {
      name: 'tab-view-storage',
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
