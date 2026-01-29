import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTabViewStore } from './tabViewStore';

// Bottom panel tab IDs that can be toggled (Tasks is always visible)
export type BottomPanelTab = 'plans' | 'history' | 'budget' | 'mcp' | 'file-history';

// All bottom panel tabs including the always-visible Tasks
export type AllBottomPanelTab = 'todos' | BottomPanelTab;

// Default tab order
export const DEFAULT_BOTTOM_TAB_ORDER: AllBottomPanelTab[] = ['todos', 'plans', 'history', 'file-history', 'budget', 'mcp'];

// Top panel (right sidebar) tab IDs - Changes is always visible
export type TopPanelTab = 'review' | 'checks' | 'files';

// All top panel tabs including the always-visible Changes
export type AllTopPanelTab = 'changes' | TopPanelTab;

// Default top tab order
export const DEFAULT_TOP_TAB_ORDER: AllTopPanelTab[] = ['changes', 'review', 'checks', 'files'];

// Theme options
export type ThemeOption = 'system' | 'light' | 'dark';

// Content view types for Full Content Area pattern
export type ContentView =
  | { type: 'conversation' }
  | { type: 'global-dashboard' }
  | { type: 'workspace-dashboard'; workspaceId: string }
  | { type: 'pr-dashboard'; workspaceId?: string }
  | { type: 'branches'; workspaceId: string }
  | { type: 'repositories' }
  | { type: 'session-manager' };

// Panel layout type - maps panel id to size (percentage)
export type PanelLayout = Record<string, number>;

// Default panel layouts
export const DEFAULT_LAYOUTS = {
  outer: { 'left-sidebar': 22, 'main-content': 78 },
  inner: { 'inner-content': 72, 'right-sidebar': 28 },
  vertical: { 'conversation': 70, 'bottom-terminal': 30 },
  changes: { 'file-list': 65, 'terminal': 35 },
} as const;

interface SettingsState {
  // Chat settings
  confirmCloseActiveTab: boolean;
  defaultModel: string;
  defaultThinking: boolean;
  desktopNotifications: boolean;
  soundEffects: boolean;
  sendWithEnter: boolean;
  // Window settings
  minimizeToTray: boolean;
  // Appearance settings
  theme: ThemeOption; // App theme (system, light, dark)
  editorTheme: string; // Monaco editor theme (e.g., 'vs-dark', 'monokai', 'dracula')
  // UI state
  collapsedWorkspaces: string[]; // Workspace IDs that are collapsed (all others are expanded)
  showBottomTerminal: boolean;
  zenMode: boolean; // Distraction-free mode that hides sidebars
  hiddenBottomTabs: BottomPanelTab[]; // Bottom panel tabs that are hidden (Tasks always visible)
  bottomTabOrder: AllBottomPanelTab[]; // Order of bottom panel tabs
  hiddenTopTabs: TopPanelTab[]; // Top panel tabs that are hidden (Changes always visible)
  topTabOrder: AllTopPanelTab[]; // Order of top panel tabs
  // Full Content Area view state (not persisted - always starts in conversation view)
  contentView: ContentView;
  // Panel layouts (persisted)
  layoutOuter: PanelLayout | undefined;
  layoutInner: PanelLayout | undefined;
  layoutVertical: PanelLayout | undefined;
  layoutChanges: PanelLayout | undefined;

  // Actions
  setConfirmCloseActiveTab: (value: boolean) => void;
  setDefaultModel: (value: string) => void;
  setDefaultThinking: (value: boolean) => void;
  setDesktopNotifications: (value: boolean) => void;
  setSoundEffects: (value: boolean) => void;
  setSendWithEnter: (value: boolean) => void;
  setMinimizeToTray: (value: boolean) => void;
  setTheme: (value: ThemeOption) => void;
  setEditorTheme: (value: string) => void;
  setShowBottomTerminal: (value: boolean) => void;
  setZenMode: (value: boolean) => void;
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  expandWorkspace: (workspaceId: string) => void;
  toggleBottomTab: (tab: BottomPanelTab) => void;
  setBottomTabOrder: (order: AllBottomPanelTab[]) => void;
  toggleTopTab: (tab: TopPanelTab) => void;
  setTopTabOrder: (order: AllTopPanelTab[]) => void;
  setContentView: (view: ContentView) => void;
  setLayoutOuter: (layout: PanelLayout) => void;
  setLayoutInner: (layout: PanelLayout) => void;
  setLayoutVertical: (layout: PanelLayout) => void;
  setLayoutChanges: (layout: PanelLayout) => void;
  resetLayouts: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      confirmCloseActiveTab: true,
      defaultModel: 'opus-4.5',
      defaultThinking: true,
      desktopNotifications: true,
      soundEffects: false,
      sendWithEnter: true,
      minimizeToTray: false,
      theme: 'system',
      editorTheme: 'vs-dark',
      collapsedWorkspaces: [], // Workspace IDs that are collapsed (all others expanded by default)
      showBottomTerminal: false,
      zenMode: false,
      hiddenBottomTabs: [], // All tabs visible by default
      bottomTabOrder: DEFAULT_BOTTOM_TAB_ORDER, // Default tab order
      hiddenTopTabs: [], // All top tabs visible by default
      topTabOrder: DEFAULT_TOP_TAB_ORDER, // Default top tab order
      contentView: { type: 'conversation' }, // Always start in conversation view
      layoutOuter: undefined, // Use defaults until user resizes
      layoutInner: undefined,
      layoutVertical: undefined,
      layoutChanges: undefined,

