'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { isTauri, safeListen, closeWindow } from '@/lib/tauri';
import { CloseTabConfirmDialog } from '@/components/CloseTabConfirmDialog';
import { useWebSocket } from '@/hooks/useWebSocket';
import { listRepos, listSessions, listConversations, createSession, createConversation, deleteConversation, type RepoDTO, type SessionDTO, type ConversationDTO, type MessageDTO } from '@/lib/api';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { WorkspaceManagement } from '@/components/WorkspaceManagement';
import { SettingsPage } from '@/components/SettingsPage';
import { TopBar } from '@/components/TopBar';
import { ConversationArea } from '@/components/ConversationArea';
import { ChatInput } from '@/components/ChatInput';
import { ChangesPanel } from '@/components/ChangesPanel';
import { AddWorkspaceModal } from '@/components/AddWorkspaceModal';
import { UpdateChecker } from '@/components/UpdateChecker';
import { BackendStatus } from '@/components/BackendStatus';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';

export default function Home() {
  const [backendConnected, setBackendConnected] = useState(false);
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showWorkspaceManagement, setShowWorkspaceManagement] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(250); // Default until measured
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingCloseConvId, setPendingCloseConvId] = useState<string | null>(null);
  const leftSidebarRef = useRef<HTMLDivElement>(null);

  const confirmCloseActiveTab = useSettingsStore((s) => s.confirmCloseActiveTab);

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
    setWorkspaces,
    setSessions,
    setConversations,
    addSession,
    addConversation,
    removeConversation,
    selectWorkspace,
    selectSession,
    selectConversation,
  } = useAppStore();

  // Connect WebSocket for real-time updates (only when backend is connected)
  useWebSocket(backendConnected);

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
      try {
        // Fetch repos from backend
        const repos = await listRepos();
        const mappedWorkspaces = repos.map(repoToWorkspace);
        setWorkspaces(mappedWorkspaces);

        // Fetch sessions for each workspace
        const allSessions = [];
        for (const repo of repos) {
          const sessions = await listSessions(repo.id);
          allSessions.push(...sessions.map(sessionToWorktreeSession));
        }
        setSessions(allSessions);

        // Fetch conversations for each session
        const allConversations = [];
        for (const session of allSessions) {
          const convs = await listConversations(session.workspaceId, session.id);
          allConversations.push(...convs.map(conversationToConversation));
        }
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+N to add workspace
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowAddWorkspace(true);
      }
      // Cmd+K for command palette (future)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // TODO: Open command palette
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
      // Cmd+W to close tab
      if (e.key === 'w' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        handleCloseTab();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessions, conversations, workspaces, selectedWorkspaceId, selectSession, selectConversation, handleCloseTab]);

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
        case 'toggle_left_sidebar':
          setShowLeftSidebar((prev) => !prev);
          break;
        case 'toggle_right_sidebar':
          setShowRightSidebar((prev) => !prev);
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
          console.log('Unhandled menu event:', menuId);
      }
    }).then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, [handleNewSession, handleNewConversation, handleCloseTab]);

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

  // Show connection screen until backend is ready
  if (!backendConnected) {
    return (
      <BackendStatus
        onConnected={() => setBackendConnected(true)}
        maxRetries={15}
        initialDelay={300}
      />
    );
  }

  return (
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
                  <WorkspaceSidebar
                    onAddWorkspace={() => setShowAddWorkspace(true)}
                    onShowWorkspaceManagement={() => setShowWorkspaceManagement(true)}
                    onSessionSelected={() => setShowWorkspaceManagement(false)}
                    onOpenSettings={() => setShowSettings(true)}
                    onToggleSidebar={() => setShowLeftSidebar(false)}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle />
            </>
          )}

          {/* Main Content */}
          <ResizablePanel id="main-content" defaultSize={48} minSize="300px">
            <div className="flex flex-col h-full">
              <TopBar
                showLeftSidebar={showLeftSidebar}
                showRightSidebar={showRightSidebar}
                onToggleLeftSidebar={() => setShowLeftSidebar((prev) => !prev)}
                onToggleRightSidebar={() => setShowRightSidebar((prev) => !prev)}
              />
              <ConversationArea>
                <ChatInput />
              </ConversationArea>
            </div>
          </ResizablePanel>

          {showRightSidebar && (
            <>
              <ResizableHandle />

              {/* Right Sidebar */}
              <ResizablePanel
                id="right-sidebar"
                defaultSize={30}
                minSize="250px"
                maxSize="500px"
              >
                <ChangesPanel />
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

        {/* Close Tab Confirmation Dialog */}
        <CloseTabConfirmDialog
          open={showCloseConfirm}
          onOpenChange={setShowCloseConfirm}
          conversationName={conversations.find((c) => c.id === pendingCloseConvId)?.name || 'Conversation'}
          onConfirm={handleConfirmClose}
        />

        {/* Update Checker */}
        <UpdateChecker />
      </div>
    </TooltipProvider>
  );
}
