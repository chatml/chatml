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
import { useSettingsStore, type ContentView } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { createSession as createSessionApi, listConversations as listConversationsApi, deleteSession as deleteSessionApi, updateSession as updateSessionApi, deleteRepo as deleteRepoApi } from '@/lib/api';
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
  PanelLeftClose,
  Folder,
  Globe,
  SquarePlus,
  Search,
  X,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
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

interface WorkspaceSidebarProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onQuickStart: () => void;
  onSessionSelected?: () => void;
  onOpenSettings?: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onToggleSidebar?: () => void;
}

// Shared menu items for "Add project" dropdown
const ADD_REPO_MENU_ITEMS = [
  { icon: Folder, label: 'Open project', key: 'open' },
  { icon: Globe, label: 'Clone from URL', key: 'clone' },
  { icon: SquarePlus, label: 'Quick start', key: 'quickstart' },
] as const;

export function WorkspaceSidebar({ onOpenProject, onCloneFromUrl, onQuickStart, onSessionSelected, onOpenSettings, onOpenWorkspaceSettings, onToggleSidebar }: WorkspaceSidebarProps) {
  const [workspaceToRemove, setWorkspaceToRemove] = useState<{ id: string; name: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addTooltipOpen, setAddTooltipOpen] = useState(false);
  const [isShimmering, setIsShimmering] = useState(false);
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
    selectWorkspace,
    selectSession,
    addSession,
    addConversation,
    reorderWorkspaces,
    archiveSession,
    updateSession,
    removeWorkspace,
  } = useAppStore();

  const leftToolbarBg = useUIStore((state) => state.toolbarBackgrounds.left);

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
  const { collapsedWorkspaces, toggleWorkspaceCollapsed, expandWorkspace, contentView, setContentView } = useSettingsStore();

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

      // Select the new session (selectSession auto-selects first conversation)
      selectWorkspace(workspaceId);
      selectSession(session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleArchiveSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    try {
      // Update backend to mark as archived
      await updateSessionApi(session.workspaceId, sessionId, { archived: true });
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

  const handleRemoveWorkspace = async (workspaceId: string) => {
    try {
      // Delete from backend
      await deleteRepoApi(workspaceId);
      // Update local store
      removeWorkspace(workspaceId);
    } catch (error) {
      console.error('Failed to remove workspace:', error);
      showError('Failed to remove workspace. Please try again.');
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

      {/* Header - pl-20 gives space for macOS traffic lights */}
      <div data-tauri-drag-region className={cn("relative h-10 pl-20 pr-3 flex items-center justify-between border-b shrink-0", leftToolbarBg)}>
        <span
          className={cn("text-[22px] font-extrabold brand-shimmer cursor-pointer select-none", isShimmering && "shimmer-active")}
          onClick={() => setIsShimmering(!isShimmering)}
        >
          <span className="text-muted-foreground">chat</span><span className="text-violet-400/80">ml</span>
        </span>
        {onToggleSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onToggleSidebar}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Hide sidebar (⌘B)</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Workspace List */}
      <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&>[data-slot=scroll-area-viewport]>div]:!h-full">
            <div className="py-2 px-1 h-full w-full flex flex-col">
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
                      {ADD_REPO_MENU_ITEMS.map((item) => (
                        <DropdownMenuItem key={item.key} onClick={menuHandlers[item.key]}>
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </DropdownMenuItem>
                      ))}
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
                        onSelectSession={(sessionId) => {
                          selectWorkspace(workspace.id);
                          selectSession(sessionId);
                          setContentView({ type: 'conversation' });
                          onSessionSelected?.();
                        }}
                        onArchiveSession={handleArchiveSession}
                        onPinSession={handlePinSession}
                        onRemoveWorkspace={() => setWorkspaceToRemove({ id: workspace.id, name: workspace.name })}
                        onOpenDashboard={() => {
                          selectWorkspace(workspace.id);
                          selectSession(null);
                          setContentView({ type: 'workspace-dashboard', workspaceId: workspace.id });
                        }}
                        onOpenPRs={() => {
                          selectWorkspace(workspace.id);
                          selectSession(null);
                          setContentView({ type: 'pr-dashboard', workspaceId: workspace.id });
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
                    <ContextMenuItem onClick={() => handleCreateSession(selectedWorkspaceId || workspaces[0].id)}>
                      <Plus className="h-4 w-4" />
                      Add session
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <FolderPlus className="h-4 w-4" />
                        Add project
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        <ContextMenuItem onClick={onOpenProject}>
                          <Folder className="h-4 w-4" />
                          Open project
                        </ContextMenuItem>
                        <ContextMenuItem onClick={onCloneFromUrl}>
                          <Globe className="h-4 w-4" />
                          Clone from URL
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  </ContextMenuContent>
                </ContextMenu>
              )}
            </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex items-center gap-1">
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
            <DropdownMenuContent align="start" side="top" className="w-48">
              {ADD_REPO_MENU_ITEMS.map((item) => (
                <DropdownMenuItem key={item.key} onClick={menuHandlers[item.key]}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent side="top">Add project</TooltipContent>
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
          <TooltipContent side="top">Settings (⌘,)</TooltipContent>
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
  onSelectSession: (sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onPinSession: (sessionId: string) => void;
  onRemoveWorkspace: () => void;
  onOpenDashboard: () => void;
  onOpenPRs: () => void;
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
  onOpenDashboard,
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
              'group flex items-center gap-1.5 px-1 py-1.5 rounded-md cursor-pointer',
              'hover:bg-surface-1 transition-colors',
              isDragging && 'bg-surface-2'
            )}
          >
            <div
              className="shrink-0 cursor-grab active:cursor-grabbing text-primary/60"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <Folder className="w-4 h-4" />
            </div>
            <span className="text-[length:var(--text-base)] font-semibold truncate">
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
          <div className="ml-5 overflow-hidden">
            {/* Fixed Navigation Items - less indented than sessions */}
            <div className="pb-1 -ml-2">
              {(() => {
                const isDashboardSelected = contentView.type === 'workspace-dashboard' && contentView.workspaceId === workspace.id;
                const isPRsSelected = contentView.type === 'pr-dashboard' && contentView.workspaceId === workspace.id;
                return (
                  <>
                    <div
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer",
                        isDashboardSelected
                          ? "bg-surface-2 text-foreground"
                          : "hover:bg-surface-1"
                      )}
                      onClick={onOpenDashboard}
                    >
                      <LayoutDashboard className={cn(
                        "w-3.5 h-3.5",
                        isDashboardSelected ? "text-blue-400" : "text-blue-400/70"
                      )} />
                      <span className={cn(
                        "text-[length:var(--text-base)] font-medium",
                        isDashboardSelected
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}>
                        Dashboard
                      </span>
                    </div>
                    <div
                      className={cn(
                        "group flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer",
                        isPRsSelected
                          ? "bg-surface-2 text-foreground"
                          : "hover:bg-surface-1"
                      )}
                      onClick={onOpenPRs}
                    >
                      <GitPullRequest className={cn(
                        "w-3.5 h-3.5",
                        isPRsSelected ? "text-violet-400" : "text-violet-400/70"
                      )} />
                      <span className={cn(
                        "text-[length:var(--text-base)] font-medium",
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
              <div className="py-2 px-2 text-[length:var(--text-micro)] text-muted-foreground/70">
                No active sessions
              </div>
            ) : (
              sessions.map((session) => {
                const isSessionSelected = selectedSessionId === session.id;
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
                  <ContextMenu key={session.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          'group flex items-start gap-2 px-2 py-2 rounded-md cursor-pointer my-0.5',
                          isSessionSelected
                            ? 'bg-surface-2 hover:bg-surface-3'
                            : 'hover:bg-surface-1'
                        )}
                        onClick={() => onSelectSession(session.id)}
                      >
                        <div className="flex-1 min-w-0">
                          {/* First line: icon + branch name + stats/actions */}
                          <div className="flex items-center gap-1.5">
                            {/* Branch name container - grows and truncates */}
                            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                              {hasPR ? (
                                <GitPullRequest className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                              ) : (
                                <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              )}
                              <span className={cn(
                                "text-[length:var(--text-base)] font-normal truncate flex-1 w-0",
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
                                <span className="text-[length:var(--text-micro)] px-1 py-px rounded border border-text-success/40 font-mono tabular-nums group-hover:opacity-0 transition-opacity whitespace-nowrap">
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
                          {/* Second line: session name · PR info · status */}
                          <div className="flex items-center gap-1 mt-0.5 text-[length:var(--text-caption)] text-muted-foreground">
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
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
