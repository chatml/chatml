import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  editorTheme: string; // Monaco editor theme (e.g., 'vs-dark', 'monokai', 'dracula')
  // UI state
  collapsedWorkspaces: string[]; // Workspace IDs that are collapsed (all others are expanded)
  showBottomTerminal: boolean;
  zenMode: boolean; // Distraction-free mode that hides sidebars

  // Actions
  setConfirmCloseActiveTab: (value: boolean) => void;
  setDefaultModel: (value: string) => void;
  setDefaultThinking: (value: boolean) => void;
  setDesktopNotifications: (value: boolean) => void;
  setSoundEffects: (value: boolean) => void;
  setSendWithEnter: (value: boolean) => void;
  setMinimizeToTray: (value: boolean) => void;
  setEditorTheme: (value: string) => void;
  setShowBottomTerminal: (value: boolean) => void;
  setZenMode: (value: boolean) => void;
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  expandWorkspace: (workspaceId: string) => void;
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
      editorTheme: 'vs-dark',
      collapsedWorkspaces: [], // Workspace IDs that are collapsed (all others expanded by default)
      showBottomTerminal: false,
      zenMode: false,

      // Actions
      setConfirmCloseActiveTab: (value) => set({ confirmCloseActiveTab: value }),
      setDefaultModel: (value) => set({ defaultModel: value }),
      setDefaultThinking: (value) => set({ defaultThinking: value }),
      setDesktopNotifications: (value) => set({ desktopNotifications: value }),
      setSoundEffects: (value) => set({ soundEffects: value }),
      setSendWithEnter: (value) => set({ sendWithEnter: value }),
      setMinimizeToTray: (value) => set({ minimizeToTray: value }),
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
    }),
    {
      name: 'chatml-settings',
    }
  )
);
