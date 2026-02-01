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
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { ENABLE_BROWSER_TABS } from '@/lib/constants';
import { useTabStore } from '@/stores/tabStore';
import { switchToTab, createAndSwitchToNewTab } from '@/components/navigation/BrowserTabBar';
import { useNavigationStore } from '@/stores/navigationStore';
import { useAuthStore } from '@/stores/authStore';
import { OnboardingScreen } from '@/components/shared/OnboardingScreen';
import { initAuth, listenForOAuthCallback, validateStoredToken, OAUTH_TIMEOUT_MS } from '@/lib/auth';
import { isTauri, safeListen, closeWindow, openFolderDialog, openInVSCode, registerSession, unregisterSession, getSessionDirName } from '@/lib/tauri';
import { CloseTabConfirmDialog } from '@/components/dialogs/CloseTabConfirmDialog';
import { CloseFileConfirmDialog } from '@/components/dialogs/CloseFileConfirmDialog';
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTabPersistence } from '@/hooks/useTabPersistence';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { useExternalLinkGuard } from '@/hooks/useExternalLinkGuard';
import { useReviewTrigger } from '@/hooks/useReviewTrigger';
import { useShortcut } from '@/hooks/useShortcut';
import { getDashboardData, listConversations, createSession, createConversation, deleteConversation, addRepo, mapSessionDTO, type RepoDTO, type SessionDTO, type ConversationDTO, type MessageDTO } from '@/lib/api';
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
import { CloneFromUrlDialog } from '@/components/dialogs/CloneFromUrlDialog';
import { QuickStartDialog } from '@/components/dialogs/QuickStartDialog';
import { FilePicker } from '@/components/dialogs/FilePicker';
import { WorkspaceSearch } from '@/components/dialogs/WorkspaceSearch';
import { CommandPalette } from '@/components/dialogs/CommandPalette';
// import { UpdateChecker } from '@/components/shared/UpdateChecker';
import { BackendStatus } from '@/components/shared/BackendStatus';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { PRDashboard } from '@/components/dashboards/PRDashboard';
import { BranchesDashboard } from '@/components/dashboards/BranchesDashboard';
import { RepositoriesDashboard } from '@/components/dashboards/RepositoriesDashboard';
import { GlobalDashboard } from '@/components/dashboards/GlobalDashboard';
import { WorkspaceDashboard } from '@/components/dashboards/workspace-dashboard';
import { SessionManager } from '@/components/session-manager';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider, useToast } from '@/components/ui/toast';
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
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
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
  const bottomTerminalPanelRef = useRef<PanelImperativeHandle>(null);
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

  // Initialize auth on mount
  useEffect(() => {
    let unlistenOAuth: (() => void) | null = null;

    const init = async () => {
      // Set up OAuth callback listener first
      try {
        console.log('[OAuth] page.tsx: Setting up callback listener...');
        unlistenOAuth = await listenForOAuthCallback(
          (result) => {
            console.log('[OAuth] page.tsx: Success callback received, user:', result.user?.login);
            completeOAuth();
            setAuthenticated(true, result.user);
          },
          (error) => {
            console.log('[OAuth] page.tsx: Error callback received:', error.message);
            failOAuth(error.message);
          }
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
  }, [setAuthenticated, completeOAuth, failOAuth]);

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

  // Use refs to avoid changing useEffect dependency array sizes
  const showBottomTerminalRef = useRef(showBottomTerminal);
  useEffect(() => {
    showBottomTerminalRef.current = showBottomTerminal;
  }, [showBottomTerminal]);

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

  // Sync bottom terminal panel collapse state with showBottomTerminal
  useEffect(() => {
    const panel = bottomTerminalPanelRef.current;
    if (!panel) return;

    // Only act if the panel state doesn't match the desired state
    const isCollapsed = panel.isCollapsed();
    if (showBottomTerminal && isCollapsed) {
      panel.expand();
    } else if (!showBottomTerminal && !isCollapsed) {
      panel.collapse();
    }
  }, [showBottomTerminal]);

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
    fileTabs, selectedFileTabId, closeFileTab,
    pendingCloseFileTabId, setPendingCloseFileTabId,
  } = useFileTabState();
  const {
    setWorkspaces, setSessions, setConversations,
    addSession, addConversation, selectWorkspace, selectSession, selectConversation,
  } = usePageActions();
  const conversationMessages = useMessages(selectedConversationId);
  const selectNextTab = useAppStore((s) => s.selectNextTab);
  const selectPreviousTab = useAppStore((s) => s.selectPreviousTab);

  const { expandWorkspace } = useSettingsStore();

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

  // Keyboard shortcut: Cmd+/ to show shortcuts dialog
  useShortcut('shortcutsDialog', useCallback(() => {
    setShowShortcuts((prev) => !prev);
  }, []));

  // Map backend Repo to frontend Workspace
  const repoToWorkspace = useCallback((repo: RepoDTO) => ({
    id: repo.id,
    name: repo.name,
    path: repo.path,
    defaultBranch: repo.branch,
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

        if (hasPersistedTab) {
          // Restore from persisted active tab
          if (activeTab.selectedWorkspaceId) {
            selectWorkspace(activeTab.selectedWorkspaceId);
          }
          if (activeTab.selectedSessionId) {
            selectSession(activeTab.selectedSessionId);
          }
          if (activeTab.selectedConversationId) {
            selectConversation(activeTab.selectedConversationId);
          }
          useSettingsStore.getState().setContentView(activeTab!.contentView);
          useNavigationStore.getState().setActiveTabId(tabState!.activeTabId);
        } else if (mappedWorkspaces.length > 0) {
          // First launch — select first workspace and session
          selectWorkspace(mappedWorkspaces[0].id);
          const firstSession = allSessions.find(s => s.workspaceId === mappedWorkspaces[0].id);
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
      } catch (error) {
        console.error('Failed to load data from backend:', error);
      } finally {
        setIsLoadingData(false);
      }
    }

    loadData();
  }, [backendConnected, repoToWorkspace, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, selectConversation, addConversation]);

  // Menu action handlers
  const handleNewSession = useCallback(async () => {
    if (!selectedWorkspaceId) return;

    try {
      // Backend generates city-based session name, branch, and worktree path
      const newSession = await createSession(selectedWorkspaceId);

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
    }
  }, [selectedWorkspaceId, addSession]);

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
    }
  }, [selectedWorkspaceId, selectedSessionId, addConversation, selectConversation]);

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
        createdAt: repo.createdAt,
      };
      useAppStore.getState().addWorkspace(workspace);

      // Auto-create first session for the new workspace (backend generates city-based name)
      const session = await createSession(workspace.id);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+R to reload the app
      if (e.key === 'r' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        window.location.reload();
      }
      // Cmd+Shift+N to add workspace
      if (e.key === 'n' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        setShowAddWorkspace(true);
        return;
      }
      // Cmd+N to create new session in selected workspace
      if (e.key === 'n' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (!selectedWorkspaceId && workspaces.length === 0) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('spawn-agent'));
      }
      // Cmd+K for command palette (future) - but allow terminal to handle it for clear
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        // Don't intercept if focus is inside terminal (let terminal handle Cmd+K for clear)
        const isInTerminal = (e.target as HTMLElement)?.closest('.xterm');
        if (!isInTerminal) {
          e.preventDefault();
          // TODO: Open command palette
        }
      }
      // Cmd+, to open settings (standard macOS)
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSettings(true);
      }
      // Cmd+Shift+O to open workspace in VS Code
      if (e.key === 'o' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
        if (workspace?.path && isTauri()) {
          import('@tauri-apps/plugin-shell').then(({ Command }) => {
            Command.create('code', [workspace.path]).spawn().catch(console.error);
          });
        }
      }
      // Cmd+B to toggle left sidebar
      if (e.code === 'KeyB' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleLeftSidebar();
      }
      // Cmd+Option+B to toggle right sidebar (only when session is selected)
      if (e.code === 'KeyB' && (e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (selectedSessionIdRef.current) {
          toggleRightSidebar();
        }
      }
      // Ctrl+` or Cmd+J to toggle bottom terminal (Cmd+` is reserved by macOS for window switching)
      if ((e.key === '`' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) ||
          (e.key === 'j' && e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)) {
        e.preventDefault();
        setShowBottomTerminal(!showBottomTerminalRef.current);
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
      // Cmd+W to close tab (file tab first, then conversation, then browser tab)
      if (e.key === 'w' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        // If a file tab is selected, close it first
        if (selectedFileTabId) {
          handleCloseFileTab(selectedFileTabId);
        } else if (ENABLE_BROWSER_TABS && useTabStore.getState().tabOrder.length > 1) {
          // Close the browser tab if more than one exists
          const tabStore = useTabStore.getState();
          const closingId = tabStore.activeTabId;
          tabStore.closeTab(closingId);
          // Restore new active tab's state
          const newActiveId = tabStore.activeTabId;
          if (newActiveId !== closingId) {
            switchToTab(newActiveId);
          }
        } else {
          // Otherwise close the conversation
          handleCloseTab();
        }
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
      // Cmd+S to save current file tab
      if (e.key === 's' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        saveCurrentTab();
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
      // Cmd+. to toggle zen mode (distraction-free mode, only when session is selected)
      if (e.code === 'Period' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (selectedSessionIdRef.current) {
          setZenMode(!zenModeRef.current);
        }
      }
      // Cmd+Shift+R to reset all panel layouts to defaults
      if (e.key === 'r' && (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        resetLayouts();
        // Force page reload to apply default layouts
        window.location.reload();
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
  }, [sessions, conversations, workspaces, selectedWorkspaceId, selectedFileTabId, selectSession, selectConversation, handleCloseTab, setShowBottomTerminal, selectNextTab, selectPreviousTab, handleCloseFileTab, saveCurrentTab, setZenMode, toggleLeftSidebar, toggleRightSidebar, resetLayouts]);

  // Handle Tauri menu events
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    safeListen<string>('menu-event', (menuId) => {
      switch (menuId) {
        case 'settings':
          setShowSettings(true);
          break;
        case 'new_session':
          handleNewSession();
          break;
        case 'new_conversation':
          handleNewConversation();
          break;
        case 'add_workspace':
          setShowAddWorkspace(true);
          break;
        case 'close_tab':
          handleCloseTab();
          break;
        case 'save_file':
          saveCurrentTab();
          break;
        case 'toggle_left_sidebar':
          toggleLeftSidebar();
          break;
        case 'toggle_right_sidebar':
          // Only toggle right sidebar if a session is selected
          if (selectedSessionIdRef.current) {
            toggleRightSidebar();
          }
          break;
        case 'toggle_terminal':
          setShowBottomTerminal(!showBottomTerminalRef.current);
          break;
        case 'toggle_thinking':
          // Emit event for ChatInput to handle
          window.dispatchEvent(new CustomEvent('toggle-thinking'));
          break;
        case 'toggle_plan_mode':
          // Emit event for ChatInput to handle
          window.dispatchEvent(new CustomEvent('toggle-plan-mode'));
          break;
        case 'focus_input':
          // Emit event for ChatInput to handle
          window.dispatchEvent(new CustomEvent('focus-input'));
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
  }, [handleNewSession, handleNewConversation, handleCloseTab, setShowBottomTerminal, saveCurrentTab, toggleLeftSidebar, toggleRightSidebar]);

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
    const handleOpenSettings = () => setShowSettings(true);
    const handleCloseSettings = () => setShowSettings(false);
    const handleSpawnAgent = () => handleNewSession();
    const handleNewConv = () => handleNewConversation();
    const handleAddWorkspace = () => setShowAddWorkspace(true);
    const handleToggleTheme = () => {
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    };
    const handleToggleLeftPanel = () => toggleLeftSidebar();
    const handleToggleRightPanel = () => toggleRightSidebar();
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
    window.addEventListener('toggle-theme', handleToggleTheme);
    window.addEventListener('toggle-left-panel', handleToggleLeftPanel);
    window.addEventListener('toggle-right-panel', handleToggleRightPanel);
    window.addEventListener('open-in-vscode', handleOpenInVSCode);

    return () => {
      window.removeEventListener('open-settings', handleOpenSettings);
      window.removeEventListener('close-settings', handleCloseSettings);
      window.removeEventListener('spawn-agent', handleSpawnAgent);
      window.removeEventListener('new-conversation', handleNewConv);
      window.removeEventListener('add-workspace', handleAddWorkspace);
      window.removeEventListener('toggle-theme', handleToggleTheme);
      window.removeEventListener('toggle-left-panel', handleToggleLeftPanel);
      window.removeEventListener('toggle-right-panel', handleToggleRightPanel);
      window.removeEventListener('open-in-vscode', handleOpenInVSCode);
    };
  }, [handleNewSession, handleNewConversation, resolvedTheme, setTheme, toggleLeftSidebar, toggleRightSidebar]);

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
    <ToastProvider>
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
                  onOpenSettings={() => setShowSettings(true)}
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
                onToggleBottomPanel={() => setShowBottomTerminal(!showBottomTerminal)}
                onOpenSettings={() => setShowSettings(true)}
                onOpenShortcuts={() => setShowShortcuts(true)}
              />

              {/* Main content area with border + rounded corner */}
              <div className={cn(
                "flex flex-col flex-1 min-h-0 border-t border-border/75 overflow-hidden",
                !leftSidebarCollapsed && !zenMode && "border-l rounded-tl-lg shadow-[-2px_0_8px_rgba(0,0,0,0.1)]"
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
                {contentView.type === 'global-dashboard' && (
                  <GlobalDashboard />
                )}
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
                {contentView.type === 'workspace-dashboard' && (
                  <WorkspaceDashboard
                    workspaceId={contentView.workspaceId}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenShortcuts={() => setShowShortcuts(true)}
                    showLeftSidebar={!leftSidebarCollapsed}
                    onCreateSession={handleNewSession}
                  />
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
                    onLayoutChange={setLayoutVertical}
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

                    {/* Bottom Terminal - always mounted to preserve PTY session */}
                    {selectedSession && (
                      <>
                        <ResizableHandle
                          direction="vertical"
                          className={cn(!showBottomTerminal && "hidden")}
                        />
                        <ResizablePanel
                          ref={bottomTerminalPanelRef}
                          id="bottom-terminal"
                          defaultSize="180px"
                          minSize="100px"
                          maxSize="400px"
                          collapsible={true}
                          collapsedSize={0}
                        >
                          <div className={showBottomTerminal ? 'h-full' : 'h-0 overflow-hidden'}>
                            <ErrorBoundary section="Terminal">
                              <BottomTerminal
                                sessionId={selectedSession.id}
                                workspacePath={selectedSession.worktreePath}
                                onHide={() => setShowBottomTerminal(false)}
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
                    "overflow-hidden",
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


        {/* Settings Overlay - full screen */}
        {showSettings && (
          <div className="absolute inset-0 z-20 bg-content-background">
            <SettingsPage onBack={() => setShowSettings(false)} />
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

        {/* Update Checker - disabled until remote URL is configured
        <UpdateChecker />
        */}
        </div>
      </TooltipProvider>
    </ToastProvider>
  );
}