      // Actions
      setConfirmCloseActiveTab: (value) => set({ confirmCloseActiveTab: value }),
      setDefaultModel: (value) => set({ defaultModel: value }),
      setDefaultThinking: (value) => set({ defaultThinking: value }),
      setDesktopNotifications: (value) => set({ desktopNotifications: value }),
      setSoundEffects: (value) => set({ soundEffects: value }),
      setSendWithEnter: (value) => set({ sendWithEnter: value }),
      setMinimizeToTray: (value) => set({ minimizeToTray: value }),
      setTheme: (value) => set({ theme: value }),
      setEditorTheme: (value) => set({ editorTheme: value }),
      setShowBottomTerminal: (value) => {
        set({ showBottomTerminal: value });
        // Also update TabViewStore
        useTabViewStore.getState().setBottomTerminalVisible(value);
      },
      setZenMode: (value) => set({ zenMode: value }),
      toggleWorkspaceCollapsed: (workspaceId) =>
        set((state) => ({
          collapsedWorkspaces: state.collapsedWorkspaces.includes(workspaceId)
            ? state.collapsedWorkspaces.filter((id) => id !== workspaceId)
            : [...state.collapsedWorkspaces, workspaceId],
        })),
      expandWorkspace: (workspaceId) =>
        set((state) => ({
          collapsedWorkspaces: state.collapsedWorkspaces.filter((id) => id !== workspaceId),
        })),
      toggleBottomTab: (tab) =>
        set((state) => ({
          hiddenBottomTabs: state.hiddenBottomTabs.includes(tab)
            ? state.hiddenBottomTabs.filter((t) => t !== tab)
            : [...state.hiddenBottomTabs, tab],
        })),
      setBottomTabOrder: (order) => set({ bottomTabOrder: order }),
      toggleTopTab: (tab) =>
        set((state) => ({
          hiddenTopTabs: state.hiddenTopTabs.includes(tab)
            ? state.hiddenTopTabs.filter((t) => t !== tab)
            : [...state.hiddenTopTabs, tab],
        })),
      setTopTabOrder: (order) => set({ topTabOrder: order }),
      setContentView: (view) => {
        set({ contentView: view });
        // Also update TabViewStore
        useTabViewStore.getState().setContentView(view);
      },
      setLayoutOuter: (layout) => set({ layoutOuter: layout }),
      setLayoutInner: (layout) => set({ layoutInner: layout }),
      setLayoutVertical: (layout) => set({ layoutVertical: layout }),
      setLayoutChanges: (layout) => set({ layoutChanges: layout }),
      resetLayouts: () => set({
        layoutOuter: undefined,
        layoutInner: undefined,
        layoutVertical: undefined,
        layoutChanges: undefined,
      }),
    }),
    {
      name: 'chatml-settings',
      // Exclude contentView from persistence - always start in conversation view
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { contentView, ...rest } = state;
        return rest;
      },
      // Merge persisted state with defaults to handle new tabs added after initial save
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SettingsState>;
        const merged = { ...currentState, ...persisted };

        // Ensure bottomTabOrder includes all tabs from DEFAULT_BOTTOM_TAB_ORDER
        // This handles the case where new tabs are added after the user's settings were saved
        if (persisted.bottomTabOrder) {
          const existingOrder = persisted.bottomTabOrder;
          const missingTabs = DEFAULT_BOTTOM_TAB_ORDER.filter(
            (tab) => !existingOrder.includes(tab)
          );
          // Append missing tabs to the end of the user's existing order
          merged.bottomTabOrder = [...existingOrder, ...missingTabs];
        }

        // Ensure topTabOrder includes all tabs from DEFAULT_TOP_TAB_ORDER
        if (persisted.topTabOrder) {
          const existingOrder = persisted.topTabOrder;
          const missingTabs = DEFAULT_TOP_TAB_ORDER.filter(
            (tab) => !existingOrder.includes(tab)
          );
          merged.topTabOrder = [...existingOrder, ...missingTabs];
        }

        return merged;
      },
    }
  )
);
