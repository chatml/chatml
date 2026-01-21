'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { OnboardingScreen } from '@/components/OnboardingScreen';
import { initAuth, listenForOAuthCallback } from '@/lib/auth';
import { isTauri, safeListen, closeWindow, openFolderDialog } from '@/lib/tauri';
import { CloseTabConfirmDialog } from '@/components/CloseTabConfirmDialog';
import { CloseFileConfirmDialog } from '@/components/CloseFileConfirmDialog';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useTabPersistence } from '@/hooks/useTabPersistence';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFileWatcher } from '@/hooks/useFileWatcher';
import { listRepos, listSessions, listConversations, createSession, createConversation, deleteConversation, addRepo, getSessionChanges, type RepoDTO, type SessionDTO, type ConversationDTO, type MessageDTO } from '@/lib/api';
import type { SetupInfo } from '@/lib/types';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { WorkspaceManagement } from '@/components/WorkspaceManagement';
import { SettingsPage } from '@/components/SettingsPage';
import { TopBar } from '@/components/TopBar';
import { ConversationArea } from '@/components/ConversationArea';
import { ChatInput } from '@/components/ChatInput';
import { ChangesPanel } from '@/components/ChangesPanel';
import { BottomTerminal } from '@/components/BottomTerminal';
import { AddWorkspaceModal } from '@/components/AddWorkspaceModal';
import { CloneFromUrlDialog } from '@/components/CloneFromUrlDialog';
import { QuickStartDialog } from '@/components/QuickStartDialog';
import { FilePicker } from '@/components/FilePicker';
// import { UpdateChecker } from '@/components/UpdateChecker';
import { BackendStatus } from '@/components/BackendStatus';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastProvider } from '@/components/ui/toast';
import { HEALTH_CHECK_MAX_RETRIES, HEALTH_CHECK_INITIAL_DELAY_MS } from '@/lib/constants';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';

// Pre-computed skeleton widths (avoids Math.random() during render)
const SKELETON_WIDTHS = [72, 88, 65, 81];

