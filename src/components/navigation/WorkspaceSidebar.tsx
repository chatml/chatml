'use client';

import { useState, useRef } from 'react';
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
import { navigate, navigateOrOpenTab } from '@/lib/navigation';
import { useSettingsStore, type ContentView } from '@/stores/settingsStore';
import { createSession as createSessionApi, listConversations as listConversationsApi, deleteSession as deleteSessionApi, updateSession as updateSessionApi, deleteRepo as deleteRepoApi, addRepo as addRepoApi, mapSessionDTO } from '@/lib/api';
import { registerSession, getSessionDirName } from '@/lib/tauri';
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
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
  Archive,
  Settings,
  Settings2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pin,
  Folder,
  Globe,
  SquarePlus,
  Search,
  X,
  LayoutDashboard,
  Layers,
  Bot,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceColor } from '@/lib/workspace-colors';
import { getPriorityOption, getTaskStatusOption } from '@/lib/session-fields';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Workspace, WorktreeSession, SetupInfo } from '@/lib/types';
import { ArchiveSessionDialog } from '@/components/dialogs/ArchiveSessionDialog';
import { useArchiveSession } from '@/hooks/useArchiveSession';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { CardErrorFallback } from '@/components/shared/ErrorFallbacks';

interface WorkspaceSidebarProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onQuickStart: () => void;
  onSessionSelected?: () => void;
  onOpenSettings?: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
}

// Shared menu items for "Add project" group in the plus menu
const PROJECT_MENU_ITEMS = [
  { icon: Folder, label: 'Open Project', key: 'open' },
  { icon: Globe, label: 'Clone from URL', key: 'clone' },
  { icon: SquarePlus, label: 'Quick Start', key: 'quickstart' },
] as const;

