'use client';

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { createSession as createSessionApi, listConversations as listConversationsApi, deleteSession as deleteSessionApi, updateSession as updateSessionApi } from '@/lib/api';
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
  Plus,
  MoreHorizontal,
  GitBranch,
  GitPullRequest,
  FolderPlus,
  ChevronDown,
  FolderOpen,
  Terminal,
  Trash2,
  Copy,
  GripVertical,
  Archive,
  Settings,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pin,
  PanelLeftClose,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Workspace, WorktreeSession, SetupInfo } from '@/lib/types';

// Generate a random branch name - moved outside component to avoid React purity warning
function generateBranchName(): string {
  const adjectives = ['quick', 'bright', 'swift', 'calm', 'bold', 'keen', 'warm', 'cool'];
  const nouns = ['fox', 'owl', 'bear', 'wolf', 'hawk', 'deer', 'lion', 'sage'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}

interface WorkspaceSidebarProps {
  onAddWorkspace: () => void;
  onShowWorkspaceManagement?: () => void;
  onSessionSelected?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
}

export function WorkspaceSidebar({ onAddWorkspace, onShowWorkspaceManagement, onSessionSelected, onOpenSettings, onToggleSidebar }: WorkspaceSidebarProps) {
  const {
    workspaces,
    sessions,
    selectedWorkspaceId,
    selectedSessionId,
    selectWorkspace,
    selectSession,
    addSession,
    addConversation,
    selectConversation,
    reorderWorkspaces,
    archiveSession,
    updateSession,
  } = useAppStore();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderWorkspaces(active.id as string, over.id as string);
    }
  };

  // Track which workspaces are collapsed (persisted)
  const { collapsedWorkspaces, toggleWorkspaceCollapsed, expandWorkspace } = useSettingsStore();

  const isWorkspaceExpanded = (workspaceId: string) => {
    return !collapsedWorkspaces.includes(workspaceId);
  };

  const getWorkspaceSessions = (workspaceId: string) => {
    return sessions.filter((s) => s.workspaceId === workspaceId && !s.archived);
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

  const handleCreateSession = async (workspaceId: string) => {
    const branchName = generateBranchName();

    try {
      // Create session via backend API (backend auto-creates "Untitled" conversation)
      const session = await createSessionApi(workspaceId, {
        name: branchName,
        branch: branchName,
        worktreePath: '', // Will be set when agent starts
      });

      // Add to local store
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
      const conversations = await listConversationsApi(workspaceId, session.id);
      conversations.forEach((conv) => {
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

      // Expand the workspace if not already
      expandWorkspace(workspaceId);

      // Select the new session and first conversation
      selectWorkspace(workspaceId);
      selectSession(session.id);
      if (conversations.length > 0) {
        selectConversation(conversations[0].id);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleArchiveSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    try {
      // Delete from backend
      await deleteSessionApi(session.workspaceId, sessionId);
      // Update local store
      archiveSession(sessionId);
    } catch (error) {
      console.error('Failed to archive session:', error);
    }
  };

  const handlePinSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const newPinned = !session.pinned;

    try {
      // Update backend
      await updateSessionApi(session.workspaceId, sessionId, { pinned: newPinned });
      // Update local store
      updateSession(sessionId, { pinned: newPinned });
    } catch (error) {
      console.error('Failed to pin session:', error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header - pl-20 gives space for macOS traffic lights */}
      <div data-tauri-drag-region className="h-11 pl-20 pr-3 flex items-center justify-between border-b bg-sidebar shrink-0">
        <span className="text-sm font-semibold">ChatML</span>
        {onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleSidebar}
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Workspaces Section Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer hover:bg-sidebar-accent/50 transition-colors"
        onClick={onShowWorkspaceManagement}
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Workspaces</span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">{sessions.filter(s => !s.archived).length} sessions</span>
      </div>

      {/* Workspace List */}
      <ScrollArea className="flex-1">
        <div className="py-2 px-1">
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={workspaces.map((w) => w.id)}
                strategy={verticalListSortingStrategy}
              >
                {workspaces.map((workspace) => (
                  <SortableWorkspaceItem
                    key={workspace.id}
                    workspace={workspace}
                    sessions={getWorkspaceSessions(workspace.id)}
                    isExpanded={isWorkspaceExpanded(workspace.id)}
                    selectedSessionId={selectedSessionId}
                    onToggle={() => toggleWorkspaceCollapsed(workspace.id)}
                    onCreateSession={() => handleCreateSession(workspace.id)}
                    onSelectSession={(sessionId) => {
                      selectWorkspace(workspace.id);
                      selectSession(sessionId);
                      onSessionSelected?.();
                    }}
                    onArchiveSession={handleArchiveSession}
                    onPinSession={handlePinSession}
                    getStatusColor={getStatusColor}
                    formatTimeAgo={formatTimeAgo}
                    getInitial={getInitial}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start gap-2 h-8 text-muted-foreground hover:text-foreground"
          onClick={onAddWorkspace}
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">Add repository</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
          onClick={onOpenSettings}
        >
          <Settings className="w-4 h-4" />
        </Button>
      </div>

      </div>
  );
}

interface SortableWorkspaceItemProps {
  workspace: Workspace;
  sessions: WorktreeSession[];
  isExpanded: boolean;
  selectedSessionId: string | null;
  onToggle: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onPinSession: (sessionId: string) => void;
  getStatusColor: (status: string) => string;
  formatTimeAgo: (date: string) => string;
  getInitial: (name: string) => string;
}

function SortableWorkspaceItem({
  workspace,
  sessions,
  isExpanded,
  selectedSessionId,
  onToggle,
  onCreateSession,
  onSelectSession,
  onArchiveSession,
  onPinSession,
  getStatusColor,
  formatTimeAgo,
  getInitial,
}: SortableWorkspaceItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-1">
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        {/* Workspace Header */}
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              'group flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer',
              'hover:bg-sidebar-accent transition-colors',
              isDragging && 'bg-sidebar-accent'
            )}
          >
            <div
              className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </div>
            <div className="w-6 h-6 rounded-md bg-primary/15 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">
              {getInitial(workspace.name)}
            </div>
            <span className="text-sm font-medium truncate">
              {workspace.name}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
                !isExpanded && '-rotate-90'
              )}
            />
            <div className="flex-1" />
            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-sidebar-accent"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateSession();
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
        </CollapsibleTrigger>

        {/* Sessions */}
        <CollapsibleContent>
          <div className="ml-5">
            {sessions.length === 0 ? (
              <div className="py-2 px-2 text-xs text-muted-foreground/70">
                No active sessions
              </div>
            ) : (
              sessions.map((session, sessionIndex) => {
                const isSessionSelected = selectedSessionId === session.id;
                const hasPR = session.prStatus && session.prStatus !== 'none';
                const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);

                // Determine PR status display
                const getPRStatusInfo = () => {
                  if (!hasPR) return null;
                  if (session.hasMergeConflict) {
                    return { text: 'Merge conflict', color: 'text-orange-500', icon: AlertTriangle };
                  }
                  if (session.hasCheckFailures) {
                    return { text: 'Checks failing', color: 'text-red-500', icon: XCircle };
                  }
                  if (session.prStatus === 'merged') {
                    return { text: 'Merged', color: 'text-purple-500', icon: CheckCircle2 };
                  }
                  if (session.prStatus === 'open') {
                    return { text: 'Ready to merge', color: 'text-green-500', icon: CheckCircle2 };
                  }
                  return null;
                };

                const prStatusInfo = getPRStatusInfo();

                return (
                  <div
                    key={session.id}
                    className={cn(
                      'group flex items-start gap-2 px-2 py-2 rounded-md cursor-pointer my-0.5',
                      isSessionSelected
                        ? 'bg-sidebar-accent'
                        : 'hover:bg-sidebar-accent/50 transition-colors'
                    )}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="flex-1 min-w-0">
                      {/* First line: icon + branch name + stats/actions */}
                      <div className="flex items-center gap-1.5">
                        {hasPR ? (
                          <GitPullRequest className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        ) : (
                          <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate flex-1">
                          {session.branch || session.name}
                        </span>
                        {/* Pinned indicator - hidden on hover */}
                        {session.pinned && (
                          <Pin className="h-2.5 w-2.5 text-primary shrink-0 group-hover:hidden" />
                        )}
                        {/* Stats - hidden on hover */}
                        {hasStats && (
                          <span className="text-[10px] shrink-0 group-hover:hidden">
                            <span className="text-green-500">+{session.stats!.additions}</span>
                            <span className="text-red-500 ml-1">-{session.stats!.deletions}</span>
                          </span>
                        )}
                        {/* Actions - shown on hover */}
                        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                          <button
                            className={cn(
                              "p-0.5 rounded hover:bg-sidebar-accent hover:text-foreground",
                              session.pinned ? "text-primary" : "text-muted-foreground"
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPinSession(session.id);
                            }}
                          >
                            <Pin className="h-2.5 w-2.5" />
                          </button>
                          <button
                            className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              onArchiveSession(session.id);
                            }}
                          >
                            <Archive className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      </div>
                      {/* Second line: session name · PR info · status */}
                      <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                        <span className="truncate">{session.name}</span>
                        {hasPR && session.prNumber && (
                          <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="shrink-0">PR #{session.prNumber}</span>
                          </>
                        )}
                        {prStatusInfo && (
                          <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className={cn('shrink-0', prStatusInfo.color)}>
                              {prStatusInfo.text}
                            </span>
                          </>
                        )}
                        {!hasPR && (
                          <>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="shrink-0">{formatTimeAgo(session.updatedAt)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
