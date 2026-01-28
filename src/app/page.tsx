'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { OnboardingScreen } from '@/components/shared/OnboardingScreen';
import { initAuth, listenForOAuthCallback, validateStoredToken, OAUTH_TIMEOUT_MS } from '@/lib/auth';
import { isTauri, safeListen, closeWindow, openFolderDialog } from '@/lib/tauri';
import { CloseTabConfirmDialog } from '@/components/dialogs/CloseTabConfirmDialog';
import { CloseFileConfirmDialog } from '@/components/dialogs/CloseFileConfirmDialog';
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTabPersistence } from '@/hooks/useTabPersistence';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { useShortcut } from '@/hooks/useShortcut';
import { getDashboardData, listConversations, createSession, createConversation, deleteConversation, addRepo, type RepoDTO, type SessionDTO, type ConversationDTO, type MessageDTO } from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
import { WorkspaceSidebar } from '@/components/navigation/WorkspaceSidebar';
import { WorkspaceSettings } from '@/components/settings/WorkspaceSettings';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { TopBar } from '@/components/navigation/TopBar';
import { ConversationArea } from '@/components/conversation/ConversationArea';
import { ChatInput } from '@/components/conversation/ChatInput';
import { ChangesPanel } from '@/components/panels/ChangesPanel';
import { BottomTerminal } from '@/components/layout/BottomTerminal';
import { MainToolbar } from '@/components/layout/MainToolbar';
import { AddWorkspaceModal } from '@/components/dialogs/AddWorkspaceModal';
import { CloneFromUrlDialog } from '@/components/dialogs/CloneFromUrlDialog';
import { QuickStartDialog } from '@/components/dialogs/QuickStartDialog';
import { FilePicker } from '@/components/dialogs/FilePicker';
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
  const [sidebarWidth, setSidebarWidth] = useState(250); // Default until measured
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingCloseConvId, setPendingCloseConvId] = useState<string | null>(null);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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
    setContentView,
    layoutOuter, setLayoutOuter,
    layoutInner, setLayoutInner,
    layoutVertical, setLayoutVertical,
    resetLayouts,
  } = useSettingsStore();

  // Determine if we're in a Full Content view (not conversation or session-manager overlay)
  // Also treat as full content view when no session is selected (to show welcome screen)
  const isFullContentView = contentView.type !== 'conversation' && contentView.type !== 'session-manager';

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
      // Use offsetWidth to include padding/borders, but 0 when collapsed
      setSidebarWidth(leftSidebarCollapsed ? 0 : el.offsetWidth);
    });
    observer.observe(el);

    // Initial measurement
    setSidebarWidth(leftSidebarCollapsed ? 0 : el.offsetWidth);

    return () => observer.disconnect();
  }, [leftSidebarCollapsed]);

  const {
    workspaces,
    sessions,
    conversations,
    messages,
    selectedWorkspaceId,
    selectedSessionId,
    selectedConversationId,
    selectedFileTabId,
    fileTabs,
    setWorkspaces,
    setSessions,
    setConversations,
    addSession,
    addConversation,
    removeConversation,
    selectWorkspace,
    selectSession,
    selectConversation,
    closeFileTab,
    selectNextTab,
    selectPreviousTab,
    pendingCloseFileTabId,
    setPendingCloseFileTabId,
  } = useAppStore();

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
  useWebSocket(backendConnected);

  // Persist file tabs to backend
  useTabPersistence();

  // Auto-save dirty file tabs
  const { saveCurrentTab, saveTab } = useAutoSave();

  // Watch for external file changes
  useFileWatcher();

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

  // Map backend Session to frontend WorktreeSession
  const sessionToWorktreeSession = useCallback((session: SessionDTO) => ({
    id: session.id,
    workspaceId: session.workspaceId,
    name: session.name,
    branch: session.branch,
    worktreePath: session.worktreePath,
    task: session.task,
    status: session.status,
    stats: session.stats,
    prStatus: session.prStatus,
    prUrl: session.prUrl,
    prNumber: session.prNumber,
    hasMergeConflict: session.hasMergeConflict,
    hasCheckFailures: session.hasCheckFailures,
    pinned: session.pinned,
    archived: session.archived,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }), []);

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
        const allSessions = dashboardData.sessions.map(s => sessionToWorktreeSession(s));
        setSessions(allSessions);

        // Map conversations (already included in the batch response)
        const allConversations = dashboardData.sessions.flatMap(s =>
          s.conversations.map(conversationToConversation)
        );
        setConversations(allConversations);

        // Select first workspace and session if available
        if (mappedWorkspaces.length > 0) {
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
  }, [backendConnected, repoToWorkspace, sessionToWorktreeSession, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, addConversation]);

  // Menu action handlers
  const handleNewSession = useCallback(async () => {
    if (!selectedWorkspaceId) return;

    try {
      // Backend generates city-based session name, branch, and worktree path
      const newSession = await createSession(selectedWorkspaceId);

      // Add to store and select
      addSession({
        id: newSession.id,
        workspaceId: newSession.workspaceId,
        name: newSession.name,
        branch: newSession.branch,
        worktreePath: newSession.worktreePath,
        task: newSession.task,
        status: newSession.status,
        stats: newSession.stats,
        prStatus: newSession.prStatus,
        prUrl: newSession.prUrl,
        prNumber: newSession.prNumber,
        hasMergeConflict: newSession.hasMergeConflict,
        hasCheckFailures: newSession.hasCheckFailures,
        pinned: newSession.pinned,
        createdAt: newSession.createdAt,
        updatedAt: newSession.updatedAt,
      });
      selectSession(newSession.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [selectedWorkspaceId, addSession, selectSession]);

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

    // Check if conversation has messages using the messages store
    const conversationMessages = messages.filter((m) => m.conversationId === selectedConversationId);
    const hasMessages = conversationMessages.length > 0;

    // If conversation has messages and setting is enabled, show confirmation
    if (hasMessages && confirmCloseActiveTab) {
      setPendingCloseConvId(selectedConversationId);
      setShowCloseConfirm(true);
      return;
    }

    // Otherwise close directly
    await doCloseTab(selectedConversationId);
  }, [selectedConversationId, messages, confirmCloseActiveTab, doCloseTab]);

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
      selectWorkspace(workspace.id);

      // Auto-create first session for the new workspace (backend generates city-based name)
      const session = await createSession(workspace.id);

      addSession({
        id: session.id,
        workspaceId: session.workspaceId,
        name: session.name,
        branch: session.branch,
        worktreePath: session.worktreePath,
        task: session.task,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });

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
      selectSession(session.id);
      if (convs.length > 0) {
        selectConversation(convs[0].id);
      }
    } catch (error) {
      // If it fails, fall back to showing the modal where user can see the error
      console.error('Failed to add workspace directly:', error);
      setShowAddWorkspace(true);
    }
  }, [selectWorkspace, addSession, addConversation, expandWorkspace, selectSession, selectConversation]);

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
      // Cmd+N to add workspace
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowAddWorkspace(true);
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
      if (e.metaKey && e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (sessions[index]) {
          selectSession(sessions[index].id);
          // Also select the first conversation for that session
          const sessionConvs = conversations.filter(
            (c) => c.sessionId === sessions[index].id
          );
          if (sessionConvs.length > 0) {
            selectConversation(sessionConvs[0].id);
          }
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
      // Cmd+W to close tab (file tab first, then conversation)
      if (e.key === 'w' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        // If a file tab is selected, close it first
        if (selectedFileTabId) {
          handleCloseFileTab(selectedFileTabId);
        } else {
          // Otherwise close the conversation
          handleCloseTab();
        }
      }
      // Cmd+S to save current file tab
      if (e.key === 's' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        saveCurrentTab();
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
      // Escape to close session manager or exit zen mode
      if (e.key === 'Escape') {
        if (contentViewRef.current.type === 'session-manager') {
          e.preventDefault();
          setContentView({ type: 'conversation' });
        } else if (zenModeRef.current) {
          e.preventDefault();
          setZenMode(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessions, conversations, workspaces, selectedWorkspaceId, selectedFileTabId, selectSession, selectConversation, handleCloseTab, setShowBottomTerminal, selectNextTab, selectPreviousTab, handleCloseFileTab, saveCurrentTab, setZenMode, setContentView, toggleLeftSidebar, toggleRightSidebar, resetLayouts]);

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
            onResize={(size) => setLeftSidebarCollapsed(size.asPercentage === 0)}
            className={cn(zenMode && "hidden")}
          >
            <div ref={leftSidebarDomRef} className="h-full">
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
          </ResizablePanel>

          <ResizableHandle
            direction="horizontal"
            className={cn((leftSidebarCollapsed || zenMode) && "hidden")}
          />

          {/* Main Content - Full content views OR inner horizontal split */}
          <ResizablePanel id="main-content" defaultSize={78} minSize={30}>
            <div className="flex flex-col h-full">
              {/* Main Toolbar - always visible at top of main content */}
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

              {/* Content Area */}
              <div className="flex-1 min-h-0">
                {isLoadingData ? (
                  <ConversationSkeleton />
                ) : isFullContentView || (!selectedSessionId && contentView.type === 'conversation') ? (
                  // Full Content Views take entire main content area
                  <ErrorBoundary section="FullContent">
                {contentView.type === 'global-dashboard' && (
                  <GlobalDashboard
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenShortcuts={() => setShowShortcuts(true)}
                    showLeftSidebar={!leftSidebarCollapsed}
                  />
                )}
                {contentView.type === 'pr-dashboard' && (
                  <PRDashboard
                    initialWorkspaceId={contentView.workspaceId}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenShortcuts={() => setShowShortcuts(true)}
                    showLeftSidebar={!leftSidebarCollapsed}
                  />
                )}
                {contentView.type === 'branches' && (
                  <BranchesDashboard
                    workspaceId={contentView.workspaceId}
                    onOpenSettings={() => setShowSettings(true)}
                    onOpenShortcuts={() => setShowShortcuts(true)}
                    showLeftSidebar={!leftSidebarCollapsed}
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
                          <TopBar
                            showLeftSidebar={!leftSidebarCollapsed || zenMode}
                            onToggleLeftSidebar={toggleLeftSidebar}
                          />
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
                  onResize={(size) => setRightSidebarCollapsed(size.asPercentage === 0)}
                  className={cn(
                    "overflow-hidden",
                    (zenMode || !selectedSessionId) && "hidden"
                  )}
                >
                  <ErrorBoundary section="Changes">
                    <ChangesPanel
                      onOpenSettings={() => setShowSettings(true)}
                      onOpenShortcuts={() => setShowShortcuts(true)}
                    />
                  </ErrorBoundary>
                </ResizablePanel>
              </ResizablePanelGroup>
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>


        {/* Session Manager Overlay - full screen */}
        {contentView.type === 'session-manager' && (
          <div className="absolute inset-0 z-20 bg-content-background">
            <SessionManager
              onClose={() => setContentView({ type: 'conversation' })}
            />
          </div>
        )}

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

        {/* Keyboard Shortcuts Dialog (Cmd+/) */}
        <KeyboardShortcutsDialog
          open={showShortcuts}
          onOpenChange={setShowShortcuts}
        />

        {/* Update Checker - disabled until remote URL is configured
        <UpdateChecker />
        */}
        </div>
      </TooltipProvider>
    </ToastProvider>
  );
}
