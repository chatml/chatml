import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace } from '@/lib/types';
import { useAuthStore } from '@/stores/authStore';
import type { ThinkingLevel } from '@/lib/thinkingLevels';

// Bottom panel tab IDs that can be toggled (Tasks is always visible)
// TODO: Re-add 'scripts' to BottomPanelTab when the Scripts feature is reintroduced (see ScriptsPanel.tsx)
export type BottomPanelTab = 'history' | 'budget' | 'mcp' | 'file-history';

// All bottom panel tabs including the always-visible Tasks
export type AllBottomPanelTab = 'todos' | BottomPanelTab;

// Default tab order
export const DEFAULT_BOTTOM_TAB_ORDER: AllBottomPanelTab[] = ['todos', 'history', 'file-history', 'budget', 'mcp'];

// Top panel (right sidebar) tab IDs - Changes is always visible
export type TopPanelTab = 'review' | 'checks' | 'files';

// All top panel tabs including the always-visible Changes
export type AllTopPanelTab = 'changes' | TopPanelTab;

// Default top tab order
export const DEFAULT_TOP_TAB_ORDER: AllTopPanelTab[] = ['files', 'changes', 'checks', 'review'];

// Theme options
export type ThemeOption = 'system' | 'light' | 'dark';

// Font size options
export type FontSize = 'small' | 'medium' | 'large';

// Re-export ThinkingLevel for convenience
export type { ThinkingLevel } from '@/lib/thinkingLevels';

// Branch prefix options
export type BranchPrefixType = 'github' | 'custom' | 'none';

// Sidebar grouping options
export type SidebarGroupBy = 'none' | 'project' | 'status' | 'project-status';

// Sidebar sorting options
export type SidebarSortBy = 'recent' | 'status' | 'priority' | 'name';