export function WorkspaceSidebar({ onOpenProject, onCloneFromUrl, onQuickStart, onSessionSelected, onOpenSettings, onOpenWorkspaceSettings }: WorkspaceSidebarProps) {
  const [workspaceToRemove, setWorkspaceToRemove] = useState<{ id: string; name: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addTooltipOpen, setAddTooltipOpen] = useState(false);
  const addMenuClosedRef = useRef(false);
  const { error: showError } = useToast();

  const menuHandlers = {
    open: onOpenProject,
    clone: onCloneFromUrl,
    quickstart: onQuickStart,
  };

  const {
    workspaces,
    sessions,
    selectedWorkspaceId,
    selectedSessionId,
    addSession,
    addConversation,
    reorderWorkspaces,
    updateSession,
    removeWorkspace,
  } = useAppStore();
  const { requestArchive, dialogProps: archiveDialogProps } = useArchiveSession({
    onError: () => showError('Failed to archive session'),
  });



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
  const { collapsedWorkspaces, toggleWorkspaceCollapsed, expandWorkspace, contentView, recentlyRemovedWorkspaces, addRecentlyRemovedWorkspace, removeRecentlyRemovedWorkspace } = useSettingsStore();

  const isWorkspaceExpanded = (workspaceId: string) => {
    return !collapsedWorkspaces.includes(workspaceId);
  };

  const getWorkspaceSessions = (workspaceId: string) => {
    return sessions.filter((s) => {
      if (s.workspaceId !== workspaceId || s.archived) return false;
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        s.name.toLowerCase().includes(term) ||
        s.branch?.toLowerCase().includes(term) ||
        s.task?.toLowerCase().includes(term)
      );
    });
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
        return 'text-text-success';
      case 'idle':
        return 'text-text-warning';
      case 'error':
        return 'text-text-error';
      default:
        return 'text-muted-foreground';
    }
  };

  const handleCreateSession = async (workspaceId: string) => {
    try {
      // Create session via backend API (generates city-based name, branch, and worktree path)
      const session = await createSessionApi(workspaceId);

      // Register with global file watcher for event routing
      if (session.worktreePath) {
        const dirName = getSessionDirName(session.worktreePath);
        if (dirName) {
          registerSession(dirName, session.id);
        }
      }

      // Add to local store
      addSession(mapSessionDTO(session));

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

      // Select the new session (navigate records history)
      navigate({
        workspaceId,
        sessionId: session.id,
        contentView: { type: 'conversation' },
      });
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleArchiveSession = (sessionId: string) => {
    requestArchive(sessionId);
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

  const handleRemoveWorkspace = async (workspaceId: string) => {
    try {
      // Save to recently removed before deleting
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        addRecentlyRemovedWorkspace({ name: workspace.name, path: workspace.path });
      }
      // Delete from backend
      await deleteRepoApi(workspaceId);
      // Update local store
      removeWorkspace(workspaceId);
    } catch (error) {
      console.error('Failed to remove workspace:', error);
      showError('Failed to remove workspace. Please try again.');
    }
  };

  const handleReopenWorkspace = async (path: string) => {
    try {
      const repo = await addRepoApi(path);
      // Remove from recently removed list
      removeRecentlyRemovedWorkspace(path);
      // Add to local store only if not already present
      const { addWorkspace, workspaces: currentWorkspaces } = useAppStore.getState();
      if (!currentWorkspaces.some((w) => w.id === repo.id)) {
        addWorkspace({
          id: repo.id,
          name: repo.name,
          path: repo.path,
          defaultBranch: repo.branch,
          createdAt: repo.createdAt,
        });
      }
    } catch (error) {
      console.error('Failed to re-open workspace:', error);
      showError('Failed to re-open workspace. It may have been moved or deleted.');
      removeRecentlyRemovedWorkspace(path);
    }
  };

  const confirmRemoveWorkspace = async () => {
    if (workspaceToRemove) {
      await handleRemoveWorkspace(workspaceToRemove.id);
      setWorkspaceToRemove(null);
    }
  };

  // Detect macOS for traffic light styling
  const isMacOS = typeof window !== 'undefined' && navigator.platform.includes('Mac');

  return (
    <div className="relative flex flex-col h-full bg-sidebar text-sidebar-foreground select-none overflow-hidden" onContextMenu={(e) => e.preventDefault()}>


      {/* Global Navigation */}
      <div className="px-3 py-2">
        <div
          className={cn(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
            contentView.type === 'global-dashboard'
              ? "bg-surface-2 text-foreground"
              : "hover:bg-surface-1"
          )}
          onClick={(e) => navigateOrOpenTab({ contentView: { type: 'global-dashboard' } }, e)}
        >
          <LayoutDashboard className={cn(
            "w-4 h-4",
            contentView.type === 'global-dashboard' ? "text-blue-400" : "text-blue-400/70"
          )} />
          <span className={cn(
            "text-base font-medium",
            contentView.type === 'global-dashboard'
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            Dashboard
          </span>
        </div>
        <div
          className={cn(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
            contentView.type === 'session-manager'
              ? "bg-surface-2 text-foreground"
              : "hover:bg-surface-1"
          )}
          onClick={() => navigate({ contentView: { type: 'session-manager' } })}
        >
          <Layers className={cn(
            "w-4 h-4",
            contentView.type === 'session-manager' ? "text-orange-400" : "text-orange-400/70"
          )} />
          <span className={cn(
            "text-base font-medium",
            contentView.type === 'session-manager'
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            Sessions
          </span>
        </div>
      </div>

      {/* Workspace List */}
      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
            <div className="py-2 pl-1 pr-2 flex flex-col">
              {/* Section Header */}
              <div className="group/header px-2 pt-1 pb-2 flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  Repositories
                </span>
                <button
                  onClick={(e) => navigateOrOpenTab({ contentView: { type: 'repositories' } }, e)}
                  className="text-[10px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors opacity-0 group-hover/header:opacity-100"
                >
                  Manage
                </button>
              </div>
              {workspaces.length === 0 ? (
                <div className="px-3 py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <FolderPlus className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">No workspaces</p>
                  <p className="text-xs text-muted-foreground/70 mt-1 mb-4">
                    Add a repository to get started
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                      >
                        <Plus className="size-4" />
                        Add project
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-48">
                      {PROJECT_MENU_ITEMS.map((item) => (
                        <DropdownMenuItem key={item.key} onClick={menuHandlers[item.key]}>
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                      {recentlyRemovedWorkspaces.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <Clock className="h-4 w-4" />
                              Recent Projects
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-48">
                              {recentlyRemovedWorkspaces.map((w) => (
                                <DropdownMenuItem key={w.path} onClick={() => handleReopenWorkspace(w.path)}>
                                  <Folder className="h-4 w-4" />
                                  <span className="truncate">{w.name}</span>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                    {workspaces
                      .filter((workspace) => !searchTerm || getWorkspaceSessions(workspace.id).length > 0)
                      .map((workspace) => (
                      <SortableWorkspaceItem
                        key={workspace.id}
                        workspace={workspace}
                        sessions={getWorkspaceSessions(workspace.id)}
                        isExpanded={isWorkspaceExpanded(workspace.id)}
                        selectedSessionId={selectedSessionId}
                        onToggle={() => toggleWorkspaceCollapsed(workspace.id)}
                        onCreateSession={() => handleCreateSession(workspace.id)}
                        onSelectSession={(sessionId, event) => {
                          navigateOrOpenTab({
                            workspaceId: workspace.id,
                            sessionId,
                            contentView: { type: 'conversation' },
                          }, event);
                          onSessionSelected?.();
                        }}
                        onArchiveSession={handleArchiveSession}
                        onPinSession={handlePinSession}
                        onRemoveWorkspace={() => setWorkspaceToRemove({ id: workspace.id, name: workspace.name })}
                        onOpenBranches={(event) => {
                          navigateOrOpenTab({
                            workspaceId: workspace.id,
                            sessionId: null,
                            contentView: { type: 'branches', workspaceId: workspace.id },
                          }, event);
                        }}
                        onOpenPRs={(event) => {
                          navigateOrOpenTab({
                            workspaceId: workspace.id,
                            sessionId: null,
                            contentView: { type: 'pr-dashboard', workspaceId: workspace.id },
                          }, event);
                        }}
                        onOpenWorkspaceSettings={() => onOpenWorkspaceSettings?.(workspace.id)}
                        contentView={contentView}
                        getStatusColor={getStatusColor}
                        formatTimeAgo={formatTimeAgo}
                        getInitial={getInitial}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
              {/* Fill remaining space with context menu for adding sessions */}
              {workspaces.length > 0 && (
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="flex-1 min-h-4" />
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => {
                      const targetId = selectedWorkspaceId || workspaces[0]?.id;
                      if (targetId) handleCreateSession(targetId);
                    }}>
                      <Bot className="h-4 w-4" />
                      New Session
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <FolderPlus className="h-4 w-4" />
                        Add Project
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem onClick={onOpenProject}>
                          <Folder className="h-4 w-4" />
                          Open Project
                        </ContextMenuItem>
                        <ContextMenuItem onClick={onCloneFromUrl}>
                          <Globe className="h-4 w-4" />
                          Clone from URL
                        </ContextMenuItem>
                        <ContextMenuItem onClick={onQuickStart}>
                          <SquarePlus className="h-4 w-4" />
                          Quick Start
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuContent>
                </ContextMenu>
              )}
            </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex items-center gap-1 shrink-0">
        <Tooltip
          open={addTooltipOpen}
          onOpenChange={(open) => {
            if (open && (addMenuOpen || addMenuClosedRef.current)) {
              return;
            }
            setAddTooltipOpen(open);
          }}
        >
          <DropdownMenu open={addMenuOpen} onOpenChange={(open) => {
            setAddMenuOpen(open);
            if (open) {
              setAddTooltipOpen(false);
            } else {
              addMenuClosedRef.current = true;
              setTimeout(() => { addMenuClosedRef.current = false; }, 200);
            }
          }}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent align="start" side="top" className="w-52">
              {/* Session creation group */}
              {workspaces.length > 0 && (
                <>
                  <DropdownMenuItem onClick={() => {
                    const targetId = selectedWorkspaceId || workspaces[0]?.id;
                    if (targetId) handleCreateSession(targetId);
                  }}>
                    <Bot className="h-4 w-4" />
                    New Session
                    <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  {workspaces.length > 1 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <GitBranch className="h-4 w-4" />
                        New Session in...
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-48">
                        {workspaces.map((w) => (
                          <DropdownMenuItem key={w.id} onClick={() => handleCreateSession(w.id)}>
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getWorkspaceColor(w.id) }} />
                            <span className="truncate">{w.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              {/* Project addition group */}
              {PROJECT_MENU_ITEMS.map((item) => (
                <DropdownMenuItem key={item.key} onClick={menuHandlers[item.key]}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              ))}
              {/* Recent projects group */}
              {recentlyRemovedWorkspaces.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Clock className="h-4 w-4" />
                      Recent Projects
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-48">
                      {recentlyRemovedWorkspaces.map((w) => (
                        <DropdownMenuItem key={w.path} onClick={() => handleReopenWorkspace(w.path)}>
                          <Folder className="h-4 w-4" />
                          <span className="truncate">{w.name}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent side="top">New...</TooltipContent>
        </Tooltip>
        {/* Search input */}
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-8 pl-7 pr-7 text-sm bg-sidebar-accent/50 border border-sidebar-border rounded-md placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
              onClick={onOpenSettings}
            >
              <Settings className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">⌘ ,</span></TooltipContent>
        </Tooltip>
      </div>

      {/* Remove workspace confirmation dialog */}
      <Dialog open={workspaceToRemove !== null} onOpenChange={(open) => !open && setWorkspaceToRemove(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove workspace?</DialogTitle>
            <DialogDescription>
              This will remove <span className="font-medium">{workspaceToRemove?.name}</span> from your sidebar. The files on disk will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkspaceToRemove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemoveWorkspace}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {archiveDialogProps && <ArchiveSessionDialog {...archiveDialogProps} />}
    </div>
  );
}

interface SortableWorkspaceItemProps {
  workspace: Workspace;
  sessions: WorktreeSession[];
  isExpanded: boolean;
  selectedSessionId: string | null;
  contentView: ContentView;
  onToggle: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string, event?: React.MouseEvent) => void;
  onArchiveSession: (sessionId: string) => void;
  onPinSession: (sessionId: string) => void;
  onRemoveWorkspace: () => void;
  onOpenBranches: (event?: React.MouseEvent) => void;
  onOpenPRs: (event?: React.MouseEvent) => void;
  onOpenWorkspaceSettings: () => void;
  getStatusColor: (status: string) => string;
  formatTimeAgo: (date: string) => string;
  getInitial: (name: string) => string;
}

function SortableWorkspaceItem({
  workspace,
  sessions,
  isExpanded,
  selectedSessionId,
  contentView,
  onToggle,
  onCreateSession,
  onSelectSession,
  onArchiveSession,
  onPinSession,
  onRemoveWorkspace,
  onOpenBranches,
  onOpenPRs,
  onOpenWorkspaceSettings,
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
              'group flex items-center gap-1.5 pl-2 pr-1 py-1.5 rounded-md cursor-pointer',
              'hover:bg-surface-1 transition-colors',
              isDragging && 'bg-surface-2'
            )}
          >
            <div
              className="shrink-0 cursor-grab active:cursor-grabbing"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getWorkspaceColor(workspace.id) }}
              />
            </div>
            <span className="text-base font-semibold truncate">
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
                className="h-6 w-6 hover:bg-surface-1"
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
                    className="h-6 w-6 hover:bg-surface-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={onOpenWorkspaceSettings}>
                    <Settings2 className="size-4" />
                    Workspace Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <FolderOpen className="size-4" />
                    Open in Finder
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Terminal className="size-4" />
                    Open in Terminal
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy className="size-4" />
                    Copy path
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={onRemoveWorkspace}>
                    <Trash2 className="size-4" />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Workspace Navigation + Sessions */}
        <CollapsibleContent>
          <div className="ml-3 overflow-hidden">
            {/* Fixed Navigation Items - less indented than sessions */}
            <div className="pb-1">
              {(() => {
                const isBranchesSelected = contentView.type === 'branches' && contentView.workspaceId === workspace.id;
                const isPRsSelected = contentView.type === 'pr-dashboard' && contentView.workspaceId === workspace.id;
                return (
                  <>
                    <div
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer",
                        isBranchesSelected
                          ? "bg-surface-2 text-foreground"
                          : "hover:bg-surface-1"
                      )}
                      onClick={(e) => onOpenBranches(e)}
                    >
                      <GitBranch className={cn(
                        "w-3.5 h-3.5",
                        isBranchesSelected ? "text-green-400" : "text-green-400/70"
                      )} />
                      <span className={cn(
                        "text-base font-medium",
                        isBranchesSelected
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}>
                        Branches
                      </span>
                    </div>
                    <div
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer",
                        isPRsSelected
                          ? "bg-surface-2 text-foreground"
                          : "hover:bg-surface-1"
                      )}
                      onClick={(e) => onOpenPRs(e)}
                    >
                      <GitPullRequest className={cn(
                        "w-3.5 h-3.5",
                        isPRsSelected ? "text-violet-400" : "text-violet-400/70"
                      )} />
                      <span className={cn(
                        "text-base font-medium",
                        isPRsSelected
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}>
                        Pull Requests
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Sessions Header */}
            <div className="px-2 pt-1 pb-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              Sessions
            </div>

            {/* Sessions */}
            {sessions.length === 0 ? (
              <div className="py-2 px-2 text-2xs text-muted-foreground/70">
                No active sessions
              </div>
            ) : (
              sessions.map((session) => (
                <ErrorBoundary
                  key={session.id}
                  section="SessionRow"
                  fallback={<CardErrorFallback message="Error loading session" />}
                >
                  <SessionRow
                    session={session}
                    contentView={contentView}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={onSelectSession}
                    onPinSession={onPinSession}
                    onArchiveSession={onArchiveSession}
                    formatTimeAgo={formatTimeAgo}
                  />
                </ErrorBoundary>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function SessionRow({
  session,
  contentView,
  selectedSessionId,
  onSelectSession,
  onPinSession,
  onArchiveSession,
  formatTimeAgo,
}: {
  session: WorktreeSession;
  contentView: ContentView;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string, event?: React.MouseEvent) => void;
  onPinSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  formatTimeAgo: (date: string) => string;
}) {
  const isSessionSelected = contentView.type === 'conversation' && selectedSessionId === session.id;
  const hasPR = session.prStatus && session.prStatus !== 'none';
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);

  // Determine PR status display
  const getPRStatusInfo = () => {
    if (!hasPR) return null;
    if (session.hasMergeConflict) {
      return { text: 'Merge conflict', color: 'text-text-warning', icon: AlertTriangle };
    }
    if (session.hasCheckFailures) {
      return { text: 'Checks failing', color: 'text-text-error', icon: XCircle };
    }
    if (session.prStatus === 'merged') {
      return { text: 'Merged', color: 'text-primary', icon: CheckCircle2 };
    }
    if (session.prStatus === 'open') {
      return { text: 'Ready to merge', color: 'text-text-success', icon: CheckCircle2 };
    }
    return null;
  };

  const prStatusInfo = getPRStatusInfo();

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-start gap-1 pl-0 pr-2 py-2 rounded-md cursor-pointer my-0.5',
            isSessionSelected
              ? 'bg-surface-2 hover:bg-surface-3'
              : 'hover:bg-surface-1'
          )}
          onClick={(e) => onSelectSession(session.id, e)}
        >
          {/* Status indicator column */}
          <div className="w-3.5 shrink-0 flex items-center justify-center pt-0.5">
            {session.status === 'active' && (
              <div className="session-active-indicator">
                <div className="bar" />
                <div className="bar" />
                <div className="bar" />
              </div>
            )}
          </div>
          {/* Git icon column */}
          <div className="w-4 shrink-0 flex items-start justify-center pt-0.5">
            {hasPR ? (
              <GitPullRequest className="w-3.5 h-3.5 text-purple-500" />
            ) : (
              <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {/* First line: branch name + stats/actions */}
            <div className="flex items-center gap-1.5">
              {/* Branch name container - grows and truncates */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                <span className={cn(
                  "text-base font-normal truncate flex-1 w-0",
                  isSessionSelected ? "text-foreground" : "text-foreground/60"
                )}>
                  {session.branch || session.name}
                </span>
                {/* Pinned indicator - fade out on hover */}
                {session.pinned && (
                  <Pin className="h-2.5 w-2.5 text-primary shrink-0 group-hover:opacity-0 transition-opacity" />
                )}
              </div>
              {/* Git line stats badge and actions container */}
              <div className="relative shrink-0 flex items-center">
                {/* Stats - fade out on hover */}
                {hasStats && (
                  <span className="text-2xs px-1 py-px rounded border border-text-success/40 font-mono tabular-nums group-hover:opacity-0 transition-opacity whitespace-nowrap">
                    <span className="text-text-success">+{session.stats!.additions}</span>
                    <span className="text-text-error ml-1">-{session.stats!.deletions}</span>
                  </span>
                )}
                {/* Actions - positioned absolutely to avoid layout shift */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className={cn(
                      "p-0.5 rounded hover:bg-surface-1 hover:text-foreground",
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
                    className="p-0.5 rounded hover:bg-surface-1 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchiveSession(session.id);
                    }}
                  >
                    <Archive className="h-2.5 w-2.5" />
                  </button>
                </div>
              </div>
            </div>
            {/* Second line: task status · priority · session name · PR info · status */}
            <div className="flex items-center gap-1 mt-0.5 text-sm text-muted-foreground">
              {session.taskStatus && session.taskStatus !== 'backlog' && (() => {
                const opt = getTaskStatusOption(session.taskStatus);
                return <opt.icon className={cn('h-3 w-3 shrink-0', opt.color)} />;
              })()}
              {session.priority > 0 && (() => {
                const opt = getPriorityOption(session.priority);
                return <opt.icon className={cn('h-3 w-3 shrink-0', opt.color)} />;
              })()}
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onPinSession(session.id)}>
          <Pin className="h-4 w-4" />
          {session.pinned ? 'Unpin' : 'Pin'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onArchiveSession(session.id)} variant="destructive">
          <Archive className="h-4 w-4" />
          Archive
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
