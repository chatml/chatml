'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTheme } from 'next-themes';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import {
  useWorkspaceSelection,
  useConversationState,
  useFileTabState,
  usePageActions,
  useMessages,
} from '@/stores/selectors';
import { useSettingsStore, getBranchPrefix, getWorkspaceBranchPrefix } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { ENABLE_BROWSER_TABS } from '@/lib/constants';
import { useTabStore } from '@/stores/tabStore';
import { switchToTab, createAndSwitchToNewTab } from '@/components/navigation/BrowserTabBar';
import { useNavigationStore } from '@/stores/navigationStore';
import { useUpdateStore } from '@/stores/updateStore';
import { useAuthStore } from '@/stores/authStore';
import { useBranchCacheStore } from '@/stores/branchCacheStore';
import { OnboardingScreen } from '@/components/shared/OnboardingScreen';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { GuidedTour } from '@/components/onboarding/GuidedTour';
import { useOnboarding } from '@/hooks/useOnboarding';
import { refreshClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';
import { initAuth, listenForOAuthCallback, validateStoredToken, OAUTH_TIMEOUT_MS } from '@/lib/auth';
import { getLinearAuthStatus } from '@/lib/linearAuth';
import { useLinearAuthStore } from '@/stores/linearAuthStore';
import { safeListen, closeWindow, openFolderDialog, openInVSCode, copyToClipboard, openUrlInBrowser, getCurrentWindow, registerSession, getSessionDirName, setOnboardingWindowSize, restoreDefaultWindowSize } from '@/lib/tauri';
import { CloseTabConfirmDialog } from '@/components/dialogs/CloseTabConfirmDialog';
import { CloseFileConfirmDialog } from '@/components/dialogs/CloseFileConfirmDialog';
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTabPersistence } from '@/hooks/useTabPersistence';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { useExternalLinkGuard } from '@/hooks/useExternalLinkGuard';
import { useDesktopNotifications } from '@/hooks/useDesktopNotifications';
import { useFontSize } from '@/hooks/useFontSize';
import { useReviewTrigger } from '@/hooks/useReviewTrigger';
import { useMenuState } from '@/hooks/useMenuState';
import { useShortcut } from '@/hooks/useShortcut';
import { getDashboardData, listConversations, createSession, createConversation, deleteConversation, addRepo, mapSessionDTO, getConversationMessages, toStoreMessage, type RepoDTO, type ConversationDTO, type MessageDTO } from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
import { WorkspaceSidebar } from '@/components/navigation/WorkspaceSidebar';
import { WorkspaceSettings } from '@/components/settings/WorkspaceSettings';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { SessionToolbarContent } from '@/components/navigation/SessionToolbarContent';
import { ConversationArea } from '@/components/conversation/ConversationArea';
import { ChatInput } from '@/components/conversation/ChatInput';
import { ChangesPanel } from '@/components/panels/ChangesPanel';
import { BottomTerminal } from '@/components/layout/BottomTerminal';
import { MainToolbar, ContentActionBar } from '@/components/layout/MainToolbar';
import { SidebarToolbar } from '@/components/layout/SidebarToolbar';
import { AddWorkspaceModal } from '@/components/dialogs/AddWorkspaceModal';
import { CreateFromPRModal } from '@/components/dialogs/CreateFromPRModal';
import { CloneFromUrlDialog } from '@/components/dialogs/CloneFromUrlDialog';
import { QuickStartDialog } from '@/components/dialogs/QuickStartDialog';
import { FilePicker } from '@/components/dialogs/FilePicker';
import { WorkspaceSearch } from '@/components/dialogs/WorkspaceSearch';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
import { BackendStatus } from '@/components/shared/BackendStatus';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { PRDashboard } from '@/components/dashboards/PRDashboard';
import { BranchesDashboard } from '@/components/dashboards/BranchesDashboard';
import { RepositoriesDashboard } from '@/components/dashboards/RepositoriesDashboard';
import { SessionManager } from '@/components/session-manager';
import { SkillsStore } from '@/components/skills/SkillsStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { StreamingWarningHandler } from '@/components/shared/StreamingWarningHandler';
import { ConnectionStatusHandler } from '@/components/shared/ConnectionStatusHandler';
import { ConnectionBanner } from '@/components/shared/ConnectionBanner';
import { HEALTH_CHECK_MAX_RETRIES, HEALTH_CHECK_INITIAL_DELAY_MS } from '@/lib/constants';
import { EmptyView } from '@/components/shared/EmptyView';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type PanelImperativeHandle,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

// Pre-computed skeleton widths (avoids Math.random() during render)
const SKELETON_WIDTHS = [72, 88, 65, 81];