// Content view types for Full Content Area pattern
export type ContentView =
  | { type: 'conversation' }
  | { type: 'pr-dashboard'; workspaceId?: string }
  | { type: 'branches'; workspaceId: string }
  | { type: 'repositories' }
  | { type: 'session-manager' }
  | { type: 'skills-store' };

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
  confirmArchiveDirtySession: boolean;
  defaultModel: string;
  defaultThinkingLevel: ThinkingLevel;
  maxThinkingTokens: number; // Secondary setting for Sonnet/Haiku token budget
  showThinkingBlocks: boolean; // Whether to show thinking/reasoning content in messages
  showTokenUsage: boolean; // Whether to show token counts and cost breakdown in run summaries
  desktopNotifications: boolean;
  soundEffects: boolean;
  soundEffectType: string;
  sendWithEnter: boolean;
  suggestionsEnabled: boolean;
  autoSubmitPillSuggestion: boolean;
  reviewModel: string;
  defaultPlanMode: boolean;
  autoConvertLongText: boolean;
  showChatCost: boolean;
  // Appearance settings
  theme: ThemeOption; // App theme (system, light, dark)
  fontSize: FontSize;
  // Git settings
  branchPrefixType: BranchPrefixType;
  branchPrefixCustom: string;
  deleteBranchOnArchive: boolean;
  archiveOnMerge: boolean;
  // Claude Code settings
  autoApproveSafeCommands: boolean;
  // Account settings
  strictPrivacy: boolean;
  // UI state
  collapsedWorkspaces: string[]; // Workspace IDs that are collapsed (all others are expanded)
  unreadWorkspaces: string[]; // Workspace IDs marked as unread
  unreadSessions: string[]; // Session IDs with unread agent completions
  showBottomTerminal: boolean;
  zenMode: boolean; // Distraction-free mode that hides sidebars
  hiddenBottomTabs: BottomPanelTab[]; // Bottom panel tabs that are hidden (Tasks always visible)
  bottomTabOrder: AllBottomPanelTab[]; // Order of bottom panel tabs
  topTabOrder: AllTopPanelTab[]; // Order of top panel tabs
  // Full Content Area view state (not persisted - always starts in conversation view)
  contentView: ContentView;
  // Panel layouts (persisted)
  layoutOuter: PanelLayout | undefined;
  layoutInner: PanelLayout | undefined;
  layoutVertical: PanelLayout | undefined;
  layoutChanges: PanelLayout | undefined;

  // Command palette recent commands (last 5 used)
  recentCommands: string[];

  // Recently removed workspaces (last 5, for quick re-add)
  recentlyRemovedWorkspaces: { name: string; path: string }[];

  // Custom workspace colors (workspaceId -> hex color)
  workspaceColors: Record<string, string>;

  // Default "Open in" app ID (persisted user preference)
  defaultOpenApp: string;

  // Onboarding state
  hasCompletedOnboarding: boolean;
  hasCompletedGuidedTour: boolean;

  // Sidebar grouping/sorting
  sidebarGroupBy: SidebarGroupBy;
  sidebarSortBy: SidebarSortBy;
  collapsedSidebarGroups: string[]; // composite keys toggled from default, e.g. "status:done"

  // Last selected workspace for PR/Branches dashboard views (shared between both)
  lastRepoDashboardWorkspaceId: string | null;

  // Actions
  setConfirmCloseActiveTab: (value: boolean) => void;
  setConfirmArchiveDirtySession: (value: boolean) => void;
  setDefaultModel: (value: string) => void;
  setDefaultThinkingLevel: (value: ThinkingLevel) => void;
  setMaxThinkingTokens: (value: number) => void;
  setShowThinkingBlocks: (value: boolean) => void;
  toggleShowThinkingBlocks: () => void;
  setShowTokenUsage: (value: boolean) => void;
  setDesktopNotifications: (value: boolean) => void;
  setSoundEffects: (value: boolean) => void;
  setSoundEffectType: (value: string) => void;
  setSendWithEnter: (value: boolean) => void;
  setSuggestionsEnabled: (value: boolean) => void;
  setAutoSubmitPillSuggestion: (value: boolean) => void;
  setReviewModel: (value: string) => void;
  setDefaultPlanMode: (value: boolean) => void;
  setAutoConvertLongText: (value: boolean) => void;
  setShowChatCost: (value: boolean) => void;
  setTheme: (value: ThemeOption) => void;
  setFontSize: (value: FontSize) => void;
  setBranchPrefixType: (value: BranchPrefixType) => void;
  setBranchPrefixCustom: (value: string) => void;
  setDeleteBranchOnArchive: (value: boolean) => void;
  setArchiveOnMerge: (value: boolean) => void;
  setAutoApproveSafeCommands: (value: boolean) => void;
  setStrictPrivacy: (value: boolean) => void;
  setShowBottomTerminal: (value: boolean) => void;
  setZenMode: (value: boolean) => void;
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  expandWorkspace: (workspaceId: string) => void;
  markWorkspaceUnread: (workspaceId: string) => void;
  markWorkspaceRead: (workspaceId: string) => void;
  markSessionUnread: (sessionId: string) => void;
  markSessionRead: (sessionId: string) => void;
  toggleBottomTab: (tab: BottomPanelTab) => void;
  setBottomTabOrder: (order: AllBottomPanelTab[]) => void;
  setTopTabOrder: (order: AllTopPanelTab[]) => void;
  setContentView: (view: ContentView) => void;
  setLayoutOuter: (layout: PanelLayout) => void;
  setLayoutInner: (layout: PanelLayout) => void;
  setLayoutVertical: (layout: PanelLayout) => void;
  setLayoutChanges: (layout: PanelLayout) => void;
  resetLayouts: () => void;
  addRecentCommand: (commandId: string) => void;
  addRecentlyRemovedWorkspace: (workspace: { name: string; path: string }) => void;
  removeRecentlyRemovedWorkspace: (path: string) => void;
  setWorkspaceColor: (workspaceId: string, color: string) => void;
  clearWorkspaceColor: (workspaceId: string) => void;
  setDefaultOpenApp: (appId: string) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  setHasCompletedGuidedTour: (value: boolean) => void;
  resetOnboarding: () => void;
  setSidebarGroupBy: (value: SidebarGroupBy) => void;
  setSidebarSortBy: (value: SidebarSortBy) => void;
  toggleSidebarGroupCollapsed: (key: string) => void;
  setLastRepoDashboardWorkspaceId: (id: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      confirmCloseActiveTab: true,
      confirmArchiveDirtySession: true,
      defaultModel: 'claude-opus-4-6',
      defaultThinkingLevel: 'high' as ThinkingLevel,
      maxThinkingTokens: 16000,
      showThinkingBlocks: true,
      showTokenUsage: true,
      desktopNotifications: true,
      soundEffects: false,
      soundEffectType: 'chime',
      sendWithEnter: true,
      suggestionsEnabled: true,
      autoSubmitPillSuggestion: false,
      reviewModel: 'claude-opus-4-6',
      defaultPlanMode: false,
      autoConvertLongText: true,
      showChatCost: true,
      theme: 'system',
      fontSize: 'medium',
      branchPrefixType: 'github',
      branchPrefixCustom: '',
      deleteBranchOnArchive: false,
      archiveOnMerge: false,
      autoApproveSafeCommands: true,
      strictPrivacy: false,
      collapsedWorkspaces: [], // Workspace IDs that are collapsed (all others expanded by default)
      unreadWorkspaces: [], // Workspace IDs marked as unread
      unreadSessions: [], // Session IDs with unread agent completions
      showBottomTerminal: false,
      zenMode: false,
      hiddenBottomTabs: [], // All tabs visible by default
      bottomTabOrder: DEFAULT_BOTTOM_TAB_ORDER, // Default tab order
      topTabOrder: DEFAULT_TOP_TAB_ORDER, // Default top tab order
      contentView: { type: 'conversation' }, // Always start in conversation view
      layoutOuter: undefined, // Use defaults until user resizes
      layoutInner: undefined,
      layoutVertical: undefined,
      layoutChanges: undefined,
      recentCommands: [], // Last 5 used command IDs
      recentlyRemovedWorkspaces: [], // Last 5 removed workspaces for quick re-add
      workspaceColors: {}, // Custom workspace colors
      defaultOpenApp: 'vscode', // Default to VS Code
      hasCompletedOnboarding: false,
      hasCompletedGuidedTour: false,
      sidebarGroupBy: 'project', // Default: group by project
      sidebarSortBy: 'recent', // Default: sort by recency
      collapsedSidebarGroups: [], // Keys toggled from default state
      lastRepoDashboardWorkspaceId: null, // Last workspace selected in PR/Branches views

      // Actions
      setConfirmCloseActiveTab: (value) => set({ confirmCloseActiveTab: value }),
      setConfirmArchiveDirtySession: (value) => set({ confirmArchiveDirtySession: value }),
      setDefaultModel: (value) => set({ defaultModel: value }),
      setDefaultThinkingLevel: (value) => set({ defaultThinkingLevel: value }),
      setMaxThinkingTokens: (value) => set({ maxThinkingTokens: value }),
      setShowThinkingBlocks: (value) => set({ showThinkingBlocks: value }),
      toggleShowThinkingBlocks: () => set((state) => ({ showThinkingBlocks: !state.showThinkingBlocks })),
      setShowTokenUsage: (value) => set({ showTokenUsage: value }),
      setDesktopNotifications: (value) => set({ desktopNotifications: value }),
      setSoundEffects: (value) => set({ soundEffects: value }),
      setSoundEffectType: (value) => set({ soundEffectType: value }),
      setSendWithEnter: (value) => set({ sendWithEnter: value }),
      setSuggestionsEnabled: (value) => set({ suggestionsEnabled: value }),
      setAutoSubmitPillSuggestion: (value) => set({ autoSubmitPillSuggestion: value }),
      setReviewModel: (value) => set({ reviewModel: value }),
      setDefaultPlanMode: (value) => set({ defaultPlanMode: value }),
      setAutoConvertLongText: (value) => set({ autoConvertLongText: value }),
      setShowChatCost: (value) => set({ showChatCost: value }),
      setTheme: (value) => set({ theme: value }),
      setFontSize: (value) => set({ fontSize: value }),
      setBranchPrefixType: (value) => set({ branchPrefixType: value }),
      setBranchPrefixCustom: (value) => set({ branchPrefixCustom: value }),
      setDeleteBranchOnArchive: (value) => set({ deleteBranchOnArchive: value }),
      setArchiveOnMerge: (value) => set({ archiveOnMerge: value }),
      setAutoApproveSafeCommands: (value) => set({ autoApproveSafeCommands: value }),
      setStrictPrivacy: (value) => set({ strictPrivacy: value }),
      setShowBottomTerminal: (value) => set({ showBottomTerminal: value }),
      setZenMode: (value) => set({ zenMode: value }),
      toggleWorkspaceCollapsed: (workspaceId) =>
        set((state) => {
          const isCollapsed = state.collapsedWorkspaces.includes(workspaceId);
          return {
            collapsedWorkspaces: isCollapsed
              ? state.collapsedWorkspaces.filter((id) => id !== workspaceId)
              : [...state.collapsedWorkspaces, workspaceId],
            // Auto-clear unread when expanding a workspace
            ...(isCollapsed && {
              unreadWorkspaces: state.unreadWorkspaces.filter((id) => id !== workspaceId),
            }),
          };
        }),
      expandWorkspace: (workspaceId) =>
        set((state) => ({
          collapsedWorkspaces: state.collapsedWorkspaces.filter((id) => id !== workspaceId),
          unreadWorkspaces: state.unreadWorkspaces.filter((id) => id !== workspaceId),
        })),
      markWorkspaceUnread: (workspaceId) =>
        set((state) => ({
          unreadWorkspaces: state.unreadWorkspaces.includes(workspaceId)
            ? state.unreadWorkspaces
            : [...state.unreadWorkspaces, workspaceId],
        })),
      markWorkspaceRead: (workspaceId) =>
        set((state) => ({
          unreadWorkspaces: state.unreadWorkspaces.filter((id) => id !== workspaceId),
        })),
      markSessionUnread: (sessionId) =>
        set((state) => ({
          unreadSessions: state.unreadSessions.includes(sessionId)
            ? state.unreadSessions
            : [...state.unreadSessions, sessionId],
        })),
      markSessionRead: (sessionId) =>
        set((state) => ({
          unreadSessions: state.unreadSessions.filter((id) => id !== sessionId),
        })),
      toggleBottomTab: (tab) =>
        set((state) => ({
          hiddenBottomTabs: state.hiddenBottomTabs.includes(tab)
            ? state.hiddenBottomTabs.filter((t) => t !== tab)
            : [...state.hiddenBottomTabs, tab],
        })),
      setBottomTabOrder: (order) => set({ bottomTabOrder: order }),
      setTopTabOrder: (order) => set({ topTabOrder: order }),
      setContentView: (view) => set({ contentView: view }),
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
      addRecentCommand: (commandId) =>
        set((state) => {
          const filtered = state.recentCommands.filter((id) => id !== commandId);
          return { recentCommands: [commandId, ...filtered].slice(0, 5) };
        }),
      addRecentlyRemovedWorkspace: (workspace) =>
        set((state) => {
          const filtered = state.recentlyRemovedWorkspaces.filter((w) => w.path !== workspace.path);
          return { recentlyRemovedWorkspaces: [workspace, ...filtered].slice(0, 5) };
        }),
      removeRecentlyRemovedWorkspace: (path) =>
        set((state) => ({
          recentlyRemovedWorkspaces: state.recentlyRemovedWorkspaces.filter((w) => w.path !== path),
        })),
      setWorkspaceColor: (workspaceId, color) =>
        set((state) => ({
          workspaceColors: { ...state.workspaceColors, [workspaceId]: color },
        })),
      clearWorkspaceColor: (workspaceId) =>
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [workspaceId]: _, ...rest } = state.workspaceColors;
          return { workspaceColors: rest };
        }),
      setDefaultOpenApp: (appId) => set({ defaultOpenApp: appId }),
      setHasCompletedOnboarding: (value) => set({ hasCompletedOnboarding: value }),
      setHasCompletedGuidedTour: (value) => set({ hasCompletedGuidedTour: value }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false, hasCompletedGuidedTour: false }),
      setSidebarGroupBy: (value) => set({ sidebarGroupBy: value }),
      setSidebarSortBy: (value) => set({ sidebarSortBy: value }),
      setLastRepoDashboardWorkspaceId: (id) => set({ lastRepoDashboardWorkspaceId: id }),
      toggleSidebarGroupCollapsed: (key) =>
        set((state) => {
          const has = state.collapsedSidebarGroups.includes(key);
          return {
            collapsedSidebarGroups: has
              ? state.collapsedSidebarGroups.filter((k) => k !== key)
              : [...state.collapsedSidebarGroups, key],
          };
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

        // Migrate old thinking settings → unified ThinkingLevel
        const oldState = persistedState as Record<string, unknown>;
        if ('defaultThinking' in oldState && !('defaultThinkingLevel' in oldState)) {
          const wasOn = oldState.defaultThinking as boolean;
          const oldEffort = (oldState.defaultEffort as string) || 'high';
          merged.defaultThinkingLevel = (wasOn ? oldEffort : 'off') as ThinkingLevel;
        }

        // Ensure bottomTabOrder includes all tabs from DEFAULT_BOTTOM_TAB_ORDER
        // and remove any tabs that no longer exist in the defaults
        if (persisted.bottomTabOrder) {
          const existingOrder = persisted.bottomTabOrder.filter(
            (tab) => DEFAULT_BOTTOM_TAB_ORDER.includes(tab)
          );
          const missingTabs = DEFAULT_BOTTOM_TAB_ORDER.filter(
            (tab) => !existingOrder.includes(tab)
          );
          merged.bottomTabOrder = [...existingOrder, ...missingTabs];
        }

        // Ensure topTabOrder includes all tabs from DEFAULT_TOP_TAB_ORDER
        // and remove any tabs that no longer exist in the defaults
        if (persisted.topTabOrder) {
          const existingOrder = persisted.topTabOrder.filter(
            (tab) => DEFAULT_TOP_TAB_ORDER.includes(tab)
          );
          const missingTabs = DEFAULT_TOP_TAB_ORDER.filter(
            (tab) => !existingOrder.includes(tab)
          );
          merged.topTabOrder = [...existingOrder, ...missingTabs];
        }

        // Clean up legacy hiddenTopTabs from persisted state
        if ('hiddenTopTabs' in merged) {
          delete (merged as Record<string, unknown>).hiddenTopTabs;
        }
        if (persisted.hiddenBottomTabs) {
          const validBottomTabs = DEFAULT_BOTTOM_TAB_ORDER.filter((t) => t !== 'todos');
          merged.hiddenBottomTabs = persisted.hiddenBottomTabs.filter((t) => validBottomTabs.includes(t));
        }

        // Clear poisoned vertical layout (terminal collapsed state shouldn't be persisted)
        if (persisted.layoutVertical && persisted.layoutVertical['bottom-terminal'] === 0) {
          merged.layoutVertical = undefined;
        }

        return merged;
      },
    }
  )
);

/**
 * Get the computed branch prefix string based on current settings.
 * Returns undefined if no prefix should be applied (uses backend default).
 */
export function getBranchPrefix(): string | undefined {
  const { branchPrefixType, branchPrefixCustom } = useSettingsStore.getState();
  switch (branchPrefixType) {
    case 'custom':
      return branchPrefixCustom.trim() || undefined;
    case 'none':
      return '';
    case 'github':
    default: {
      const login = useAuthStore.getState().user?.login;
      return login || undefined;
    }
  }
}

/**
 * Get branch prefix for a specific workspace, falling back to global setting.
 * If the workspace has its own branchPrefix setting, use that; otherwise use global.
 */
export function getWorkspaceBranchPrefix(workspace: Workspace): string | undefined {
  if (!workspace.branchPrefix) {
    // Empty string = "use global default"
    return getBranchPrefix();
  }
  switch (workspace.branchPrefix) {
    case 'custom':
      return workspace.customPrefix?.trim() || undefined;
    case 'none':
      return '';
    case 'github':
    default: {
      const login = useAuthStore.getState().user?.login;
      return login || undefined;
    }
  }
}
