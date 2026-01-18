'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
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
    addWorkspace,
    addSession,
    addConversation,
    selectWorkspace,
    selectSession,
    selectConversation,
    setFileChanges,
  } = useAppStore();

  // Initialize with demo data for development
  useEffect(() => {
    if (workspaces.length === 0) {
      // Demo workspaces
      const workspace1 = {
        id: 'ws-1',
        name: 'readingminds-next',
        path: '/Users/dev/readingminds-next',
        defaultBranch: 'origin/main',
        createdAt: new Date().toISOString(),
      };
      const workspace2 = {
        id: 'ws-2',
        name: 'opensummary',
        path: '/Users/dev/opensummary',
        defaultBranch: 'origin/main',
        createdAt: new Date().toISOString(),
      };
      const workspace3 = {
        id: 'ws-3',
        name: 'maisonkelly',
        path: '/Users/dev/maisonkelly',
        defaultBranch: 'origin/main',
        createdAt: new Date().toISOString(),
      };
      addWorkspace(workspace1);
      addWorkspace(workspace2);
      addWorkspace(workspace3);

      // Demo sessions for workspace 1
      const session1 = {
        id: 'sess-1',
        workspaceId: 'ws-1',
        name: 'zagreb-v1',
        branch: 'zagreb-v1',
        worktreePath: '/Users/dev/readingminds-next/.worktrees/zagreb-v1',
        task: 'Answer question',
        status: 'active' as const,
        stats: { additions: 10, deletions: 5 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const session2 = {
        id: 'sess-2',
        workspaceId: 'ws-1',
        name: 'dakar-v2',
        branch: 'dakar-v2',
        worktreePath: '/Users/dev/readingminds-next/.worktrees/dakar-v2',
        task: 'Monorepo reorganization',
        status: 'active' as const,
        stats: { additions: 106, deletions: 126 },
        createdAt: new Date(Date.now() - 600000).toISOString(),
        updatedAt: new Date(Date.now() - 600000).toISOString(),
      };
      addSession(session1);
      addSession(session2);

      // Demo conversation
      const conversation = {
        id: 'conv-1',
        sessionId: 'sess-2',
        title: 'Continuing the conversation',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addConversation(conversation);

      // Demo file changes
      setFileChanges([
        { path: 'apps/admin/package.json', additions: 1, deletions: 0, status: 'modified' },
        { path: 'apps/admin/tsconfig.json', additions: 1, deletions: 18, status: 'modified' },
        { path: 'apps/docs/package.json', additions: 1, deletions: 0, status: 'modified' },
        { path: 'apps/docs/tsconfig.json', additions: 2, deletions: 26, status: 'modified' },
        { path: 'apps/emma/package.json', additions: 1, deletions: 0, status: 'modified' },
        { path: 'apps/emma/tsconfig.json', additions: 2, deletions: 26, status: 'modified' },
        { path: 'apps/web/package.json', additions: 1, deletions: 0, status: 'modified' },
        { path: 'apps/web/tsconfig.json', additions: 1, deletions: 18, status: 'modified' },
        { path: 'e2e/package.json', additions: 1, deletions: 0, status: 'modified' },
        { path: 'e2e/tsconfig.json', additions: 1, deletions: 7, status: 'modified' },
        { path: 'packages/ui/package.json', additions: 1, deletions: 0, status: 'modified' },
        { path: 'packages/ui/tsconfig.json', additions: 1, deletions: 16, status: 'modified' },
      ]);

      // Select the second session and conversation by default
      selectWorkspace('ws-1');
      selectSession('sess-2');
      selectConversation('conv-1');
    }
  }, []);

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
