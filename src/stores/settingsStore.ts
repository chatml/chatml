import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Bottom panel tab IDs that can be toggled (Tasks is always visible)
export type BottomPanelTab = 'plans' | 'history' | 'budget' | 'mcp' | 'file-history';

// All bottom panel tabs including the always-visible Tasks
export type AllBottomPanelTab = 'todos' | BottomPanelTab;

// Default tab order
export const DEFAULT_BOTTOM_TAB_ORDER: AllBottomPanelTab[] = ['todos', 'plans', 'history', 'file-history', 'budget', 'mcp'];

// Theme options
export type ThemeOption = 'system' | 'light' | 'dark';

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
      setShowBottomTerminal: (value) => set({ showBottomTerminal: value }),
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
    }),
    {
      name: 'chatml-settings',
    }
  )
);
