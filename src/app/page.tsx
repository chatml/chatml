'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { listRepos, listAgents, type RepoDTO, type AgentDTO } from '@/lib/api';
import { ActivityBar, type ActivityView } from '@/components/ActivityBar';
import { WorkspaceSidebar } from '@/components/WorkspaceSidebar';
import { SearchPanel } from '@/components/SearchPanel';
import { AgentsPanel } from '@/components/AgentsPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { TopBar } from '@/components/TopBar';
import { ConversationArea } from '@/components/ConversationArea';
import { ChatInput } from '@/components/ChatInput';
import { ChangesPanel } from '@/components/ChangesPanel';
import { AddWorkspaceModal } from '@/components/AddWorkspaceModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';

export default function Home() {
  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [activeView, setActiveView] = useState<ActivityView>('workspaces');

  const {
    workspaces,
    sessions,
    conversations,
    selectedSessionId,
    selectedConversationId,
    setWorkspaces,
    setSessions,
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

  // Map backend Agent to frontend WorktreeSession
  const agentToSession = useCallback((agent: AgentDTO) => ({
    id: agent.id,
    workspaceId: agent.repoId,
    name: agent.branch,
    branch: agent.branch,
    worktreePath: agent.worktree,
    task: agent.task,
    status: agent.status === 'running' ? 'active' as const : agent.status as 'idle' | 'done' | 'error',
    createdAt: agent.createdAt,
    updatedAt: agent.createdAt,
  }), []);

  // Load data from backend
  useEffect(() => {
    async function loadData() {
      try {
        // Fetch repos from backend
        const repos = await listRepos();
        const mappedWorkspaces = repos.map(repoToWorkspace);
        setWorkspaces(mappedWorkspaces);

        // Fetch agents for each repo
        const allSessions = [];
        for (const repo of repos) {
          const agents = await listAgents(repo.id);
          allSessions.push(...agents.map(agentToSession));
        }
        setSessions(allSessions);

        // Select first workspace and session if available
        if (mappedWorkspaces.length > 0) {
          selectWorkspace(mappedWorkspaces[0].id);
          const firstSession = allSessions.find(s => s.workspaceId === mappedWorkspaces[0].id);
          if (firstSession) {
            selectSession(firstSession.id);
            // Create a conversation for this session if none exists
            const convId = `conv-${firstSession.id}`;
            addConversation({
              id: convId,
              sessionId: firstSession.id,
              title: firstSession.task || 'New conversation',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            selectConversation(convId);
          }
        }
      } catch (error) {
        console.error('Failed to load data from backend:', error);
      }
    }

    loadData();
  }, [repoToWorkspace, agentToSession, setWorkspaces, setSessions, selectWorkspace, selectSession, addConversation, selectConversation]);

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
      // Cmd+1-4 to switch activity views
      if (e.metaKey && !e.shiftKey && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const views: ActivityView[] = ['workspaces', 'search', 'agents', 'history'];
        const index = parseInt(e.key) - 1;
        if (views[index]) {
          setActiveView(views[index]);
        }
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

  const renderSidebarContent = () => {
    switch (activeView) {
      case 'workspaces':
        return <WorkspaceSidebar onAddWorkspace={() => setShowAddWorkspace(true)} />;
      case 'search':
        return <SearchPanel />;
      case 'agents':
        return <AgentsPanel />;
      case 'history':
        return <HistoryPanel />;
      default:
        return <WorkspaceSidebar onAddWorkspace={() => setShowAddWorkspace(true)} />;
    }
  };

  return (
    <TooltipProvider>
      <div className="h-screen overflow-hidden flex">
        {/* Activity Bar */}
        <ActivityBar activeView={activeView} onViewChange={setActiveView} />

        {/* Main Layout */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Left Sidebar - Dynamic based on activeView */}
          <ResizablePanel
            id="left-sidebar"
            defaultSize="18%"
            minSize="200px"
            maxSize="400px"
          >
            {renderSidebarContent()}
          </ResizablePanel>

        <ResizableHandle />

        {/* Main Content */}
        <ResizablePanel id="main-content" defaultSize="57%" minSize="300px">
          <div className="flex flex-col h-full">
            <TopBar />
            <ConversationArea>
              <ChatInput />
            </ConversationArea>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Right Sidebar - Changes (full height with own header) */}
        <ResizablePanel
          id="right-sidebar"
          defaultSize="25%"
          minSize="250px"
          maxSize="500px"
        >
          <ChangesPanel />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Add Workspace Modal */}
        <AddWorkspaceModal
          isOpen={showAddWorkspace}
          onClose={() => setShowAddWorkspace(false)}
        />
      </div>
    </TooltipProvider>
  );
}
