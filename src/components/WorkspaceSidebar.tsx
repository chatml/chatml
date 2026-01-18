'use client';

import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Zap,
  Plus,
  MoreHorizontal,
  GitBranch,
  HelpCircle,
  Settings,
  FolderPlus,
  ChevronRight,
  FolderOpen,
  Terminal,
  Trash2,
  Copy,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceSidebarProps {
  onAddWorkspace: () => void;
}

export function WorkspaceSidebar({ onAddWorkspace }: WorkspaceSidebarProps) {
  const {
    workspaces,
    sessions,
    selectedWorkspaceId,
    selectedSessionId,
    selectWorkspace,
    selectSession,
  } = useAppStore();

  // Track which workspaces are expanded (default all expanded)
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set(workspaces.map((w) => w.id))
  );

  const toggleWorkspace = (workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  const getWorkspaceSessions = (workspaceId: string) => {
    return sessions.filter((s) => s.workspaceId === workspaceId);
  };

  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-500';
      case 'idle':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="h-11 px-3 flex items-center gap-2 border-b bg-sidebar shrink-0">
        <div className="w-6 h-6 rounded-md bg-primary/20 flex items-center justify-center">
          <Zap className="w-3.5 h-3.5 text-primary" />
        </div>
        <span className="text-sm font-semibold">ChatML</span>
      </div>

      {/* Workspace List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {workspaces.length === 0 ? (
            <div className="px-3 py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                <FolderPlus className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No workspaces</p>
              <p className="text-xs text-muted-foreground/70 mt-1 mb-4">
                Add a repository to get started
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={onAddWorkspace}
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add repository
              </Button>
            </div>
          ) : (
            workspaces.map((workspace) => {
              const workspaceSessions = getWorkspaceSessions(workspace.id);
              const isExpanded = expandedWorkspaces.has(workspace.id);

              return (
                <Collapsible
                  key={workspace.id}
                  open={isExpanded}
                  onOpenChange={() => toggleWorkspace(workspace.id)}
                  className="mb-1"
                >
                  {/* Workspace Header */}
                  <div
                    className={cn(
                      'group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer',
                      'hover:bg-sidebar-accent transition-colors'
                    )}
                  >
                    <CollapsibleTrigger asChild>
                      <button className="p-0.5 hover:bg-sidebar-accent rounded">
                        <ChevronRight
                          className={cn(
                            'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-90'
                          )}
                        />
                      </button>
                    </CollapsibleTrigger>
                    <div
                      className="flex-1 flex items-center gap-2 min-w-0"
                      onClick={() => selectWorkspace(workspace.id)}
                    >
                      <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">
                        {getInitial(workspace.name)}
                      </div>
                      <span className="flex-1 text-sm font-medium truncate">
                        {workspace.name}
                      </span>
                    </div>
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 hover:bg-sidebar-accent"
                        onClick={(e) => {
                          e.stopPropagation();
                          // TODO: Create new session
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 hover:bg-sidebar-accent"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem>
                            <FolderOpen className="h-4 w-4 mr-2" />
                            Open in Finder
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Terminal className="h-4 w-4 mr-2" />
                            Open in Terminal
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="h-4 w-4 mr-2" />
                            Copy path
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Sessions */}
                  <CollapsibleContent>
                    <div className="ml-3 pl-3 border-l border-sidebar-border">
                      {workspaceSessions.length === 0 ? (
                        <div className="py-2 px-2 text-xs text-muted-foreground/70">
                          No active sessions
                        </div>
                      ) : (
                        workspaceSessions.map((session, sessionIndex) => {
                          const isSessionSelected = selectedSessionId === session.id;

                          return (
                            <div
                              key={session.id}
                              className={cn(
                                'group flex items-start gap-2 px-2 py-2 rounded-md cursor-pointer my-0.5',
                                isSessionSelected
                                  ? 'bg-sidebar-accent'
                                  : 'hover:bg-sidebar-accent/50 transition-colors'
                              )}
                              onClick={() => {
                                selectWorkspace(workspace.id);
                                selectSession(session.id);
                              }}
                            >
                              <div className="mt-0.5">
                                <Circle className={cn('w-2 h-2 fill-current', getStatusColor(session.status))} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                                  <span className="text-sm font-medium truncate">
                                    {session.name}
                                  </span>
                                </div>
                                {session.task && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                                    {session.task}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  {session.stats && (
                                    <span className="text-[10px] font-mono">
                                      <span className="text-green-500">+{session.stats.additions}</span>
                                      {' '}
                                      <span className="text-red-500">-{session.stats.deletions}</span>
                                    </span>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatTimeAgo(session.updatedAt)}
                                  </span>
                                </div>
                              </div>
                              {sessionIndex < 9 && (
                                <span className="kbd shrink-0">⌘{sessionIndex + 1}</span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 h-8 text-muted-foreground hover:text-foreground"
          onClick={onAddWorkspace}
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">Add repository</span>
        </Button>
        <div className="flex items-center gap-1 mt-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <HelpCircle className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
