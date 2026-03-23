import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace } from '@/lib/types';
import { useAuthStore } from '@/stores/authStore';
import type { ThinkingLevel } from '@/lib/thinkingLevels';

// Bottom panel tab IDs that can be toggled (Tasks is always visible)
// TODO: Re-add 'scripts' to BottomPanelTab when the Scripts feature is reintroduced (see ScriptsPanel.tsx)
export type BottomPanelTab = 'budget' | 'mcp' | 'file-history';

// All bottom panel tabs including the always-visible Tasks
export type AllBottomPanelTab = 'todos' | BottomPanelTab;

// Default tab order
export const DEFAULT_BOTTOM_TAB_ORDER: AllBottomPanelTab[] = ['todos', 'file-history', 'budget', 'mcp'];

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

// Dictation shortcut presets
export type DictationShortcutPreset = 'capslock' | 'cmd-shift-d' | 'custom';

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

// Exported defaults for user-facing settings (used by reset functionality)
// Excludes UI state, onboarding flags, and theme (handled by next-themes)
export const SETTINGS_DEFAULTS = {
  // General
  confirmCloseActiveTab: true,
  confirmArchiveDirtySession: true,
  desktopNotifications: true,
  soundEffects: true,
  soundEffectType: 'chime',
  sendWithEnter: true,
  suggestionsEnabled: true,
  autoSubmitPillSuggestion: false,
  autoConvertLongText: true,
  defaultOpenApp: 'vscode',
  // Appearance (theme excluded — uses next-themes)
  fontSize: 'medium' as FontSize,
  showTokenUsage: true,
  showChatCost: true,
  showMessageTokenCost: false,
  autoExpandEditDiffs: true,
  zenMode: false,
  // AI & Models
  defaultModel: 'claude-sonnet-4-6',
  defaultThinkingLevel: 'high' as ThinkingLevel,
  maxThinkingTokens: 16000,
  showThinkingBlocks: true,
  reviewModel: 'claude-haiku-4-5-20251001',
  reviewActionableOnly: false,
  defaultPlanMode: false,
  defaultFastMode: false,
  // Git
  branchPrefixType: 'github' as BranchPrefixType,
  branchPrefixCustom: '',
  branchSyncBanner: false,
  deleteBranchOnArchive: false,
  archiveOnMerge: false,
  // Security
  neverLoadDotMcp: false,
  defaultPermissionMode: 'bypassPermissions' as const,
  // Account
  strictPrivacy: false,
  // Sidebar
  sidebarGroupBy: 'project' as SidebarGroupBy,
  sidebarSortBy: 'recent' as SidebarSortBy,
  sidebarShowSessionMeta: true,
  // Dictation
  dictationShortcut: 'cmd-shift-d' as DictationShortcutPreset,
  dictationCustomShortcut: '',
};

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
  reviewActionableOnly: boolean; // Only include actionable feedback (errors/warnings/suggestions) in code reviews
  defaultPlanMode: boolean;
  defaultFastMode: boolean;
  autoConvertLongText: boolean;
  showChatCost: boolean;
  showMessageTokenCost: boolean; // Whether to show compact token/cost footer below each assistant message
  autoExpandEditDiffs: boolean; // Whether to auto-expand Edit tool blocks to show diffs inline
  // Appearance settings
  theme: ThemeOption; // App theme (system, light, dark)
  fontSize: FontSize;
  // Git settings
  branchSyncBanner: boolean;
  branchPrefixType: BranchPrefixType;
  branchPrefixCustom: string;
  deleteBranchOnArchive: boolean;
  archiveOnMerge: boolean;
  // Security settings
  neverLoadDotMcp: boolean;
  defaultPermissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';
  // Account settings
  strictPrivacy: boolean;
  // Dictation
  dictationShortcut: DictationShortcutPreset;
  dictationCustomShortcut: string;
  // UI state
  collapsedWorkspaces: string[]; // Workspace IDs that are collapsed (all others are expanded)
  unreadWorkspaces: string[]; // Workspace IDs marked as unread
  unreadSessions: string[]; // Session IDs with unread agent completions
  zenMode: boolean; // Distraction-free mode that hides sidebars
  sidebarBottomPanelMinimized: boolean; // Whether the sidebar bottom panel (Tasks/History/etc) is minimized
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
  sidebarShowSessionMeta: boolean; // Whether to show the second line (PR status) in session cells
  collapsedSidebarGroups: string[]; // composite keys toggled from default, e.g. "status:done"
  workspaceOrder: string[]; // Persisted workspace display order (array of workspace IDs)

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
  setReviewActionableOnly: (value: boolean) => void;
  setDefaultPlanMode: (value: boolean) => void;
  setDefaultFastMode: (value: boolean) => void;
  setAutoConvertLongText: (value: boolean) => void;
  setShowChatCost: (value: boolean) => void;
  setShowMessageTokenCost: (value: boolean) => void;
  setAutoExpandEditDiffs: (value: boolean) => void;
  setTheme: (value: ThemeOption) => void;
  setFontSize: (value: FontSize) => void;
  setBranchSyncBanner: (value: boolean) => void;
  setBranchPrefixType: (value: BranchPrefixType) => void;
  setBranchPrefixCustom: (value: string) => void;
  setDeleteBranchOnArchive: (value: boolean) => void;
  setArchiveOnMerge: (value: boolean) => void;
  setNeverLoadDotMcp: (value: boolean) => void;
  setDefaultPermissionMode: (value: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk') => void;
  setStrictPrivacy: (value: boolean) => void;
  setZenMode: (value: boolean) => void;
  setSidebarBottomPanelMinimized: (value: boolean) => void;
  toggleSidebarBottomPanel: () => void;
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
  setDictationShortcut: (value: DictationShortcutPreset) => void;
  setDictationCustomShortcut: (value: string) => void;
  setHasCompletedOnboarding: (value: boolean) => void;
  setHasCompletedGuidedTour: (value: boolean) => void;
  resetOnboarding: () => void;
  resetAllSettings: () => void;
  setSidebarGroupBy: (value: SidebarGroupBy) => void;
  setSidebarSortBy: (value: SidebarSortBy) => void;
  setSidebarShowSessionMeta: (value: boolean) => void;
  toggleSidebarGroupCollapsed: (key: string) => void;
  ensureSidebarGroupExpanded: (key: string, defaultCollapsed: boolean) => void;
  setLastRepoDashboardWorkspaceId: (id: string | null) => void;
  setWorkspaceOrder: (order: string[]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // User-facing setting defaults (spread from shared constant)
      ...SETTINGS_DEFAULTS,
      theme: 'system' as ThemeOption, // Theme is in store but AppearanceSettings uses next-themes
      collapsedWorkspaces: [], // Workspace IDs that are collapsed (all others expanded by default)
      unreadWorkspaces: [], // Workspace IDs marked as unread
      unreadSessions: [], // Session IDs with unread agent completions
      zenMode: false,
      sidebarBottomPanelMinimized: false,
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
      workspaceOrder: [], // Empty = use natural backend order until user first reorders
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
      setReviewActionableOnly: (value) => set({ reviewActionableOnly: value }),
      setDefaultPlanMode: (value) => set({ defaultPlanMode: value }),
      setDefaultFastMode: (value) => set({ defaultFastMode: value }),
      setAutoConvertLongText: (value) => set({ autoConvertLongText: value }),
      setShowChatCost: (value) => set({ showChatCost: value }),
      setShowMessageTokenCost: (value) => set({ showMessageTokenCost: value }),
      setAutoExpandEditDiffs: (value) => set({ autoExpandEditDiffs: value }),
      setTheme: (value) => set({ theme: value }),
      setFontSize: (value) => set({ fontSize: value }),
      setBranchSyncBanner: (value) => set({ branchSyncBanner: value }),
      setBranchPrefixType: (value) => set({ branchPrefixType: value }),
      setBranchPrefixCustom: (value) => set({ branchPrefixCustom: value }),
      setDeleteBranchOnArchive: (value) => set({ deleteBranchOnArchive: value }),
      setArchiveOnMerge: (value) => set({ archiveOnMerge: value }),
      setDefaultPermissionMode: (value: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk') =>
        set({ defaultPermissionMode: value }),
      setNeverLoadDotMcp: (value) => {
        set({ neverLoadDotMcp: value });
        // Sync to backend so agent manager respects the global kill switch
        import('@/lib/api').then(({ setNeverLoadDotMcp }) => {
          setNeverLoadDotMcp(value).catch(() => {});
        });
      },
      setStrictPrivacy: (value) => {
        set({ strictPrivacy: value });
        // Track when strict privacy is disabled (only fires if telemetry is now enabled)
        if (!value) {
          import('@/lib/telemetry').then(({ trackEvent }) => {
            trackEvent('strict_privacy_disabled');
          });
        }
      },
      setZenMode: (value) => set({ zenMode: value }),
      setSidebarBottomPanelMinimized: (value) => set({ sidebarBottomPanelMinimized: value }),
      toggleSidebarBottomPanel: () => set((state) => ({ sidebarBottomPanelMinimized: !state.sidebarBottomPanelMinimized })),
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
      setDictationShortcut: (value) => set({ dictationShortcut: value }),
      setDictationCustomShortcut: (value) => set({ dictationCustomShortcut: value }),
      setHasCompletedOnboarding: (value) => set({ hasCompletedOnboarding: value }),
      setHasCompletedGuidedTour: (value) => set({ hasCompletedGuidedTour: value }),
      resetOnboarding: () => set({ hasCompletedOnboarding: false, hasCompletedGuidedTour: false }),
      resetAllSettings: () => set({ ...SETTINGS_DEFAULTS }),
      setSidebarGroupBy: (value) => set({ sidebarGroupBy: value }),
      setSidebarSortBy: (value) => set({ sidebarSortBy: value }),
      setSidebarShowSessionMeta: (value) => set({ sidebarShowSessionMeta: value }),
      setLastRepoDashboardWorkspaceId: (id) => set({ lastRepoDashboardWorkspaceId: id }),
      setWorkspaceOrder: (order) => set({ workspaceOrder: order }),
      toggleSidebarGroupCollapsed: (key) =>
        set((state) => {
          const has = state.collapsedSidebarGroups.includes(key);
          return {
            collapsedSidebarGroups: has
              ? state.collapsedSidebarGroups.filter((k) => k !== key)
              : [...state.collapsedSidebarGroups, key],
          };
        }),
      // Same toggle-from-default logic as isSidebarGroupExpanded() in useSidebarSessions.ts
      ensureSidebarGroupExpanded: (key, defaultCollapsed) =>
        set((state) => {
          const isToggled = state.collapsedSidebarGroups.includes(key);
          const isExpanded = defaultCollapsed ? isToggled : !isToggled;
          if (isExpanded) return state;
          return {
            collapsedSidebarGroups: isToggled
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

        // Always strip bottom-terminal from persisted vertical layout.
        // Terminal panel visibility is managed by appStore (in-memory, per-session)
        // and must always start collapsed on app restart.
        if (merged.layoutVertical && 'bottom-terminal' in merged.layoutVertical) {
          const { 'bottom-terminal': _, ...rest } = merged.layoutVertical;
          merged.layoutVertical = Object.keys(rest).length > 0 ? rest : undefined;
        }

        // Migrate legacy 'auto' model to concrete model ID
        if (merged.defaultModel === 'auto') {
          merged.defaultModel = 'claude-sonnet-4-6';
        }
        if (merged.reviewModel === 'auto') {
          merged.reviewModel = 'claude-haiku-4-5-20251001';
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

/**
 * Apply persisted workspace order to a list of workspaces.
 * Workspaces in `order` appear first (in that order), followed by any new workspaces
 * not yet in the persisted order. Stale IDs in `order` are silently skipped.
 * Returns null if no custom order has been set (order is empty).
 */
export function applyWorkspaceOrder<T extends { id: string }>(
  workspaces: T[],
  order: string[],
): T[] | null {
  if (order.length === 0) return null;
  const wsMap = new Map(workspaces.map((w) => [w.id, w]));
  const ordered: T[] = [];
  for (const id of order) {
    const ws = wsMap.get(id);
    if (ws) {
      ordered.push(ws);
      wsMap.delete(id);
    }
  }
  for (const ws of workspaces) {
    if (wsMap.has(ws.id)) {
      ordered.push(ws);
    }
  }
  return ordered;
}