// Generate a random branch name for new sessions
function generateBranchName(): string {
  const adjectives = ['quick', 'bright', 'swift', 'calm', 'bold', 'keen', 'warm', 'cool'];
  const nouns = ['fox', 'owl', 'bear', 'wolf', 'hawk', 'deer', 'lion', 'sage'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}

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
  const [backendConnected, setBackendConnected] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showWorkspaceManagement, setShowWorkspaceManagement] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(250); // Default until measured
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingCloseConvId, setPendingCloseConvId] = useState<string | null>(null);
  const [showCloneFromUrl, setShowCloneFromUrl] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  const leftSidebarRef = useRef<HTMLDivElement>(null);

  const confirmCloseActiveTab = useSettingsStore((s) => s.confirmCloseActiveTab);
  const { showBottomTerminal, setShowBottomTerminal } = useSettingsStore();

  const { isLoading: authLoading, isAuthenticated, setAuthenticated, setError } = useAuthStore();

  // Initialize auth on mount
  useEffect(() => {
    let unlistenOAuth: (() => void) | null = null;

    const init = async () => {
      // Set up OAuth callback listener first
      try {
        unlistenOAuth = await listenForOAuthCallback(
          (result) => {
            setAuthenticated(true, result.user);
          },
          (error) => {
            setError(error.message);
          }
        );
      } catch {
        // Listener setup failed (not in Tauri), continue anyway
      }

      // Check for existing auth
      try {
        const status = await initAuth();
        setAuthenticated(status.authenticated, status.user);
      } catch {
        setAuthenticated(false);
      }
    };

    init();

    return () => {
      if (unlistenOAuth) unlistenOAuth();
    };
  }, [setAuthenticated, setError]);

  // Use ref to avoid changing useEffect dependency array sizes
  const showBottomTerminalRef = useRef(showBottomTerminal);
  useEffect(() => {
    showBottomTerminalRef.current = showBottomTerminal;
  }, [showBottomTerminal]);

  // Track left sidebar width for overlay positioning
  useEffect(() => {
    const el = leftSidebarRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Use offsetWidth to include padding/borders
        setSidebarWidth(el.offsetWidth);
      }
    });
    observer.observe(el);

    // Initial measurement
    setSidebarWidth(el.offsetWidth);

    return () => observer.disconnect();
  }, []);

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
    selectFileTab,
    pendingCloseFileTabId,
    setPendingCloseFileTabId,
  } = useAppStore();

  const { expandWorkspace } = useSettingsStore();

  // Connect WebSocket for real-time updates (only when backend is connected)
  useWebSocket(backendConnected);

  // Persist file tabs to backend
  useTabPersistence();

  // Auto-save dirty file tabs
  const { saveCurrentTab, saveTab } = useAutoSave();

  // Watch for external file changes
  useFileWatcher();

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
    status: conv.status,
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
  useEffect(() => {
    if (!backendConnected) return;

    async function loadData() {
      setIsLoadingData(true);
      try {
        // Fetch repos from backend
        const repos = await listRepos();
        const mappedWorkspaces = repos.map(repoToWorkspace);
        setWorkspaces(mappedWorkspaces);

        // Fetch sessions for all workspaces in parallel
        const sessionResults = await Promise.all(
          repos.map(repo => listSessions(repo.id))
        );
        const allSessions = sessionResults.flatMap(sessions =>
          sessions.map(s => sessionToWorktreeSession(s))
        );

        // Fetch file changes for all sessions to compute stats
        const sessionsWithStats = await Promise.all(
          allSessions.map(async (session) => {
            try {
              const changes = await getSessionChanges(session.workspaceId, session.id);
              if (changes && changes.length > 0) {
                const stats = changes.reduce(
                  (acc, change) => ({
                    additions: acc.additions + change.additions,
                    deletions: acc.deletions + change.deletions,
                  }),
                  { additions: 0, deletions: 0 }
                );
                return { ...session, stats };
              }
            } catch {
              // Ignore errors fetching changes
            }
            return session;
          })
        );
        setSessions(sessionsWithStats);

        // Fetch conversations for all sessions in parallel
        const conversationResults = await Promise.all(
          allSessions.map(session =>
            listConversations(session.workspaceId, session.id)
          )
        );
        const allConversations = conversationResults.flatMap(convs =>
          convs.map(conversationToConversation)
        );
        setConversations(allConversations);

        // Select first workspace and session if available
        if (mappedWorkspaces.length > 0) {
          selectWorkspace(mappedWorkspaces[0].id);
          const firstSession = allSessions.find(s => s.workspaceId === mappedWorkspaces[0].id);
          if (firstSession) {
            selectSession(firstSession.id);
            // Select existing conversation or create a new one if none exists
            const sessionConvs = allConversations.filter(c => c.sessionId === firstSession.id);
            if (sessionConvs.length > 0) {
              selectConversation(sessionConvs[0].id);
            } else {
              // Create a placeholder conversation only if none exist
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
              selectConversation(convId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to load data from backend:', error);
      } finally {
        setIsLoadingData(false);
      }
    }

    loadData();
  }, [backendConnected, repoToWorkspace, sessionToWorktreeSession, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, addConversation, selectConversation]);

  // Menu action handlers
  const handleNewSession = useCallback(async () => {
    if (!selectedWorkspaceId) return;

    const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
    if (!workspace) return;

    try {
      // Generate a unique session name
      const workspaceSessions = sessions.filter((s) => s.workspaceId === selectedWorkspaceId);
      const sessionNumber = workspaceSessions.length + 1;
      const branchName = `session-${sessionNumber}-${Date.now().toString(36)}`;

      const newSession = await createSession(selectedWorkspaceId, {
        name: `Session ${sessionNumber}`,
        branch: branchName,
        worktreePath: `${workspace.path}/.worktrees/${branchName}`,
      });

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
  }, [selectedWorkspaceId, workspaces, sessions, addSession, selectSession]);

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
    }
  }, [selectedSessionId, conversations, removeConversation, selectConversation]);

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

      // Auto-create first session for the new workspace
      const branchName = generateBranchName();
      const session = await createSession(workspace.id, {
        name: branchName,
        branch: branchName,
        worktreePath: '',
      });

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
  }, [pendingCloseFileTabId, fileTabs, saveTab, closeFileTab]);

  // Close dirty file without saving
  const handleDontSaveAndCloseFile = useCallback(() => {
    if (!pendingCloseFileTabId) return;
    closeFileTab(pendingCloseFileTabId);
    setPendingCloseFileTabId(null);
  }, [pendingCloseFileTabId, closeFileTab]);

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
        setShowLeftSidebar((prev) => !prev);
      }
      // Cmd+Option+B to toggle right sidebar
      if (e.code === 'KeyB' && (e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey) {
        e.preventDefault();
        setShowRightSidebar((prev) => !prev);
      }
      // Ctrl+` to toggle bottom terminal (Cmd+` is reserved by macOS for window switching)
      if (e.key === '`' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
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
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessions, conversations, workspaces, selectedWorkspaceId, selectedFileTabId, selectSession, selectConversation, handleCloseTab, setShowBottomTerminal, selectNextTab, selectPreviousTab, handleCloseFileTab, saveCurrentTab]);

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
          setShowLeftSidebar((prev) => !prev);
          break;
        case 'toggle_right_sidebar':
          setShowRightSidebar((prev) => !prev);
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
  }, [handleNewSession, handleNewConversation, handleCloseTab, setShowBottomTerminal, saveCurrentTab]);

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


  // Handle selecting a session from workspace management view
  const handleSelectSessionFromManagement = useCallback((workspaceId: string, sessionId: string) => {
    selectWorkspace(workspaceId);
    selectSession(sessionId);
    // Select first conversation for that session
    const sessionConvs = conversations.filter((c) => c.sessionId === sessionId);
    if (sessionConvs.length > 0) {
      selectConversation(sessionConvs[0].id);
    }
    // Exit workspace management view
    setShowWorkspaceManagement(false);
  }, [conversations, selectWorkspace, selectSession, selectConversation]);

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
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
      <TooltipProvider>
        <div className="h-screen overflow-hidden flex relative">
        {/* Main Layout */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Left Sidebar - Workspaces */}
          {showLeftSidebar && (
            <>
              <ResizablePanel
                id="left-sidebar"
                defaultSize={22}
                minSize="200px"
                maxSize="400px"
              >
                <div ref={leftSidebarRef} className="h-full">
                  <ErrorBoundary section="Sidebar">
                    <WorkspaceSidebar
                      onOpenProject={handleOpenProject}
                      onCloneFromUrl={() => setShowCloneFromUrl(true)}
                      onQuickStart={() => setShowQuickStart(true)}
                      onShowWorkspaceManagement={() => setShowWorkspaceManagement(true)}
                      onSessionSelected={() => setShowWorkspaceManagement(false)}
                      onOpenSettings={() => setShowSettings(true)}
                      onToggleSidebar={() => setShowLeftSidebar(false)}
                    />
                  </ErrorBoundary>
                </div>
              </ResizablePanel>

              <ResizableHandle />
            </>
          )}

          {/* Main Content */}
          <ResizablePanel id="main-content" defaultSize={48} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              {/* Conversation Area */}
              <ResizablePanel id="conversation" defaultSize={showBottomTerminal ? 70 : 100} minSize={20}>
                {isLoadingData ? (
                  <ConversationSkeleton />
                ) : (
                  <div className="flex flex-col h-full">
                    <TopBar
                      showLeftSidebar={showLeftSidebar}
                      showRightSidebar={showRightSidebar}
                      onToggleLeftSidebar={() => setShowLeftSidebar((prev) => !prev)}
                      onToggleRightSidebar={() => setShowRightSidebar((prev) => !prev)}
                    />
                    <ErrorBoundary section="Conversation">
                      <ConversationArea>
                        <ChatInput />
                      </ConversationArea>
                    </ErrorBoundary>
                  </div>
                )}
              </ResizablePanel>

              {/* Bottom Terminal - always mounted to preserve PTY session */}
              {showBottomTerminal && <ResizableHandle />}
              {selectedWorkspaceId && (
                <ResizablePanel
                  id="bottom-terminal"
                  defaultSize={showBottomTerminal ? "150px" : "0px"}
                  minSize={showBottomTerminal ? "100px" : "0px"}
                  maxSize={showBottomTerminal ? "500px" : "0px"}
                  style={{ overflow: showBottomTerminal ? 'visible' : 'hidden' }}
                >
                  <div className={showBottomTerminal ? 'h-full' : 'h-0 overflow-hidden'}>
                    <ErrorBoundary section="Terminal">
                      <BottomTerminal
                        workspaceId={selectedWorkspaceId}
                        workspacePath={workspaces.find((w) => w.id === selectedWorkspaceId)?.path || ''}
                        onHide={() => setShowBottomTerminal(false)}
                      />
                    </ErrorBoundary>
                  </div>
                </ResizablePanel>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {showRightSidebar && (
            <>
              <ResizableHandle />

              {/* Right Sidebar */}
              <ResizablePanel
                id="right-sidebar"
                defaultSize={22}
                minSize="250px"
                maxSize="500px"
              >
                <ErrorBoundary section="Changes">
                  <ChangesPanel />
                </ErrorBoundary>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>

        {/* Workspace Management Overlay - covers main content and right sidebar */}
        {showWorkspaceManagement && (
          <div
            className="absolute inset-0 z-10 bg-background"
            style={{ left: sidebarWidth + 5 }}
          >
            <WorkspaceManagement
              onSelectSession={handleSelectSessionFromManagement}
              onBack={() => setShowWorkspaceManagement(false)}
            />
          </div>
        )}

        {/* Settings Overlay - full screen */}
        {showSettings && (
          <div className="absolute inset-0 z-20 bg-background">
            <SettingsPage onBack={() => setShowSettings(false)} />
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
          conversationName={conversations.find((c) => c.id === pendingCloseConvId)?.name || 'Conversation'}
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

        {/* Update Checker - disabled until remote URL is configured
        <UpdateChecker />
        */}
        </div>
      </TooltipProvider>
    </ToastProvider>
  );
}
