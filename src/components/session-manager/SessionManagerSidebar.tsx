'use client';

import type { WorktreeSession, Workspace } from '@/lib/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WorkspaceTreeItem } from './WorkspaceTreeItem';
import { Plus, Folder, Globe, Github, History } from 'lucide-react';

interface SessionManagerSidebarProps {
  workspaces: Workspace[];
  sessions: WorktreeSession[];
  selectedSessionId: string | null;
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
}

export function SessionManagerSidebar({
  workspaces,
  sessions,
  selectedSessionId,
  onSelectSession,
  onOpenProject,
  onCloneFromUrl,
}: SessionManagerSidebarProps) {
  const { collapsedWorkspaces, toggleWorkspaceCollapsed } = useSettingsStore();

  // Get sessions for a workspace (non-archived only)
  const getWorkspaceSessions = (workspaceId: string) => {
    return sessions.filter(
      (s) => s.workspaceId === workspaceId && !s.archived
    );
  };

  // Check if workspace is expanded
  const isWorkspaceExpanded = (workspaceId: string) => {
    return !collapsedWorkspaces.includes(workspaceId);
  };

  return (
    <div className="flex flex-col h-full bg-sidebar border-r">
      {/* Header */}
      <div className="h-10 flex items-center px-3 border-b shrink-0">
        <History className="h-4 w-4 text-muted-foreground mr-2" />
        <span className="text-sm font-semibold">History</span>
      </div>

      {/* Workspace tree */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {workspaces.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <p className="text-xs text-muted-foreground">No workspaces</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Add a repository to get started
              </p>
            </div>
          ) : (
            workspaces.map((workspace) => (
              <WorkspaceTreeItem
                key={workspace.id}
                workspace={workspace}
                sessions={getWorkspaceSessions(workspace.id)}
                isExpanded={isWorkspaceExpanded(workspace.id)}
                selectedSessionId={selectedSessionId}
                onToggle={() => toggleWorkspaceCollapsed(workspace.id)}
                onSelectSession={(sessionId) =>
                  onSelectSession(workspace.id, sessionId)
                }
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer with add button */}
      <div className="p-2 border-t">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add repository
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={onOpenProject}>
              <Folder className="h-4 w-4" />
              Open project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCloneFromUrl}>
              <Globe className="h-4 w-4" />
              Clone from URL
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Github className="h-4 w-4" />
              GitHub Repos
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
