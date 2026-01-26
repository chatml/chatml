'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { updateSession as updateSessionApi } from '@/lib/api';
import { SessionManagerSidebar } from './SessionManagerSidebar';
import { SessionsListView } from './SessionsListView';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Settings,
  Keyboard,
  MoreVertical,
  BookOpen,
  MessageCircle,
  ExternalLink,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionManagerProps {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onClose: () => void;
}

export function SessionManager({
  onOpenSettings,
  onOpenShortcuts,
  onOpenProject,
  onCloneFromUrl,
  onClose,
}: SessionManagerProps) {
  const [filter, setFilter] = useState('');

  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const selectWorkspace = useAppStore((s) => s.selectWorkspace);
  const selectSession = useAppStore((s) => s.selectSession);
  const unarchiveSession = useAppStore((s) => s.unarchiveSession);
  const setContentView = useSettingsStore((s) => s.setContentView);
  const { expandWorkspace } = useSettingsStore();
  const leftToolbarBg = useUIStore((state) => state.toolbarBackgrounds.left);

  // Handle session selection - navigate to conversation view
  const handleSelectSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      selectWorkspace(workspaceId);
      expandWorkspace(workspaceId);
      selectSession(sessionId);
      setContentView({ type: 'conversation' });
    },
    [selectWorkspace, expandWorkspace, selectSession, setContentView]
  );

  // Handle unarchive session
  const handleUnarchiveSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;

      try {
        // Update backend
        await updateSessionApi(session.workspaceId, sessionId, { archived: false });
        // Update local store
        unarchiveSession(sessionId);
      } catch (error) {
        console.error('Failed to unarchive session:', error);
      }
    },
    [sessions, unarchiveSession]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        data-tauri-drag-region
        className={cn('h-10 flex items-center border-b shrink-0 pr-1 pl-20', leftToolbarBg)}
      >
        <h1 className="text-sm font-medium ml-3">Session Manager</h1>

        <div className="flex-1" />

        {/* Common actions */}
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="More options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenSettings}>
                <Settings className="size-4" />
                Settings
                <span className="ml-auto text-xs text-muted-foreground">
                  ⌘,
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenShortcuts}>
                <Keyboard className="size-4" />
                Keyboard Shortcuts
                <span className="ml-auto text-xs text-muted-foreground">
                  ⌘/
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  window.open('https://docs.chatml.dev', '_blank')
                }
              >
                <BookOpen className="size-4" />
                Documentation
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  window.open(
                    'https://github.com/chatml/chatml/issues',
                    '_blank'
                  )
                }
              >
                <MessageCircle className="size-4" />
                Send Feedback
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Content: Two-column layout */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left sidebar: Workspace tree */}
        <ResizablePanel
          id="session-manager-sidebar"
          defaultSize={25}
          minSize="200px"
          maxSize="350px"
        >
          <SessionManagerSidebar
            workspaces={workspaces}
            sessions={sessions}
            selectedSessionId={null}
            onSelectSession={handleSelectSession}
            onOpenProject={onOpenProject}
            onCloneFromUrl={onCloneFromUrl}
          />
        </ResizablePanel>

        <ResizableHandle direction="horizontal" />

        {/* Main content: Sessions list */}
        <ResizablePanel id="sessions-list" defaultSize={75} minSize={40}>
          <SessionsListView
            workspaces={workspaces}
            sessions={sessions}
            filter={filter}
            onFilterChange={setFilter}
            onSelectSession={handleSelectSession}
            onUnarchiveSession={handleUnarchiveSession}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