// Loading skeleton for conversation area
function ConversationSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading conversations">
      {/* Skeleton TopBar */}
      <div className="h-10 border-b flex items-center px-3 gap-2">
        <div className="h-5 w-5 bg-muted-foreground/20 rounded animate-pulse" />
        <div className="h-4 w-32 bg-muted-foreground/20 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-6 w-16 bg-muted-foreground/20 rounded animate-pulse" />
      </div>

      {/* Skeleton messages area */}
      <div className="flex-1 overflow-hidden p-4 space-y-4">
        {/* System message skeleton */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-muted-foreground/20 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="h-16 w-full bg-muted-foreground/10 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* User message skeleton */}
        <div className="flex gap-3 justify-end">
          <div className="flex-1 max-w-[80%] space-y-2">
            <div className="h-3 w-16 bg-muted-foreground/20 rounded animate-pulse ml-auto" />
            <div className="h-12 w-full bg-primary/10 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* Assistant message skeleton */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-muted-foreground/20 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-20 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="space-y-1.5">
              {SKELETON_WIDTHS.map((width, i) => (
                <div
                  key={i}
                  className="h-4 bg-muted-foreground/10 rounded animate-pulse"
                  style={{ width: `${width}%`, animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Loading indicator */}
        <div className="flex items-center justify-center py-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading workspace data...</span>
          </div>
        </div>
      </div>

      {/* Skeleton input area */}
      <div className="px-4 pb-4">
        <div className="h-28 rounded-lg border bg-muted/50 animate-pulse" />
      </div>
    </div>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [backendConnected, setBackendConnected] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // Prevent hydration mismatch - render nothing until client-side mounted
  useEffect(() => {
    setMounted(true);
  }, []);

  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showCreateFromPR, setShowCreateFromPR] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialCategory, setSettingsInitialCategory] = useState<string | undefined>(undefined);

  // Listen for open-settings events from other components (e.g. auth error display)
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const sidebarWidthRef = useRef(250); // Tracked via ref — no re-renders on resize
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingCloseConvId, setPendingCloseConvId] = useState<string | null>(null);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Theme from next-themes (resolvedTheme handles 'system' → actual theme)
  const { resolvedTheme, setTheme } = useTheme();

  // Panel refs for imperative collapse/expand
  const leftSidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const rightSidebarPanelRef = useRef<PanelImperativeHandle>(null);

  const leftSidebarDomRef = useRef<HTMLDivElement>(null);

  // Pre-zen mode state for restoration
  const preZenStateRef = useRef({ left: false, right: false });

  // Toggle functions for sidebars
  const toggleLeftSidebar = useCallback(() => {
    const panel = leftSidebarPanelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, []);

  const toggleRightSidebar = useCallback(() => {
    const panel = rightSidebarPanelRef.current;
    if (!panel) return;

    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, []);

  const confirmCloseActiveTab = useSettingsStore((s) => s.confirmCloseActiveTab);
  const contentView = useSettingsStore((s) => s.contentView);
  const { error: showError } = useToast();
  const {
    showBottomTerminal, setShowBottomTerminal,
    zenMode, setZenMode,
    layoutOuter, setLayoutOuter,
    layoutInner, setLayoutInner,
    layoutVertical, setLayoutVertical,
    resetLayouts,
  } = useSettingsStore();

  const toggleBottomTerminal = useCallback(() => {
    setShowBottomTerminal(!showBottomTerminal);
  }, [showBottomTerminal, setShowBottomTerminal]);

  const hideBottomTerminal = useCallback(() => {
    setShowBottomTerminal(false);
  }, [setShowBottomTerminal]);

  // Determine if we're in a Full Content view (not conversation)
  // Also treat as full content view when no session is selected (to show welcome screen)
  const isFullContentView = contentView.type !== 'conversation';

  const {
    isLoading: authLoading,
    isAuthenticated,
    oauthState,
    setAuthenticated,
    completeOAuth,
    failOAuth,
  } = useAuthStore();

  const {
    setAuthenticated: setLinearAuthenticated,
    completeOAuth: completeLinearOAuth,
    failOAuth: failLinearOAuth,
  } = useLinearAuthStore();

  // Initialize auth on mount
  useEffect(() => {
    let unlistenOAuth: (() => void) | null = null;

    const init = async () => {
      // Set up OAuth callback listener first
      try {
        console.log('[OAuth] page.tsx: Setting up callback listener...');
        unlistenOAuth = await listenForOAuthCallback(
          // GitHub callbacks
          (result) => {
            console.log('[OAuth] page.tsx: GitHub success, user:', result.user?.login);
            completeOAuth();
            setAuthenticated(true, result.user);
          },
          (error) => {
            console.log('[OAuth] page.tsx: GitHub error:', error.message);
            failOAuth(error.message);
          },
          // Linear callbacks
          (result) => {
            console.log('[OAuth] page.tsx: Linear success, user:', result.user?.displayName);
            completeLinearOAuth();
            setLinearAuthenticated(true, result.user);
          },
          (error) => {
            console.log('[OAuth] page.tsx: Linear error:', error.message);
            failLinearOAuth(error.message);
          },
        );
        console.log('[OAuth] page.tsx: Callback listener ready');
      } catch (e) {
        // Listener setup failed (not in Tauri), continue anyway
        console.log('[OAuth] page.tsx: Listener setup failed (expected in browser):', e);
      }

      // Check for existing auth
      try {
        console.log('[Auth] page.tsx: Calling initAuth...');
        const status = await initAuth();
        console.log('[Auth] page.tsx: initAuth returned:', status.authenticated);
        setAuthenticated(status.authenticated, status.user);
        console.log('[Auth] page.tsx: setAuthenticated called');
      } catch (e) {
        console.error('[Auth] page.tsx: initAuth failed:', e);
        setAuthenticated(false);
      }
    };

    init();

    return () => {
      if (unlistenOAuth) unlistenOAuth();
    };
  }, [setAuthenticated, completeOAuth, failOAuth, setLinearAuthenticated, completeLinearOAuth, failLinearOAuth]);

  // OAuth timeout - fail if pending for too long
  useEffect(() => {
    if (oauthState !== 'pending') return;

    const timeoutId = setTimeout(() => {
      failOAuth('Authentication timed out. Please try again.');
    }, OAUTH_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [oauthState, failOAuth]);

  // Validate token with backend after connection is established
  useEffect(() => {
    if (!backendConnected || !isAuthenticated) return;

    const validate = async () => {
      const user = await validateStoredToken();
      if (user) {
        // Token is valid - update user info
        setAuthenticated(true, user);
      } else {
        // Token is invalid/expired - show onboarding
        setAuthenticated(false);
      }
    };

    validate();
  }, [backendConnected, isAuthenticated, setAuthenticated]);

  // Check Linear auth status after backend connects
  useEffect(() => {
    if (!backendConnected) return;

    const checkLinear = async () => {
      try {
        const status = await getLinearAuthStatus();
        setLinearAuthenticated(status.authenticated, status.user);
      } catch {
        // Non-fatal — Linear auth is optional
      }
    };

    checkLinear();
  }, [backendConnected, setLinearAuthenticated]);

  const zenModeRef = useRef(zenMode);
  useEffect(() => {
    zenModeRef.current = zenMode;
  }, [zenMode]);

  const contentViewRef = useRef(contentView);
  useEffect(() => {
    contentViewRef.current = contentView;
  }, [contentView]);

  // Track previous zen mode state to detect transitions
  const prevZenModeRef = useRef(zenMode);

  // Handle zen mode collapse/expand - only on zen mode TRANSITIONS
  useEffect(() => {
    const wasZenMode = prevZenModeRef.current;
    prevZenModeRef.current = zenMode;

    // Entering zen mode
    if (zenMode && !wasZenMode) {
      // Save current collapsed state before entering zen mode
      preZenStateRef.current = {
        left: leftSidebarCollapsed,
        right: rightSidebarCollapsed,
      };
      // Collapse both sidebars in zen mode
      leftSidebarPanelRef.current?.collapse();
      rightSidebarPanelRef.current?.collapse();
    }
    // Exiting zen mode
    else if (!zenMode && wasZenMode) {
      // Restore pre-zen state when exiting zen mode
      if (!preZenStateRef.current.left) {
        leftSidebarPanelRef.current?.expand();
      }
      if (!preZenStateRef.current.right) {
        rightSidebarPanelRef.current?.expand();
      }
    }
  }, [zenMode, leftSidebarCollapsed, rightSidebarCollapsed]);

  // Track left sidebar width for overlay positioning
  useEffect(() => {
    const el = leftSidebarDomRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      sidebarWidthRef.current = leftSidebarCollapsed ? 0 : el.offsetWidth;
    });
    observer.observe(el);
    sidebarWidthRef.current = leftSidebarCollapsed ? 0 : el.offsetWidth;

    return () => observer.disconnect();
  }, [leftSidebarCollapsed]);

  // Use scoped selectors to avoid full-store re-renders
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();
  const { conversations, selectedConversationId, removeConversation } = useConversationState();
  const {
    fileTabs, closeFileTab,
    pendingCloseFileTabId, setPendingCloseFileTabId,
  } = useFileTabState();
  const {
    setWorkspaces, setSessions, setConversations,
    addSession, addConversation, selectWorkspace, selectSession, selectConversation,
    setMessagePage,
  } = usePageActions();
  const conversationMessages = useMessages(selectedConversationId);
  const selectNextTab = useAppStore((s) => s.selectNextTab);
  const selectPreviousTab = useAppStore((s) => s.selectPreviousTab);

  const { expandWorkspace } = useSettingsStore();
  const { showWizard, showGuidedTour, completeWizard, completeTour, skipAll } = useOnboarding();

  // Centralized window size management for onboarding ↔ app transitions.
  // On first launch the Tauri config starts at the compact onboarding size.
  // For returning users, tauri_plugin_window_state restores their saved size.
  const isInOnboarding = !isAuthenticated || showWizard;
  const onboardingResolved = useRef(false);

  useEffect(() => {
    if (authLoading) return;

    if (!onboardingResolved.current) {
      // First time auth resolved — set initial window state
      onboardingResolved.current = true;
      if (isInOnboarding) {
        setOnboardingWindowSize();
      }
      // If not in onboarding (returning user), do nothing — let window state plugin handle it
      return;
    }

    // Transition: was in onboarding, now past it → restore default window
    if (!isInOnboarding) {
      restoreDefaultWindowSize();
    }
  }, [isInOnboarding, authLoading]);

  // Computed: selected session for terminal and other uses
  const selectedSession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : null;

  // Ref for selectedSessionId to use in event handlers
  const selectedSessionIdRef = useRef(selectedSessionId);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Connect WebSocket for real-time updates (only when backend is connected)
  const { reconnect } = useWebSocket(backendConnected);

  // Listen for /review, /deep-review, /security slash commands
  useReviewTrigger();

  // Keep macOS menu item enabled/disabled state in sync with app state
  useMenuState();

  // Persist file tabs to backend
  useTabPersistence();

  // Auto-save dirty file tabs
  const handleSaveError = useCallback((filePath: string, error: unknown) => {
    const fileName = filePath.split('/').pop() ?? filePath;
    const reason = error instanceof Error ? error.message : 'Unknown error';
    showError(`Failed to save ${fileName}: ${reason}`, 'Auto-save Error');
  }, [showError]);
  const { saveCurrentTab, saveTab } = useAutoSave({ onError: handleSaveError });

  // Watch for external file changes
  useFileWatcher();
  useExternalLinkGuard();
  useDesktopNotifications();
  useFontSize();

  // Keyboard shortcut: Cmd+/ to show shortcuts dialog
  useShortcut('shortcutsDialog', useCallback(() => {
    setShowShortcuts((prev) => !prev);
  }, []));

  // Listen for show-shortcuts event from menu bar
  useEffect(() => {
    const handleShowShortcuts = () => setShowShortcuts(true);
    window.addEventListener('show-shortcuts', handleShowShortcuts);
    return () => window.removeEventListener('show-shortcuts', handleShowShortcuts);
  }, []);

  useShortcut('createFromPR', useCallback(() => {
    setShowCreateFromPR(true);
  }, []));

  // Map backend Repo to frontend Workspace
  const repoToWorkspace = useCallback((repo: RepoDTO) => ({
    id: repo.id,
    name: repo.name,
    path: repo.path,
    defaultBranch: repo.branch,
    remote: repo.remote || 'origin',
    branchPrefix: repo.branchPrefix || '',
    customPrefix: repo.customPrefix || '',
    createdAt: repo.createdAt,
  }), []);

  // mapSessionDTO from api.ts maps backend SessionDTO to frontend WorktreeSession

  // Map backend MessageDTO to frontend Message
  const messageToMessage = useCallback((msg: MessageDTO, conversationId: string) => ({
    id: msg.id,
    conversationId,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    setupInfo: msg.setupInfo,
    runSummary: msg.runSummary,
    timestamp: msg.timestamp,
  }), []);

  // Map backend ConversationDTO to frontend Conversation
  const conversationToConversation = useCallback((conv: ConversationDTO) => ({
    id: conv.id,
    sessionId: conv.sessionId,
    type: conv.type,
    name: conv.name,
    // Reset 'active' status to 'idle' on load - no agent is running when app starts
    status: conv.status === 'active' ? 'idle' : conv.status,
    messages: conv.messages.map(m => messageToMessage(m, conv.id)),
    messageCount: conv.messageCount,
    toolSummary: conv.toolSummary.map(t => ({
      id: t.id,
      tool: t.tool,
      target: t.target,
      success: t.success,
    })),
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  }), [messageToMessage]);

  // Load data from backend (only when connected)
  // Uses a single batch endpoint to fetch all workspaces, sessions, and conversations
  useEffect(() => {
    if (!backendConnected) return;

    async function loadData() {
      setIsLoadingData(true);
      try {
        // Single API call to fetch all data (eliminates N+1 queries)
        const dashboardData = await getDashboardData();

        // Map workspaces
        const mappedWorkspaces = dashboardData.workspaces.map(repoToWorkspace);
        setWorkspaces(mappedWorkspaces);

        // Prefetch branch lists for all workspaces (fire-and-forget)
        const { fetchBranches: prefetchBranches } = useBranchCacheStore.getState();
        for (const ws of mappedWorkspaces) {
          prefetchBranches(ws.id).catch(() => {});
        }

        // Map sessions (stats already come from backend if available)
        const allSessions = dashboardData.sessions.map(s => mapSessionDTO(s));
        setSessions(allSessions);

        // Register all sessions with the global file watcher for event routing
        for (const session of allSessions) {
          if (session.worktreePath) {
            const dirName = getSessionDirName(session.worktreePath);
            if (dirName) {
              registerSession(dirName, session.id);
            }
          }
        }

        // Register archived sessions so the file watcher doesn't log noise for their worktrees
        if (dashboardData.archivedSessionDirs) {
          for (const entry of dashboardData.archivedSessionDirs) {
            registerSession(entry.dirName, entry.sessionId);
          }
        }

        // Map conversations (already included in the batch response)
        const allConversations = dashboardData.sessions.flatMap(s =>
          s.conversations.map(conversationToConversation)
        );
        setConversations(allConversations);

        // Restore active tab state if persisted tabs exist, otherwise fall back to defaults
        const tabState = ENABLE_BROWSER_TABS ? useTabStore.getState() : null;
        const activeTab = tabState?.tabs[tabState.activeTabId];
        const hasPersistedTab = ENABLE_BROWSER_TABS && activeTab && tabState!.tabOrder.length > 0 &&
          (activeTab.selectedWorkspaceId || activeTab.contentView.type !== 'conversation');

        // Validate persisted IDs against loaded data before restoring
        const workspaceValid = hasPersistedTab && activeTab.selectedWorkspaceId &&
          mappedWorkspaces.some(w => w.id === activeTab.selectedWorkspaceId);
        const sessionValid = hasPersistedTab && activeTab.selectedSessionId &&
          allSessions.some(s => s.id === activeTab.selectedSessionId && !s.archived);
        // Only validate conversation if its session is also valid
        const conversationValid = sessionValid && activeTab.selectedConversationId &&
          allConversations.some(c => c.id === activeTab.selectedConversationId);
        // For non-conversation views that carry a workspaceId, validate it exists
        const contentViewWorkspaceId = activeTab?.contentView &&
          'workspaceId' in activeTab.contentView
          ? (activeTab.contentView as { workspaceId?: string }).workspaceId
          : undefined;
        const contentViewWorkspaceValid = contentViewWorkspaceId
          ? mappedWorkspaces.some(w => w.id === contentViewWorkspaceId)
          : true; // views without workspaceId (repositories, session-manager, skills-store) are always valid
        const hasValidPersistedState = workspaceValid || sessionValid ||
          (hasPersistedTab && activeTab.contentView.type !== 'conversation' && contentViewWorkspaceValid);

        if (hasValidPersistedState) {
          // Restore only IDs that still exist in backend data
          if (workspaceValid) {
            selectWorkspace(activeTab.selectedWorkspaceId);
            // If workspace is valid but session is stale, select first available session in this workspace
            if (!sessionValid) {
              const fallbackSession = allSessions.find(s => s.workspaceId === activeTab.selectedWorkspaceId && !s.archived);
              if (fallbackSession) selectSession(fallbackSession.id);
            }
          }
          if (sessionValid) selectSession(activeTab.selectedSessionId);
          if (conversationValid) selectConversation(activeTab.selectedConversationId);
          useSettingsStore.getState().setContentView(activeTab!.contentView);
          useNavigationStore.getState().setActiveTabId(tabState!.activeTabId);
        } else if (mappedWorkspaces.length > 0) {
          // First launch — select first workspace and session
          selectWorkspace(mappedWorkspaces[0].id);
          const firstSession = allSessions.find(s => s.workspaceId === mappedWorkspaces[0].id && !s.archived);
          if (firstSession) {
            // Create a placeholder conversation if none exist for this session
            const sessionConvs = allConversations.filter(c => c.sessionId === firstSession.id);
            if (sessionConvs.length === 0) {
              const convId = `conv-${firstSession.id}`;
              addConversation({
                id: convId,
                sessionId: firstSession.id,
                type: 'task',
                name: firstSession.task || 'Task #1',
                status: 'idle',
                messages: [],
                toolSummary: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
            // selectSession auto-selects the first conversation for the session
            selectSession(firstSession.id);
          }
        }
        // Eagerly load messages for the initially-selected conversation so it's
        // visible without waiting for ConversationArea's useEffect to fire.
        const initialConvId = useAppStore.getState().selectedConversationId;
        if (initialConvId) {
          try {
            const page = await getConversationMessages(initialConvId, { limit: 50 });
            const messages = page.messages.map((m) => toStoreMessage(m, initialConvId));
            setMessagePage(initialConvId, messages, page.hasMore, page.oldestPosition ?? 0, page.totalCount);
          } catch (err) {
            console.error('Failed to eagerly load messages for initial conversation:', err);
          }
        }
      } catch (error) {
        console.error('Failed to load data from backend:', error);
        showError('Failed to load workspace data. Try reloading the app.', 'Data Load Error');
      } finally {
        setIsLoadingData(false);
      }
    }

    loadData();
  }, [backendConnected, repoToWorkspace, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, selectConversation, addConversation, setMessagePage, showError]);

  // Menu action handlers
  const handleNewSession = useCallback(async () => {
    if (!selectedWorkspaceId) return;

    try {
      // Backend generates city-based session name, branch, and worktree path
      const workspace = workspaces.find(w => w.id === selectedWorkspaceId);
      const branchPrefix = workspace?.branchPrefix
        ? getWorkspaceBranchPrefix(workspace)
        : getBranchPrefix();
      const newSession = await createSession(selectedWorkspaceId, {
        ...(branchPrefix !== undefined && { branchPrefix }),
      });

      // Register with global file watcher before adding to store
      if (newSession.worktreePath) {
        const dirName = getSessionDirName(newSession.worktreePath);
        if (dirName) {
          registerSession(dirName, newSession.id);
        }
      }

      // Add to store and select
      addSession(mapSessionDTO(newSession));
      // Note: no conversationId needed — navigate() calls selectSession() which
      // auto-selects the first conversation for the session as a side effect.
      navigate({
        workspaceId: newSession.workspaceId,
        sessionId: newSession.id,
        contentView: { type: 'conversation' },
      });
    } catch (error) {
      console.error('Failed to create session:', error);
      showError(error instanceof Error ? error.message : 'Failed to create session. Please try again.', 'Session Error');
    }
  }, [selectedWorkspaceId, workspaces, addSession, showError]);

  const handleNewConversation = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    try {
      const newConv = await createConversation(selectedWorkspaceId, selectedSessionId, {
        type: 'task',
      });

      // Add to store and select
      addConversation({
        id: newConv.id,
        sessionId: newConv.sessionId,
        type: newConv.type,
        name: newConv.name,
        status: newConv.status,
        messages: newConv.messages.map((m) => ({
          id: m.id,
          conversationId: newConv.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          setupInfo: m.setupInfo,
          runSummary: m.runSummary,
          timestamp: m.timestamp,
        })),
        toolSummary: newConv.toolSummary.map((t) => ({
          id: t.id,
          tool: t.tool,
          target: t.target,
          success: t.success,
        })),
        createdAt: newConv.createdAt,
        updatedAt: newConv.updatedAt,
      });
      selectConversation(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      showError(error instanceof Error ? error.message : 'Failed to create conversation. Please try again.', 'Conversation Error');
    }
  }, [selectedWorkspaceId, selectedSessionId, addConversation, selectConversation, showError]);

  // Actually perform the close operation
  const doCloseTab = useCallback(async (convId: string) => {
    const currentConvs = conversations.filter((c) => c.sessionId === selectedSessionId);
    const currentIndex = currentConvs.findIndex((c) => c.id === convId);

    try {
      // Delete from backend
      await deleteConversation(convId);

      // Remove from store
      removeConversation(convId);

      // Select adjacent conversation
      if (currentConvs.length > 1) {
        const nextConv = currentConvs[currentIndex + 1] || currentConvs[currentIndex - 1];
        if (nextConv) {
          selectConversation(nextConv.id);
        }
      }
    } catch (error) {
      console.error('Failed to close tab:', error);
      showError('Failed to close conversation. Please try again.');
    }
  }, [selectedSessionId, conversations, removeConversation, selectConversation, showError]);

  const handleCloseTab = useCallback(async () => {
    if (!selectedConversationId) return;

    // Check if conversation has messages
    const hasMessages = conversationMessages.length > 0;

    // If conversation has messages and setting is enabled, show confirmation
    if (hasMessages && confirmCloseActiveTab) {
      setPendingCloseConvId(selectedConversationId);
      setShowCloseConfirm(true);
      return;
    }

    // Otherwise close directly
    await doCloseTab(selectedConversationId);
  }, [selectedConversationId, conversationMessages, confirmCloseActiveTab, doCloseTab]);

  const handleConfirmClose = useCallback(async () => {
    if (pendingCloseConvId) {
      await doCloseTab(pendingCloseConvId);
      setPendingCloseConvId(null);
    }
  }, [pendingCloseConvId, doCloseTab]);

// Handle opening a project - directly opens folder dialog and adds the workspace
  const handleOpenProject = useCallback(async () => {
    const selectedPath = await openFolderDialog('Select Repository');
    if (!selectedPath) return;

    try {
      // Call backend API to validate and add repo
      const repo = await addRepo(selectedPath);

      // Map to workspace and add to store
      const workspace = {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        defaultBranch: repo.branch,
        remote: repo.remote || 'origin',
        branchPrefix: repo.branchPrefix || '',
        customPrefix: repo.customPrefix || '',
        createdAt: repo.createdAt,
      };
      useAppStore.getState().addWorkspace(workspace);

      // Prefetch branches for new workspace
      useBranchCacheStore.getState().fetchBranches(workspace.id).catch(() => {});

      // Auto-create first session for the new workspace (backend generates city-based name)
      const prefix = workspace.branchPrefix
        ? getWorkspaceBranchPrefix(workspace)
        : getBranchPrefix();
      const session = await createSession(workspace.id, {
        ...(prefix !== undefined && { branchPrefix: prefix }),
      });

      addSession(mapSessionDTO(session));

      // Fetch conversations created by backend (includes "Untitled" with setup info)
      const convs = await listConversations(workspace.id, session.id);
      convs.forEach((conv) => {
        addConversation({
          id: conv.id,
          sessionId: conv.sessionId,
          type: conv.type,
          name: conv.name,
          status: conv.status,
          messages: conv.messages.map((m) => ({
            id: m.id,
            conversationId: conv.id,
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            setupInfo: (m as { setupInfo?: SetupInfo }).setupInfo,
            timestamp: m.timestamp,
          })),
          toolSummary: conv.toolSummary,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
      });

      expandWorkspace(workspace.id);
      navigate({
        workspaceId: workspace.id,
        sessionId: session.id,
        conversationId: convs.length > 0 ? convs[0].id : undefined,
        contentView: { type: 'conversation' },
      });
    } catch (error) {
      // If it fails, fall back to showing the modal where user can see the error
      console.error('Failed to add workspace directly:', error);
      setShowAddWorkspace(true);
    }
  }, [addSession, addConversation, expandWorkspace]);

  // Handle closing a file tab (with dirty check)
  const handleCloseFileTab = useCallback((tabId: string) => {
    const tab = fileTabs.find((t) => t.id === tabId);
    if (!tab) return;

    // If tab is dirty, set pending close ID to show confirmation dialog
    if (tab.isDirty) {
      setPendingCloseFileTabId(tabId);
      return;
    }

    // Otherwise close directly
    closeFileTab(tabId);
  }, [fileTabs, closeFileTab, setPendingCloseFileTabId]);

  // Save dirty file and close
  const handleSaveAndCloseFile = useCallback(async () => {
    if (!pendingCloseFileTabId) return;
    const tab = fileTabs.find((t) => t.id === pendingCloseFileTabId);
    if (tab) {
      await saveTab(tab);
      closeFileTab(pendingCloseFileTabId);
    }
    setPendingCloseFileTabId(null);
  }, [pendingCloseFileTabId, fileTabs, saveTab, closeFileTab, setPendingCloseFileTabId]);

  // Close dirty file without saving
  const handleDontSaveAndCloseFile = useCallback(() => {
    if (!pendingCloseFileTabId) return;
    closeFileTab(pendingCloseFileTabId);
    setPendingCloseFileTabId(null);
  }, [pendingCloseFileTabId, closeFileTab, setPendingCloseFileTabId]);

  // Refs for menu-event handler callbacks — prevents safeListen re-registration race condition.
  // Without refs, unstable callbacks cause the useEffect to re-run, tearing down the Tauri
  // listener and asynchronously re-registering it. During the async gap, menu events are lost.
  const handleNewSessionRef = useRef(handleNewSession);
  const handleNewConversationRef = useRef(handleNewConversation);
  const handleCloseTabRef = useRef(handleCloseTab);
  const handleCloseFileTabRef = useRef(handleCloseFileTab);
  const toggleBottomTerminalRef = useRef(toggleBottomTerminal);
  const saveCurrentTabRef = useRef(saveCurrentTab);

  useEffect(() => { handleNewSessionRef.current = handleNewSession; }, [handleNewSession]);
  useEffect(() => { handleNewConversationRef.current = handleNewConversation; }, [handleNewConversation]);
  useEffect(() => { handleCloseTabRef.current = handleCloseTab; }, [handleCloseTab]);
  useEffect(() => { handleCloseFileTabRef.current = handleCloseFileTab; }, [handleCloseFileTab]);
  useEffect(() => { toggleBottomTerminalRef.current = toggleBottomTerminal; }, [toggleBottomTerminal]);
  useEffect(() => { saveCurrentTabRef.current = saveCurrentTab; }, [saveCurrentTab]);

  // Keyboard shortcuts (only for shortcuts NOT handled by native menu accelerators)
  // Most shortcuts are now native menu accelerators in menu.rs which emit 'menu-event'.
  // This handler covers: shortcuts without menu items, context-dependent shortcuts,
  // and shortcuts that need special terminal/focus handling.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+R to reload the app
      if (e.key === 'r' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        window.location.reload();
      }
      // Cmd+K for command palette - allow terminal to handle it for clear
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        const isInTerminal = (e.target as HTMLElement)?.closest('.xterm');
        if (!isInTerminal) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('open-command-palette'));
        }
      }
      // Cmd+J as alternative terminal toggle (Cmd+` is reserved by macOS for window switching)
      if (e.key === 'j' && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleBottomTerminal();
      }
      // Cmd+Shift+1-9 to switch sessions
      // Use e.code because Shift changes e.key to symbols on macOS (e.g. '1' → '!')
      if (e.metaKey && e.shiftKey && e.code >= 'Digit1' && e.code <= 'Digit9') {
        e.preventDefault();
        const index = parseInt(e.code.slice(5)) - 1;
        if (sessions[index]) {
          const session = sessions[index];
          navigate({
            workspaceId: session.workspaceId,
            sessionId: session.id,
            contentView: { type: 'conversation' },
          });
        }
      }
      // Tab switching shortcuts (multiple options for cross-platform compatibility)
      // Cmd+Option+] or Ctrl+Tab for next tab
      if ((e.key === ']' && e.metaKey && e.altKey && !e.shiftKey) ||
          (e.key === 'Tab' && e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        selectNextTab();
      }
      // Cmd+Option+[ or Ctrl+Shift+Tab for previous tab
      if ((e.key === '[' && e.metaKey && e.altKey && !e.shiftKey) ||
          (e.key === 'Tab' && e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        selectPreviousTab();
      }
      // Cmd+T to open new browser tab
      if (ENABLE_BROWSER_TABS && e.key === 't' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        createAndSwitchToNewTab();
      }
      // Cmd+Shift+] for next browser tab
      if (ENABLE_BROWSER_TABS && e.key === ']' && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { tabOrder, activeTabId: currentTabId } = useTabStore.getState();
        if (tabOrder.length > 1) {
          const currentIndex = tabOrder.indexOf(currentTabId);
          const nextIndex = (currentIndex + 1) % tabOrder.length;
          switchToTab(tabOrder[nextIndex]);
        }
      }
      // Cmd+Shift+[ for previous browser tab
      if (ENABLE_BROWSER_TABS && e.key === '[' && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { tabOrder, activeTabId: currentTabId } = useTabStore.getState();
        if (tabOrder.length > 1) {
          const currentIndex = tabOrder.indexOf(currentTabId);
          const prevIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
          switchToTab(tabOrder[prevIndex]);
        }
      }
      // Cmd+1-9 to select browser tabs by position (Cmd+9 = last tab)
      if (ENABLE_BROWSER_TABS && e.key >= '1' && e.key <= '9' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { tabOrder } = useTabStore.getState();
        if (tabOrder.length > 1) {
          const num = parseInt(e.key, 10);
          // Cmd+9 always selects the last tab
          const targetIndex = num === 9 ? tabOrder.length - 1 : num - 1;
          if (targetIndex < tabOrder.length) {
            switchToTab(tabOrder[targetIndex]);
          }
        }
      }
      // Escape to exit zen mode
      if (e.key === 'Escape') {
        if (zenModeRef.current) {
          e.preventDefault();
          setZenMode(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessions, toggleBottomTerminal, selectNextTab, selectPreviousTab, setZenMode]);

  // Handle Tauri menu events
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    safeListen<string>('menu-event', (menuId) => {
      switch (menuId) {
        // App menu
        case 'check_for_updates':
          useUpdateStore.getState().checkForUpdates();
          break;
        case 'settings':
          setShowSettings(true);
          break;

        // File menu
        case 'new_session':
          handleNewSessionRef.current();
          break;
        case 'new_conversation':
          handleNewConversationRef.current();
          break;
        case 'create_from_pr':
          window.dispatchEvent(new CustomEvent('create-from-pr'));
          break;
        case 'add_workspace':
          setShowAddWorkspace(true);
          break;
        case 'save_file':
          saveCurrentTabRef.current();
          break;
        case 'close_tab': {
          // Close file tab first, then browser tab, then conversation
          const fileTabId = useAppStore.getState().selectedFileTabId;
          if (fileTabId) {
            handleCloseFileTabRef.current(fileTabId);
          } else if (ENABLE_BROWSER_TABS && useTabStore.getState().tabOrder.length > 1) {
            const tabStore = useTabStore.getState();
            const closingId = tabStore.activeTabId;
            tabStore.closeTab(closingId);
            const newActiveId = tabStore.activeTabId;
            if (newActiveId !== closingId) {
              switchToTab(newActiveId);
            }
          } else {
            handleCloseTabRef.current();
          }
          break;
        }

        // Edit > Find
        case 'find':
          window.dispatchEvent(new CustomEvent('search-chat'));
          break;
        case 'find_next':
          window.dispatchEvent(new CustomEvent('search-next'));
          break;
        case 'find_previous':
          window.dispatchEvent(new CustomEvent('search-prev'));
          break;

        // View menu
        case 'toggle_left_sidebar':
          toggleLeftSidebar();
          break;
        case 'toggle_right_sidebar':
          if (selectedSessionIdRef.current) {
            toggleRightSidebar();
          }
          break;
        case 'toggle_terminal':
          toggleBottomTerminalRef.current();
          break;
        case 'command_palette':
          window.dispatchEvent(new CustomEvent('open-command-palette'));
          break;
        case 'file_picker':
          window.dispatchEvent(new CustomEvent('open-file-picker'));
          break;
        case 'open_session_manager':
          useSettingsStore.getState().setContentView({ type: 'session-manager' });
          break;
        case 'open_pr_dashboard':
          useSettingsStore.getState().setContentView({ type: 'pr-dashboard' });
          break;
        case 'open_repositories':
          useSettingsStore.getState().setContentView({ type: 'repositories' });
          break;
        case 'toggle_zen_mode':
          if (selectedSessionIdRef.current) {
            setZenMode(!zenModeRef.current);
          }
          break;
        case 'reset_layouts':
          resetLayouts();
          window.location.reload();
          break;
        case 'enter_full_screen':
          getCurrentWindow().then(async (win) => {
            if (win) {
              const isFullscreen = await win.isFullscreen();
              await win.setFullscreen(!isFullscreen);
            }
          });
          break;

        // Go menu
        case 'navigate_back':
          useNavigationStore.getState().goBack();
          break;
        case 'navigate_forward':
          useNavigationStore.getState().goForward();
          break;
        case 'go_to_workspace':
        case 'go_to_session':
        case 'go_to_conversation':
          window.dispatchEvent(new CustomEvent('open-command-palette'));
          break;
        case 'search_workspaces':
          window.dispatchEvent(new CustomEvent('search-workspaces'));
          break;

        // Session menu
        case 'thinking_off':
          useSettingsStore.getState().setDefaultThinkingLevel('off');
          break;
        case 'thinking_low':
          useSettingsStore.getState().setDefaultThinkingLevel('low');
          break;
        case 'thinking_medium':
          useSettingsStore.getState().setDefaultThinkingLevel('medium');
          break;
        case 'thinking_high':
          useSettingsStore.getState().setDefaultThinkingLevel('high');
          break;
        case 'thinking_max':
          useSettingsStore.getState().setDefaultThinkingLevel('max');
          break;
        case 'toggle_plan_mode':
          window.dispatchEvent(new CustomEvent('toggle-plan-mode'));
          break;
        case 'approve_plan':
          window.dispatchEvent(new CustomEvent('approve-plan'));
          break;
        case 'focus_input':
          window.dispatchEvent(new CustomEvent('focus-input'));
          break;
        case 'next_tab':
          selectNextTab();
          break;
        case 'previous_tab':
          selectPreviousTab();
          break;
        case 'quick_review':
          window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'quick' } }));
          break;
        case 'deep_review':
          window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'deep' } }));
          break;
        case 'security_audit':
          window.dispatchEvent(new CustomEvent('start-review', { detail: { type: 'security' } }));
          break;
        case 'open_in_vscode': {
          const { selectedSessionId, sessions: allSessions } = useAppStore.getState();
          const session = allSessions.find((s) => s.id === selectedSessionId);
          if (session?.worktreePath) {
            openInVSCode(session.worktreePath);
          }
          break;
        }
        case 'open_terminal':
          window.dispatchEvent(new CustomEvent('show-bottom-panel'));
          break;

        // Git menu
        case 'git_commit':
          window.dispatchEvent(new CustomEvent('git-commit'));
          break;
        case 'git_create_pr':
          window.dispatchEvent(new CustomEvent('git-create-pr'));
          break;
        case 'git_sync':
          window.dispatchEvent(new CustomEvent('git-sync'));
          break;
        case 'git_copy_branch': {
          const { selectedSessionId: sid, sessions: allSessions } = useAppStore.getState();
          const sess = allSessions.find((s) => s.id === sid);
          if (sess?.branch) {
            copyToClipboard(sess.branch);
          }
          break;
        }

        // Help menu
        case 'keyboard_shortcuts':
          window.dispatchEvent(new CustomEvent('show-shortcuts'));
          break;
        case 'release_notes':
          openUrlInBrowser('https://github.com/chatml/chatml/releases');
          break;
        case 'report_issue':
          openUrlInBrowser('https://github.com/chatml/chatml/issues/new');
          break;

        default:
          // Unhandled menu event
      }
    }).then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle window close confirmation
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    safeListen('window-close-requested', () => {
      // For now, just close the window
      // In the future, check for unsaved changes and show confirmation
      closeWindow();
    }).then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, []);

  // Handle CommandPalette custom events
  useEffect(() => {
    const handleOpenSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.category) setSettingsInitialCategory(detail.category);
      setShowSettings(true);
    };
    const handleCloseSettings = () => { setShowSettings(false); setSettingsInitialCategory(undefined); refreshClaudeAuthStatus(); };
    const handleSpawnAgent = () => handleNewSession();
    const handleNewConv = () => handleNewConversation();
    const handleAddWorkspace = () => setShowAddWorkspace(true);
    const handleCreateFromPR = () => setShowCreateFromPR(true);
    const handleToggleTheme = () => {
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    };
    const handleToggleLeftPanel = () => toggleLeftSidebar();
    const handleToggleRightPanel = () => toggleRightSidebar();
    const handleToggleBottomPanel = () => toggleBottomTerminal();
    const handleShowBottomPanel = () => {
      setShowBottomTerminal(true);
    };
    const handleOpenInVSCode = () => {
      const { selectedSessionId, sessions } = useAppStore.getState();
      const session = sessions.find((s) => s.id === selectedSessionId);
      if (session?.worktreePath) {
        openInVSCode(session.worktreePath);
      }
    };

    window.addEventListener('open-settings', handleOpenSettings);
    window.addEventListener('close-settings', handleCloseSettings);
    window.addEventListener('spawn-agent', handleSpawnAgent);
    window.addEventListener('new-conversation', handleNewConv);
    window.addEventListener('add-workspace', handleAddWorkspace);
    window.addEventListener('create-from-pr', handleCreateFromPR);
    window.addEventListener('toggle-theme', handleToggleTheme);
    window.addEventListener('toggle-left-panel', handleToggleLeftPanel);
    window.addEventListener('toggle-right-panel', handleToggleRightPanel);
    window.addEventListener('toggle-bottom-panel', handleToggleBottomPanel);
    window.addEventListener('show-bottom-panel', handleShowBottomPanel);
    window.addEventListener('open-in-vscode', handleOpenInVSCode);

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings);
      window.removeEventListener('close-settings', handleCloseSettings);
      window.removeEventListener('spawn-agent', handleSpawnAgent);
      window.removeEventListener('new-conversation', handleNewConv);
      window.removeEventListener('add-workspace', handleAddWorkspace);
      window.removeEventListener('create-from-pr', handleCreateFromPR);
      window.removeEventListener('toggle-theme', handleToggleTheme);
      window.removeEventListener('toggle-left-panel', handleToggleLeftPanel);
      window.removeEventListener('toggle-right-panel', handleToggleRightPanel);
      window.removeEventListener('toggle-bottom-panel', handleToggleBottomPanel);
      window.removeEventListener('show-bottom-panel', handleShowBottomPanel);
      window.removeEventListener('open-in-vscode', handleOpenInVSCode);
    };
  }, [handleNewSession, handleNewConversation, resolvedTheme, setTheme, toggleLeftSidebar, toggleRightSidebar, toggleBottomTerminal, setShowBottomTerminal]);

  // Don't render anything until client-side mounted - prevents hydration flash
  // Body background (set by ThemeScript) shows through
  if (!mounted) {
    return null;
  }

  // Show loading while checking auth - transparent to let body bg show through
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show onboarding if not authenticated
  if (!isAuthenticated) {
    return <OnboardingScreen />;
  }

  // Show connection screen until backend is ready
  if (!backendConnected) {
    return (
      <BackendStatus
        onConnected={() => setBackendConnected(true)}
        maxRetries={HEALTH_CHECK_MAX_RETRIES}
        initialDelay={HEALTH_CHECK_INITIAL_DELAY_MS}
      />
    );
  }

  return (
    <>
      <StreamingWarningHandler />
      <ConnectionStatusHandler />
      <TooltipProvider>
        <div className="h-screen overflow-hidden flex relative bg-background">
        {/* OUTER GROUP: Left Sidebar | Main Content */}
        <ResizablePanelGroup
          direction="horizontal"
          className="flex-1"
          defaultLayout={layoutOuter}
          onLayoutChange={setLayoutOuter}
        >
          {/* Left Sidebar - Always rendered, collapsible, hidden for global-workspace-manager */}
          <ResizablePanel
            ref={leftSidebarPanelRef}
            id="left-sidebar"
            defaultSize={22}
            minSize="200px"
            maxSize="400px"
            collapsible={true}
            collapsedSize={0}
            onResize={(size) => {
              const collapsed = size.asPercentage === 0;
              setLeftSidebarCollapsed((prev) => prev === collapsed ? prev : collapsed);
            }}
            className={cn(zenMode && "hidden")}
          >
            <div ref={leftSidebarDomRef} className="h-full flex flex-col">
              <SidebarToolbar />
              <div className="flex-1 min-h-0">
              <ErrorBoundary section="Sidebar">
                <WorkspaceSidebar
                  onOpenProject={handleOpenProject}
                  onCloneFromUrl={() => setShowCloneFromUrl(true)}
                  onQuickStart={() => setShowQuickStart(true)}
                  onOpenWorkspaceSettings={(workspaceId) => {
                    expandWorkspace(workspaceId);
                    setShowWorkspaceSettings(workspaceId);
                  }}
                />
              </ErrorBoundary>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle
            direction="horizontal"
            className={cn(
              "after:bg-transparent",
              (leftSidebarCollapsed || zenMode) && "hidden"
            )}
          />

          {/* Main Content - Full content views OR inner horizontal split */}
          <ResizablePanel id="main-content" defaultSize={78} minSize={30} className="!overflow-visible">
            <div className="flex flex-col h-full">
              {/* Main Toolbar — sits above the content area */}
              <MainToolbar
                showLeftSidebar={!leftSidebarCollapsed}
                showRightSidebar={!rightSidebarCollapsed}
                showBottomPanel={showBottomTerminal}
                hasSecondaryPanels={!isFullContentView && !!selectedSessionId}
                onToggleLeftSidebar={toggleLeftSidebar}
                onToggleRightSidebar={toggleRightSidebar}
                onToggleBottomPanel={toggleBottomTerminal}
                onOpenSettings={() => setShowSettings(true)}
                onOpenShortcuts={() => setShowShortcuts(true)}
              />

              {/* Main content area with border + rounded corner */}
              <div className={cn(
                "flex flex-col flex-1 min-h-0 border-t border-border/75 overflow-hidden",
                !leftSidebarCollapsed && !zenMode && "border-l rounded-tl-lg"
              )}>
              {/* Action bar — context-aware bar at top of main content */}
              <ContentActionBar />
              <ConnectionBanner onReconnect={reconnect} />

              {/* Content Area */}
              <div className="flex-1 min-h-0">
                {isLoadingData ? (
                  <ConversationSkeleton />
                ) : isFullContentView || (!selectedSessionId && contentView.type === 'conversation') ? (
                  // Full Content Views take entire main content area
                  <ErrorBoundary section="FullContent">
                {contentView.type === 'pr-dashboard' && (
                  <PRDashboard
                    initialWorkspaceId={contentView.workspaceId}
                  />
                )}
                {contentView.type === 'branches' && (
                  <BranchesDashboard
                    workspaceId={contentView.workspaceId}
                  />
                )}
                {contentView.type === 'repositories' && (
                  <RepositoriesDashboard
                    onOpenProject={handleOpenProject}
                    onCloneFromUrl={() => setShowCloneFromUrl(true)}
                    onQuickStart={() => setShowQuickStart(true)}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenShortcuts={() => setShowShortcuts(true)}
                    onOpenWorkspaceSettings={(workspaceId) => setShowWorkspaceSettings(workspaceId)}
                    showLeftSidebar={!leftSidebarCollapsed}
                  />
                )}
                {contentView.type === 'session-manager' && (
                  <SessionManager />
                )}
                {contentView.type === 'skills-store' && (
                  <SkillsStore />
                )}
                {!selectedSessionId && contentView.type === 'conversation' && (
                  <EmptyView
                    onOpenProject={handleOpenProject}
                    onCloneFromUrl={() => setShowCloneFromUrl(true)}
                    onQuickStart={() => setShowQuickStart(true)}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenShortcuts={() => setShowShortcuts(true)}
                    showLeftSidebar={!leftSidebarCollapsed}
                  />
                )}
              </ErrorBoundary>
            ) : (
              // INNER GROUP: Conversation + Terminal | Right Sidebar
              <ResizablePanelGroup
                direction="horizontal"
                className="h-full"
                defaultLayout={layoutInner}
                onLayoutChange={setLayoutInner}
              >
                {/* Inner Content - Contains vertical split */}
                <ResizablePanel id="inner-content" minSize={30}>
                  {/* VERTICAL GROUP: Conversation | Bottom Terminal */}
                  <ResizablePanelGroup
                    direction="vertical"
                    className="h-full"
                    defaultLayout={layoutVertical}
                    onLayoutChange={(layout) => {
                      // Don't persist collapsed layouts — remember the last "open" split
                      if (layout['bottom-terminal'] && layout['bottom-terminal'] > 0) {
                        setLayoutVertical(layout);
                      }
                    }}
                  >
                    {/* Conversation Area */}
                    <ResizablePanel id="conversation" minSize={20}>
                      {selectedSessionId ? (
                        <div className="flex flex-col h-full">
                          <SessionToolbarContent />
                          <ErrorBoundary section="Conversation">
                            <ConversationArea>
                              <ChatInput />
                            </ConversationArea>
                          </ErrorBoundary>
                        </div>
                      ) : null}
                    </ResizablePanel>

                    {/* Bottom Terminal - conditionally rendered */}
                    {selectedSession && showBottomTerminal && (
                      <>
                        <ResizableHandle direction="vertical" />
                        <ResizablePanel
                          id="bottom-terminal"
                          defaultSize="250px"
                          minSize="100px"
                          maxSize="400px"
                        >
                          <div className="h-full">
                            <ErrorBoundary section="Terminal">
                              <BottomTerminal
                                sessionId={selectedSession.id}
                                workspacePath={selectedSession.worktreePath}
                                onHide={hideBottomTerminal}
                              />
                            </ErrorBoundary>
                          </div>
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </ResizablePanel>

                <ResizableHandle
                  direction="horizontal"
                  className={cn(
                    (rightSidebarCollapsed || zenMode || !selectedSessionId) && "hidden"
                  )}
                />

                {/* Right Sidebar - Nested inside main content, collapsible */}
                <ResizablePanel
                  ref={rightSidebarPanelRef}
                  id="right-sidebar"
                  defaultSize="280px"
                  minSize="250px"
                  maxSize="500px"
                  collapsible={true}
                  collapsedSize={0}
                  onResize={(size) => {
              const collapsed = size.asPercentage === 0;
              setRightSidebarCollapsed((prev) => prev === collapsed ? prev : collapsed);
            }}
                  className={cn(
                    "overflow-hidden bg-content-background dark:bg-transparent",
                    (zenMode || !selectedSessionId) && "hidden"
                  )}
                >
                  <ErrorBoundary section="Changes">
                    <ChangesPanel />
                  </ErrorBoundary>
                </ResizablePanel>
              </ResizablePanelGroup>
                )}
              </div>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>


        {/* Onboarding Wizard Overlay */}
        {showWizard && (
          <OnboardingWizard
            onComplete={completeWizard}
            onSkip={skipAll}
            onOpenSettings={() => { skipAll(); setSettingsInitialCategory('ai-models'); setShowSettings(true); }}
          />
        )}

        {/* Guided Tour Overlay */}
        {showGuidedTour && !isLoadingData && (
          <GuidedTour onComplete={completeTour} onDismiss={completeTour} />
        )}

        {/* Settings Overlay - full screen */}
        {showSettings && (
          <div className="absolute inset-0 z-20 bg-content-background">
            <SettingsPage initialCategory={settingsInitialCategory as 'general' | 'ai-models' | undefined} onBack={() => { setShowSettings(false); setSettingsInitialCategory(undefined); refreshClaudeAuthStatus(); }} />
          </div>
        )}

        {/* Workspace Settings Overlay - full screen */}
        {showWorkspaceSettings && (
          <div className="absolute inset-0 z-20 bg-content-background">
            <WorkspaceSettings
              workspaceId={showWorkspaceSettings}
              onBack={() => setShowWorkspaceSettings(null)}
            />
          </div>
        )}

        {/* Add Workspace Modal */}
        <AddWorkspaceModal
          isOpen={showAddWorkspace}
          onClose={() => setShowAddWorkspace(false)}
        />

        {/* Create Session from PR/Branch Modal */}
        <CreateFromPRModal
          isOpen={showCreateFromPR}
          onClose={() => setShowCreateFromPR(false)}
        />

        {/* Clone from URL Dialog */}
        <CloneFromUrlDialog
          isOpen={showCloneFromUrl}
          onClose={() => setShowCloneFromUrl(false)}
        />

        {/* Quick Start Dialog */}
        <QuickStartDialog
          isOpen={showQuickStart}
          onClose={() => setShowQuickStart(false)}
        />

        {/* Close Tab Confirmation Dialog */}
        <CloseTabConfirmDialog
          open={showCloseConfirm}
          onOpenChange={setShowCloseConfirm}
          onConfirm={handleConfirmClose}
        />

{/* Close Dirty File Confirmation Dialog */}
        <CloseFileConfirmDialog
          open={pendingCloseFileTabId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingCloseFileTabId(null);
          }}
          fileName={fileTabs.find((t) => t.id === pendingCloseFileTabId)?.name || 'file'}
          onSave={handleSaveAndCloseFile}
          onDontSave={handleDontSaveAndCloseFile}
        />

        {/* File Picker (Cmd+P) */}
        <FilePicker
          workspaceId={selectedWorkspaceId}
          sessionId={selectedSessionId}
        />

        {/* Workspace Search (Cmd+Shift+F) */}
        <WorkspaceSearch />

        {/* Keyboard Shortcuts Dialog (Cmd+/) */}
        <KeyboardShortcutsDialog
          open={showShortcuts}
          onOpenChange={setShowShortcuts}
        />

        {/* Command Palette (Cmd+K) */}
        <CommandPalette />

        </div>
      </TooltipProvider>
    </>
  );
}
