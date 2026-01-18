'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { listRepos, listSessions, listConversations, type RepoDTO, type SessionDTO, type ConversationDTO, type MessageDTO } from '@/lib/api';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { WorkspaceManagement } from '@/components/WorkspaceManagement';
import { TopBar } from '@/components/TopBar';
import { ConversationArea } from '@/components/ConversationArea';
import { ChatInput } from '@/components/ChatInput';
import { ChangesPanel } from '@/components/ChangesPanel';
import { AddWorkspaceModal } from '@/components/AddWorkspaceModal';
import { UpdateChecker } from '@/components/UpdateChecker';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';

export default function Home() {
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [showWorkspaceManagement, setShowWorkspaceManagement] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const leftSidebarRef = useRef<HTMLDivElement>(null);

  // Track left sidebar width for overlay positioning
  useEffect(() => {
    const el = leftSidebarRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSidebarWidth(entry.contentRect.width);
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
    selectedSessionId,
    selectedConversationId,
    setWorkspaces,
    setSessions,
    setConversations,
    addConversation,
    selectWorkspace,
    selectSession,
    selectConversation,
  } = useAppStore();

  // Connect WebSocket for real-time updates
  useWebSocket();

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
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }), []);

  // Map backend MessageDTO to frontend Message
  const messageToMessage = useCallback((msg: MessageDTO, conversationId: string) => ({
    id: msg.id,
    conversationId,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
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

  // Load data from backend
  useEffect(() => {
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
  }, [repoToWorkspace, sessionToWorktreeSession, conversationToConversation, setWorkspaces, setSessions, setConversations, selectWorkspace, selectSession, addConversation, selectConversation]);

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
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sessions, conversations, selectSession, selectConversation]);

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

  return (
    <TooltipProvider>
      <div className="h-screen overflow-hidden flex relative">
        {/* Main Layout */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Left Sidebar - Workspaces */}
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
              />
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* Main Content */}
          <ResizablePanel id="main-content" defaultSize={48} minSize="300px">
            <div className="flex flex-col h-full">
              <TopBar />
              <ConversationArea>
                <ChatInput />
              </ConversationArea>
            </div>
          </ResizablePanel>

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
        </ResizablePanelGroup>

        {/* Workspace Management Overlay - covers main content and right sidebar */}
        {showWorkspaceManagement && (
          <div
            className="absolute inset-0 z-10 bg-background"
            style={{ left: sidebarWidth + 1 }}
          >
            <WorkspaceManagement
              onSelectSession={handleSelectSessionFromManagement}
              onBack={() => setShowWorkspaceManagement(false)}
            />
          </div>
        )}

        {/* Add Workspace Modal */}
        <AddWorkspaceModal
          isOpen={showAddWorkspace}
          onClose={() => setShowAddWorkspace(false)}
        />

        {/* Update Checker */}
        <UpdateChecker />
      </div>
    </TooltipProvider>
  );
}
