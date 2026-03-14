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
import { navigate, navigateOrOpenTab } from '@/lib/navigation';
import { useSettingsStore, getBranchPrefix, getWorkspaceBranchPrefix, type ContentView, type SidebarSortBy } from '@/stores/settingsStore';
import { useSidebarSessions, isSidebarGroupExpanded, type SidebarGroup } from '@/hooks/useSidebarSessions';
import { createSession as createSessionApi, listConversations as listConversationsApi, updateSession as updateSessionApi, deleteRepo as deleteRepoApi, addRepo as addRepoApi, mapSessionDTO } from '@/lib/api';
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
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
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
  Settings2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Folder,
  Globe,
  Github,
  Search,
  X,
  Layers,
  Bot,
  Circle,
  Clock,
  Sparkles,
  Check,
  MessageCircleQuestion,
  ClipboardCheck,
  Link,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getWorkspaceColor, WORKSPACE_COLORS } from '@/lib/workspace-colors';
import { TASK_STATUS_OPTIONS } from '@/lib/session-fields';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';
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
import type { Workspace, WorktreeSession, SessionTaskStatus } from '@/lib/types';
import { useSessionActivityState, useIsSessionUnread, useWorkspaceSelection, useSidebarActions } from '@/stores/selectors';
import { ArchiveSessionDialog } from '@/components/dialogs/ArchiveSessionDialog';
import { useArchiveSession } from '@/hooks/useArchiveSession';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { PRNumberBadge } from '@/components/shared/PRNumberBadge';
import { CardErrorFallback } from '@/components/shared/ErrorFallbacks';

interface WorkspaceSidebarProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onGitHubRepos: () => void;
  onSessionSelected?: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
}

// Shared menu items for "Add project" group in the plus menu
const PROJECT_MENU_ITEMS = [
  { icon: Folder, label: 'Open Project', key: 'open' },
  { icon: Globe, label: 'Clone from URL', key: 'clone' },
  { icon: Github, label: 'GitHub Repos', key: 'github' },
] as const;

export function WorkspaceSidebar({ onOpenProject, onCloneFromUrl, onGitHubRepos, onSessionSelected, onOpenWorkspaceSettings }: WorkspaceSidebarProps) {
  const [workspaceToRemove, setWorkspaceToRemove] = useState<{ id: string; name: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [newSessionMenuOpen, setNewSessionMenuOpen] = useState(false);
  const { error: showError } = useToast();

  const menuHandlers = {
    open: onOpenProject,
    clone: onCloneFromUrl,
    github: onGitHubRepos,
  };

  // Scoped selectors — avoids subscribing to the entire store.
  // Sidebar only re-renders when workspaces, sessions, or selected IDs change.
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();
  const { addSession, addConversation, reorderWorkspaces, removeWorkspace, updateSession } = useSidebarActions();
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
  const { collapsedWorkspaces, toggleWorkspaceCollapsed, expandWorkspace, contentView, recentlyRemovedWorkspaces, addRecentlyRemovedWorkspace, removeRecentlyRemovedWorkspace, unreadWorkspaces, markWorkspaceUnread, markWorkspaceRead, workspaceColors, sidebarGroupBy, sidebarSortBy, setSidebarGroupBy, setSidebarSortBy, collapsedSidebarGroups, toggleSidebarGroupCollapsed, lastRepoDashboardWorkspaceId, setLastRepoDashboardWorkspaceId } = useSettingsStore();

  const isWorkspaceExpanded = (workspaceId: string) => {
    return !collapsedWorkspaces.includes(workspaceId);
  };

  // Sidebar grouping/sorting
  const { groups: sidebarGroups, flatSessions } = useSidebarSessions({
    sessions,
    workspaces,
    groupBy: sidebarGroupBy,
    sortBy: sidebarSortBy,
    filters: {
      searchTerm,
    },
    workspaceColors,
    getWorkspaceColor,
  });

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

  const handleCreateSession = async (workspaceId: string) => {
    /* eslint-disable react-hooks/purity -- only called from event handlers, not during render */
    // Generate a temporary ID for the optimistic placeholder
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const t0 = performance.now();

    // Add placeholder session to sidebar immediately (but don't navigate —
    // that happens after the backend creates the real session, preventing
    // effects from firing API calls with the temp ID).
    addSession({
      id: tempId,
      workspaceId,
      name: 'Creating session...',
      branch: '',
      worktreePath: '',
      status: 'idle',
      priority: 0,
      taskStatus: 'in_progress',
      createdAt: now,
      updatedAt: now,
    });
    expandWorkspace(workspaceId);

    try {
      // Create session via backend API (generates city-based name, branch, and worktree path)
      const workspace = workspaces.find(w => w.id === workspaceId);
      const branchPrefix = workspace?.branchPrefix
        ? getWorkspaceBranchPrefix(workspace)
        : getBranchPrefix();
      const session = await createSessionApi(workspaceId, {
        ...(branchPrefix !== undefined && { branchPrefix }),
      });
      console.debug(`[CreateSession] API returned in ${(performance.now() - t0).toFixed(0)}ms`);

      // Swap the temp placeholder with the real session. The temp was never
      // navigated to (selectedSessionId was not set to tempId), so we only
      // need to replace it in the sessions list. Navigation happens below
      // after conversations are fetched, which triggers effects only once.
      const t1 = performance.now();
      const realSession = mapSessionDTO(session);
      useAppStore.setState((state) => ({
        sessions: [realSession, ...state.sessions.filter((s) => s.id !== tempId)],
      }));

      // Register file watcher (non-blocking)
      if (session.worktreePath) {
        const dirName = getSessionDirName(session.worktreePath);
        if (dirName) registerSession(dirName, session.id);
      }

      // Fetch conversations and add to store so ConversationArea can auto-select.
      // The dashboard data fetch only loads conversations at boot — newly created
      // sessions need an explicit fetch. We do NOT call setMessagePage here because
      // listConversations returns conversations with empty messages arrays (only
      // counts). ConversationArea's message loading effect will fetch the actual
      // messages once a conversation is selected.
      let firstConvId: string | null = null;
      try {
        const conversations = await listConversationsApi(workspaceId, session.id);
        conversations.forEach((conv) => {
          if (!firstConvId) firstConvId = conv.id;
          addConversation({
            id: conv.id,
            sessionId: conv.sessionId,
            type: conv.type,
            name: conv.name,
            status: conv.status,
            messages: [],
            toolSummary: conv.toolSummary,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
          });
        });
      } catch (error) {
        console.error('Failed to load conversations for new session:', error);
      }

      // Navigate for history tracking + explicit conversation selection
      navigate({
        workspaceId,
        sessionId: session.id,
        conversationId: firstConvId ?? undefined,
        contentView: { type: 'conversation' },
      });
      console.debug(`[CreateSession] Store update + navigate in ${(performance.now() - t1).toFixed(0)}ms`);
    } catch (error) {
      console.error('Failed to create session:', error);
      // Remove the placeholder on failure
      const { removeSession: removeFromStore } = useAppStore.getState();
      removeFromStore(tempId);
      showError('Failed to create session');
    }
    /* eslint-enable react-hooks/purity */
  };

  const handleArchiveSession = (sessionId: string) => {
    requestArchive(sessionId);
  };

  const handleTaskStatusChange = (sessionId: string, status: SessionTaskStatus) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const prev = session.taskStatus;
    updateSession(sessionId, { taskStatus: status });
    updateSessionApi(session.workspaceId, sessionId, { taskStatus: status }).catch(() => {
      updateSession(sessionId, { taskStatus: prev });
      showError('Failed to update task status');
    });
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
      // Clean up unread state
      markWorkspaceRead(workspaceId);
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
          remote: repo.remote || 'origin',
          branchPrefix: repo.branchPrefix || '',
          customPrefix: repo.customPrefix || '',
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

  // Navigation helpers for branches/PRs
  const navigateToBranches = (workspaceId: string, event?: React.MouseEvent) => {
    setLastRepoDashboardWorkspaceId(workspaceId);
    navigateOrOpenTab({
      workspaceId,
      sessionId: null,
      contentView: { type: 'branches', workspaceId },
    }, event);
  };

  const navigateToPRs = (workspaceId: string, event?: React.MouseEvent) => {
    setLastRepoDashboardWorkspaceId(workspaceId);
    navigateOrOpenTab({
      workspaceId,
      sessionId: null,
      contentView: { type: 'pr-dashboard', workspaceId },
    }, event);
  };

  const handleSelectSession = (workspaceId: string, sessionId: string, event?: React.MouseEvent) => {
    navigateOrOpenTab({
      workspaceId,
      sessionId,
      contentView: { type: 'conversation' },
    }, event);
    onSessionSelected?.();
  };

  // Check if sidebar group is expanded
  const isGroupExpanded = (key: string, defaultCollapsed: boolean) => {
    return isSidebarGroupExpanded(key, defaultCollapsed, collapsedSidebarGroups);
  };

  // Section header label
  const sectionHeaderLabel = 'Sessions';

  // Group by toggle helpers — two independent booleans compose into the 4 groupBy states
  const isGroupByProject = sidebarGroupBy === 'project' || sidebarGroupBy === 'project-status';
  const isGroupByStatus = sidebarGroupBy === 'status' || sidebarGroupBy === 'project-status';

  const toggleGroupByProject = () => {
    const newProject = !isGroupByProject;
    if (newProject && isGroupByStatus) setSidebarGroupBy('project-status');
    else if (newProject) setSidebarGroupBy('project');
    else if (isGroupByStatus) setSidebarGroupBy('status');
    else setSidebarGroupBy('none');
  };

  const toggleGroupByStatus = () => {
    const newStatus = !isGroupByStatus;
    if (isGroupByProject && newStatus) setSidebarGroupBy('project-status');
    else if (isGroupByProject) setSidebarGroupBy('project');
    else if (newStatus) setSidebarGroupBy('status');
    else setSidebarGroupBy('none');
  };

  const SORT_BY_OPTIONS: { value: SidebarSortBy; label: string }[] = [
    { value: 'recent', label: 'Recent' },
    { value: 'status', label: 'Status' },
    { value: 'name', label: 'Name' },
  ];

  return (
    <div className="relative flex flex-col h-full bg-sidebar text-sidebar-foreground select-none overflow-hidden">


      {/* Global Navigation */}
      <div className="px-1 py-2 shrink-0">
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
            contentView.type === 'session-manager' ? "text-nav-icon-sessions" : "text-nav-icon-sessions/70"
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
        <div
          className={cn(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
            contentView.type === 'pr-dashboard'
              ? "bg-surface-2 text-foreground"
              : "hover:bg-surface-1"
          )}
          onClick={(e) => {
            const resolvedId = (lastRepoDashboardWorkspaceId && workspaces.some(w => w.id === lastRepoDashboardWorkspaceId))
              ? lastRepoDashboardWorkspaceId
              : workspaces[0]?.id;
            if (!resolvedId) return;
            navigateOrOpenTab({
              workspaceId: resolvedId,
              sessionId: null,
              contentView: { type: 'pr-dashboard', workspaceId: resolvedId },
            }, e);
          }}
        >
          <GitPullRequest className={cn(
            "w-4 h-4",
            contentView.type === 'pr-dashboard' ? "text-nav-icon-prs" : "text-nav-icon-prs/70"
          )} />
          <span className={cn(
            "text-base font-medium",
            contentView.type === 'pr-dashboard'
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            Pull Requests
          </span>
        </div>
        <div
          className={cn(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
            contentView.type === 'branches'
              ? "bg-surface-2 text-foreground"
              : "hover:bg-surface-1"
          )}
          onClick={(e) => {
            const resolvedId = (lastRepoDashboardWorkspaceId && workspaces.some(w => w.id === lastRepoDashboardWorkspaceId))
              ? lastRepoDashboardWorkspaceId
              : workspaces[0]?.id;
            if (!resolvedId) return;
            navigateOrOpenTab({
              workspaceId: resolvedId,
              sessionId: null,
              contentView: { type: 'branches', workspaceId: resolvedId },
            }, e);
          }}
        >
          <GitBranch className={cn(
            "w-4 h-4",
            contentView.type === 'branches' ? "text-nav-icon-branches" : "text-nav-icon-branches/70"
          )} />
          <span className={cn(
            "text-base font-medium",
            contentView.type === 'branches'
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            Branches
          </span>
        </div>
        <div
          className={cn(
            "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer",
            contentView.type === 'skills-store'
              ? "bg-surface-2 text-foreground"
              : "hover:bg-surface-1"
          )}
          onClick={() => navigate({ contentView: { type: 'skills-store' } })}
        >
          <Sparkles className={cn(
            "w-4 h-4",
            contentView.type === 'skills-store' ? "text-nav-icon-skills" : "text-nav-icon-skills/70"
          )} />
          <span className={cn(
            "text-base font-medium",
            contentView.type === 'skills-store'
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          )}>
            Skills
          </span>
        </div>
      </div>

      {/* Session List */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden">
            <div className="py-2 px-1 flex flex-col">
              {/* Section Header */}
              <div className="group/header px-2 pt-1 pb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                  {sectionHeaderLabel}
                </span>
                <div className="flex items-center gap-0.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="text-muted-foreground/60 hover:text-foreground transition-colors opacity-0 group-hover/header:opacity-100 p-0.5 rounded hover:bg-surface-1">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => navigate({ contentView: { type: 'session-manager' } })}>
                      <Layers className="size-4" />
                      Session History
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Group by</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={isGroupByProject}
                      onCheckedChange={toggleGroupByProject}
                      onSelect={(e) => e.preventDefault()}
                    >
                      Project
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={isGroupByStatus}
                      onCheckedChange={toggleGroupByStatus}
                      onSelect={(e) => e.preventDefault()}
                    >
                      Status
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    {SORT_BY_OPTIONS.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={sidebarSortBy === option.value}
                        onCheckedChange={() => setSidebarSortBy(option.value)}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {workspaces.length <= 1 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="text-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-surface-1">
                        <Plus className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => {
                        const targetId = selectedWorkspaceId || workspaces[0]?.id;
                        if (targetId) handleCreateSession(targetId);
                      }}>
                        <Bot className="h-4 w-4" />
                        New Session
                        <DropdownMenuShortcut>⌘N</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('create-session'))}>
                        <Link className="h-4 w-4" />
                        Create Session from...
                        <DropdownMenuShortcut>⌘⇧O</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <DropdownMenu open={newSessionMenuOpen} onOpenChange={setNewSessionMenuOpen}>
                    <DropdownMenuTrigger asChild>
                      <button className="text-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-surface-1">
                        <Plus className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-52"
                      onKeyDown={(e) => {
                        const num = parseInt(e.key, 10);
                        if (num >= 1 && num <= workspaces.length) {
                          e.preventDefault();
                          setNewSessionMenuOpen(false);
                          handleCreateSession(workspaces[num - 1].id);
                        }
                      }}
                    >
                      <DropdownMenuLabel>New session in...</DropdownMenuLabel>
                      {workspaces.map((w, i) => (
                        <DropdownMenuItem key={w.id} onClick={() => handleCreateSession(w.id)}>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: workspaceColors[w.id] || getWorkspaceColor(w.id) }} />
                          <span className="truncate">{w.name}</span>
                          <DropdownMenuShortcut>{i + 1}</DropdownMenuShortcut>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('create-session'))}>
                        <Link className="h-4 w-4" />
                        Create Session from...
                        <DropdownMenuShortcut>⌘⇧O</DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                </div>
              </div>
              {workspaces.length === 0 ? (
                <div className="px-3 py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
                    <FolderPlus className="w-6 h-6 text-muted-foreground/50" />
                  </div>
                  <p className="text-lg font-medium text-muted-foreground">No projects</p>
                  <p className="text-sm text-muted-foreground/70 mt-1 mb-4">
                    Add a project to get started
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-base"
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
                <>
                  {/* Mode: None — flat session list */}
                  {sidebarGroupBy === 'none' && (
                    <>
                      {flatSessions.length === 0 ? (
                        <div className="py-2 px-2 text-sm text-muted-foreground/70">
                          No sessions found
                        </div>
                      ) : (
                        flatSessions.map((session) => {
                          const ws = workspaces.find((w) => w.id === session.workspaceId);
                          return (
                            <ErrorBoundary
                              key={session.id}
                              section="SessionRow"
                              fallback={<CardErrorFallback message="Error loading session" />}
                            >
                              <SessionRow
                                session={session}
                                contentView={contentView}
                                selectedSessionId={selectedSessionId}
                                onSelectSession={(id, e) => handleSelectSession(session.workspaceId, id, e)}
                                onArchiveSession={handleArchiveSession}
                                onTaskStatusChange={handleTaskStatusChange}
                                onOpenBranches={(e) => navigateToBranches(session.workspaceId, e)}
                                onOpenPRs={(e) => navigateToPRs(session.workspaceId, e)}
                                formatTimeAgo={formatTimeAgo}
                                showProjectIndicator
                                workspaceColor={workspaceColors[session.workspaceId] || getWorkspaceColor(session.workspaceId)}
                                workspaceName={ws?.name}
                              />
                            </ErrorBoundary>
                          );
                        })
                      )}
                    </>
                  )}

                  {/* Mode: Status — status group headers with sessions */}
                  {sidebarGroupBy === 'status' && (
                    <>
                      {sidebarGroups.length === 0 ? (
                        <div className="py-2 px-2 text-sm text-muted-foreground/70">
                          No sessions found
                        </div>
                      ) : (
                        sidebarGroups.map((group) => (
                          <StatusGroupSection
                            key={group.key}
                            group={group}
                            isExpanded={isGroupExpanded(group.key, group.defaultCollapsed)}
                            onToggle={() => toggleSidebarGroupCollapsed(group.key)}
                            contentView={contentView}
                            selectedSessionId={selectedSessionId}
                            workspaces={workspaces}
                            workspaceColors={workspaceColors}
                            onSelectSession={handleSelectSession}
                            onArchiveSession={handleArchiveSession}
                            onTaskStatusChange={handleTaskStatusChange}
                            onOpenBranches={navigateToBranches}
                            onOpenPRs={navigateToPRs}
                            formatTimeAgo={formatTimeAgo}
                            showProjectIndicator
                          />
                        ))
                      )}
                    </>
                  )}

                  {/* Mode: Project — workspace headers with sessions (with DnD) */}
                  {sidebarGroupBy === 'project' && (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={workspaces.map((w) => w.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {sidebarGroups.map((group) => {
                          const ws = workspaces.find((w) => w.id === group.workspaceId);
                          if (!ws) return null;
                          const isUnread = unreadWorkspaces.includes(ws.id);
                          return (
                            <SortableWorkspaceItem
                              key={ws.id}
                              workspace={ws}
                              sessions={group.sessions}
                              isExpanded={isWorkspaceExpanded(ws.id)}
                              selectedSessionId={selectedSessionId}
                              onToggle={() => toggleWorkspaceCollapsed(ws.id)}
                              onCreateSession={() => handleCreateSession(ws.id)}
                              onSelectSession={(sessionId, event) => handleSelectSession(ws.id, sessionId, event)}
                              onArchiveSession={handleArchiveSession}
                              onTaskStatusChange={handleTaskStatusChange}
                              onRemoveWorkspace={() => setWorkspaceToRemove({ id: ws.id, name: ws.name })}
                              onOpenBranches={(event) => navigateToBranches(ws.id, event)}
                              onOpenPRs={(event) => navigateToPRs(ws.id, event)}
                              onOpenWorkspaceSettings={() => onOpenWorkspaceSettings?.(ws.id)}
                              isUnread={isUnread}
                              onToggleUnread={() => {
                                if (isUnread) {
                                  markWorkspaceRead(ws.id);
                                } else {
                                  markWorkspaceUnread(ws.id);
                                }
                              }}
                              contentView={contentView}
                              formatTimeAgo={formatTimeAgo}
                            />
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  )}

                  {/* Mode: Project > Status — workspace headers with status sub-groups */}
                  {sidebarGroupBy === 'project-status' && (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext
                        items={workspaces.map((w) => w.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {sidebarGroups.map((group) => {
                          const ws = workspaces.find((w) => w.id === group.workspaceId);
                          if (!ws) return null;
                          const isUnread = unreadWorkspaces.includes(ws.id);
                          return (
                            <SortableProjectStatusItem
                              key={ws.id}
                              workspace={ws}
                              group={group}
                              isExpanded={isWorkspaceExpanded(ws.id)}
                              selectedSessionId={selectedSessionId}
                              onToggle={() => toggleWorkspaceCollapsed(ws.id)}
                              onCreateSession={() => handleCreateSession(ws.id)}
                              onSelectSession={(sessionId, event) => handleSelectSession(ws.id, sessionId, event)}
                              onArchiveSession={handleArchiveSession}
                              onTaskStatusChange={handleTaskStatusChange}
                              onRemoveWorkspace={() => setWorkspaceToRemove({ id: ws.id, name: ws.name })}
                              onOpenBranches={(event) => navigateToBranches(ws.id, event)}
                              onOpenPRs={(event) => navigateToPRs(ws.id, event)}
                              onOpenWorkspaceSettings={() => onOpenWorkspaceSettings?.(ws.id)}
                              isUnread={isUnread}
                              onToggleUnread={() => {
                                if (isUnread) {
                                  markWorkspaceRead(ws.id);
                                } else {
                                  markWorkspaceUnread(ws.id);
                                }
                              }}
                              contentView={contentView}
                              formatTimeAgo={formatTimeAgo}
                              isSubGroupExpanded={isGroupExpanded}
                              onToggleSubGroup={toggleSidebarGroupCollapsed}
                            />
                          );
                        })}
                      </SortableContext>
                    </DndContext>
                  )}
                </>
              )}
            </div>
      </ScrollArea>
        </ContextMenuTrigger>
        <ContextMenuContent>
                {workspaces.length > 0 && (
                  <>
                    {workspaces.length <= 1 ? (
                      <ContextMenuItem onClick={() => {
                        const targetId = selectedWorkspaceId || workspaces[0]?.id;
                        if (targetId) handleCreateSession(targetId);
                      }}>
                        <Bot className="h-4 w-4" />
                        New Session
                      </ContextMenuItem>
                    ) : (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Bot className="h-4 w-4" />
                          New Session
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent
                          className="w-48"
                          onKeyDown={(e) => {
                            const num = parseInt(e.key, 10);
                            if (num >= 1 && num <= workspaces.length) {
                              e.preventDefault();
                              handleCreateSession(workspaces[num - 1].id);
                            }
                          }}
                        >
                          {workspaces.map((w, i) => (
                            <ContextMenuItem key={w.id} onClick={() => handleCreateSession(w.id)}>
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: workspaceColors[w.id] || getWorkspaceColor(w.id) }} />
                              <span className="truncate">{w.name}</span>
                              <span className="text-muted-foreground ml-auto text-xs tracking-widest">{i + 1}</span>
                            </ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
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
                        <ContextMenuItem onClick={onGitHubRepos}>
                          <Github className="h-4 w-4" />
                          GitHub Repos
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSeparator />
                  </>
                )}
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Group by</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <ContextMenuItem onClick={(e) => { e.preventDefault(); toggleGroupByProject(); }}>
                      <Check className={cn("h-3.5 w-3.5", !isGroupByProject && "opacity-0")} />
                      Project
                    </ContextMenuItem>
                    <ContextMenuItem onClick={(e) => { e.preventDefault(); toggleGroupByStatus(); }}>
                      <Check className={cn("h-3.5 w-3.5", !isGroupByStatus && "opacity-0")} />
                      Status
                    </ContextMenuItem>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Sort by</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {SORT_BY_OPTIONS.map((option) => (
                      <ContextMenuItem key={option.value} onClick={() => setSidebarSortBy(option.value)}>
                        <Check className={cn("h-3.5 w-3.5", sidebarSortBy !== option.value && "opacity-0")} />
                        {option.label}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex items-center gap-1 shrink-0">
        <Tooltip open={addMenuOpen ? false : undefined}>
          <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                  data-tour-target="add-workspace"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
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
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: workspaceColors[w.id] || getWorkspaceColor(w.id) }} />
                            <span className="truncate">{w.name}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuItem onClick={() => window.dispatchEvent(new CustomEvent('create-session'))}>
                    <Link className="h-4 w-4" />
                    Create Session from...
                    <DropdownMenuShortcut>⌘⇧O</DropdownMenuShortcut>
                  </DropdownMenuItem>
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
            className="w-full h-8 pl-7 pr-7 text-base bg-sidebar-accent/50 border border-sidebar-border rounded-md placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
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
  onTaskStatusChange: (sessionId: string, status: SessionTaskStatus) => void;
  onRemoveWorkspace: () => void;
  onOpenBranches: (event?: React.MouseEvent) => void;
  onOpenPRs: (event?: React.MouseEvent) => void;
  onOpenWorkspaceSettings: () => void;
  isUnread: boolean;
  onToggleUnread: () => void;
  formatTimeAgo: (date: string) => string;
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
  onTaskStatusChange,
  onRemoveWorkspace,
  onOpenBranches,
  onOpenPRs,
  onOpenWorkspaceSettings,
  isUnread,
  onToggleUnread,
  formatTimeAgo,
}: SortableWorkspaceItemProps) {
  const { workspaceColors, setWorkspaceColor, clearWorkspaceColor } = useSettingsStore();
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const customColor = workspaceColors[workspace.id];
  const currentColor = customColor || getWorkspaceColor(workspace.id);

  const {
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
            <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  className="shrink-0 p-0.5 -m-0.5 rounded hover:bg-muted/50 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerOpen(true);
                  }}
                  aria-label="Change workspace color"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: currentColor }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
                <div className="grid grid-cols-5 gap-1.5">
                  {WORKSPACE_COLORS.map((color) => (
                    <button
                      key={color}
                      className={cn(
                        'w-6 h-6 rounded-full transition-transform hover:scale-110',
                        currentColor === color && 'ring-2 ring-offset-2 ring-offset-background ring-primary'
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setWorkspaceColor(workspace.id, color);
                        setColorPickerOpen(false);
                      }}
                      aria-label={`Set color to ${color}`}
                    />
                  ))}
                </div>
                {customColor && (
                  <button
                    className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground text-center py-1"
                    onClick={() => {
                      clearWorkspaceColor(workspace.id);
                      setColorPickerOpen(false);
                    }}
                  >
                    Reset to default
                  </button>
                )}
              </PopoverContent>
            </Popover>
            <span className={cn("text-base truncate", isUnread ? "font-bold" : "font-semibold")}>
              {workspace.name}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
                !isExpanded && '-rotate-90'
              )}
            />
            {isUnread && (
              <div className="w-2 h-2 rounded-full bg-nav-icon-dashboard shrink-0" />
            )}
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
                  <DropdownMenuItem onClick={() => onOpenBranches()}>
                    <GitBranch className="size-4" />
                    Branches
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onOpenPRs()}>
                    <GitPullRequest className="size-4" />
                    Pull Requests
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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

        {/* Sessions */}
        <CollapsibleContent>
          <div className="ml-3 overflow-hidden">
            {/* Sessions */}
            {sessions.length === 0 ? (
              <div className="py-2 px-2 text-sm text-muted-foreground/70">
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
                    onArchiveSession={onArchiveSession}
                    onTaskStatusChange={onTaskStatusChange}
                    onOpenBranches={onOpenBranches}
                    onOpenPRs={onOpenPRs}
                    formatTimeAgo={formatTimeAgo}
                  />
                </ErrorBoundary>
              ))
            )}
          </div>
        </CollapsibleContent>
          </Collapsible>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onToggleUnread}>
          {isUnread ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
          {isUnread ? 'Mark as read' : 'Mark as unread'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCreateSession}>
          <Plus className="size-4" />
          New Session
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onOpenBranches()}>
          <GitBranch className="size-4" />
          Branches
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onOpenPRs()}>
          <GitPullRequest className="size-4" />
          Pull Requests
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpenWorkspaceSettings}>
          <Settings2 className="size-4" />
          Workspace Settings
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onRemoveWorkspace}>
          <Trash2 className="size-4" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SessionRow({
  session,
  contentView,
  selectedSessionId,
  onSelectSession,
  onArchiveSession,
  onTaskStatusChange,
  onOpenBranches,
  onOpenPRs,
  formatTimeAgo,
  showProjectIndicator,
  workspaceColor,
  workspaceName,
}: {
  session: WorktreeSession;
  contentView: ContentView;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string, event?: React.MouseEvent) => void;
  onArchiveSession: (sessionId: string) => void;
  onTaskStatusChange: (sessionId: string, status: SessionTaskStatus) => void;
  onOpenBranches?: (event?: React.MouseEvent) => void;
  onOpenPRs?: (event?: React.MouseEvent) => void;
  formatTimeAgo: (date: string) => string;
  showProjectIndicator?: boolean;
  workspaceColor?: string;
  workspaceName?: string;
}) {
  const isSessionSelected = contentView.type === 'conversation' && selectedSessionId === session.id;
  const hasPR = session.prStatus && session.prStatus !== 'none';
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);

  // Derive activity state from streaming, pending questions, and plan approvals
  const sessionId = session.id;
  const activityState = useSessionActivityState(sessionId);
  const isSessionUnread = useIsSessionUnread(sessionId);

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
      return { text: 'Merged', color: 'text-brand', icon: CheckCircle2 };
    }
    if (session.prStatus === 'open') {
      if (session.checkStatus === 'pending') {
        return { text: 'Checks running', color: 'text-amber-500', icon: AlertTriangle };
      }
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
            'group relative flex flex-row items-center py-2 rounded-md cursor-pointer my-0.5',
            'px-2',
            isSessionSelected
              ? 'bg-surface-2 hover:bg-surface-3'
              : 'hover:bg-surface-1'
          )}
          onClick={(e) => onSelectSession(session.id, e)}
        >
          {/* Unread indicator dot — absolutely positioned in left padding area */}
          {isSessionUnread && !isSessionSelected && (
            <div className="absolute left-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand" />
          )}
          {/* Content column */}
          <div className="flex flex-col flex-1 min-w-0">
          {/* First line: status icon + branch name + stats/actions */}
          <div className="flex items-center gap-1">
            {/* Task status / active indicator */}
            {activityState === 'working' ? (
              <div className="w-4 shrink-0 flex items-center justify-center">
                <div className="session-active-indicator">
                  <div className="bar" />
                  <div className="bar" />
                  <div className="bar" />
                </div>
              </div>
            ) : activityState === 'awaiting_input' ? (
              <div className="w-4 shrink-0 flex items-center justify-center">
                <div className="session-awaiting-input-indicator">
                  <MessageCircleQuestion className="w-3.5 h-3.5 text-purple-500" />
                </div>
              </div>
            ) : activityState === 'awaiting_approval' ? (
              <div className="w-4 shrink-0 flex items-center justify-center">
                <div className="session-awaiting-approval-indicator">
                  <ClipboardCheck className="w-3.5 h-3.5 text-blue-500" />
                </div>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-4 shrink-0 flex items-center justify-center rounded hover:bg-surface-1 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <TaskStatusIcon status={session.taskStatus} className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {TASK_STATUS_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onSelect={() => onTaskStatusChange(session.id, option.value)}
                    >
                      <TaskStatusIcon status={option.value} className="h-4 w-4" />
                      <span className="flex-1">{option.label}</span>
                      {option.value === session.taskStatus && (
                        <Check className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Branch name container - grows and truncates */}
            <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
              <span className={cn(
                "text-base truncate flex-1 w-0",
                isSessionSelected ? "text-foreground font-normal" : "text-foreground/60 font-normal",
                isSessionUnread && !isSessionSelected && "font-medium text-foreground/80"
              )}>
                {session.branch || session.name}
              </span>
            </div>
            {/* Git line stats badge and actions container */}
            <div className="shrink-0 flex items-center">
              {/* Stats - hidden on hover, replaced by archive action */}
              {hasStats && (
                <span className="text-xs px-1 py-px rounded border border-text-success/40 font-mono tabular-nums group-hover:hidden whitespace-nowrap">
                  <span className="text-text-success">+{session.stats!.additions}</span>
                  <span className="text-text-error ml-1">-{session.stats!.deletions}</span>
                </span>
              )}
              {/* Archive action - visible on hover */}
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground/60 hover:text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onArchiveSession(session.id);
                  }}
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          {/* Second line: project indicator · priority · session name · PR info · status */}
          <div className="flex items-center gap-1 mt-0.5 pl-1 text-sm text-muted-foreground">
              {/* Project indicator for non-project grouping modes */}
              {showProjectIndicator && workspaceColor && (
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: workspaceColor }} />
              )}
              {showProjectIndicator && workspaceName && (
                <span className="shrink-0 text-muted-foreground/70">{workspaceName}</span>
              )}
              {/* PR badge if applicable */}
              {hasPR && session.prNumber && (
                <>
                  {showProjectIndicator && workspaceName && <span className="text-muted-foreground/50">·</span>}
                  <PRNumberBadge
                    prNumber={session.prNumber}
                    prStatus={session.prStatus as 'open' | 'merged' | 'closed'}
                    checkStatus={session.checkStatus}
                    hasMergeConflict={session.hasMergeConflict}
                    prUrl={session.prUrl}
                    size="sm"
                  />
                </>
              )}
              {hasPR && !session.prNumber && (
                <>
                  {showProjectIndicator && workspaceName && <span className="text-muted-foreground/50">·</span>}
                  <GitPullRequest className="h-3 w-3 shrink-0 text-nav-icon-prs" />
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
                  {showProjectIndicator && workspaceName && <span className="text-muted-foreground/50">·</span>}
                  <span className="shrink-0">{formatTimeAgo(session.updatedAt)}</span>
                </>
              )}
          </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <TaskStatusIcon status={session.taskStatus} className="h-4 w-4" />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {TASK_STATUS_OPTIONS.map((option) => (
              <ContextMenuItem
                key={option.value}
                onClick={() => onTaskStatusChange(session.id, option.value)}
              >
                <TaskStatusIcon status={option.value} className="h-4 w-4" />
                <span className="flex-1">{option.label}</span>
                {option.value === session.taskStatus && (
                  <Check className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {onOpenBranches && (
          <ContextMenuItem onClick={() => onOpenBranches()}>
            <GitBranch className="h-4 w-4" />
            Branches
          </ContextMenuItem>
        )}
        {onOpenPRs && (
          <ContextMenuItem onClick={() => onOpenPRs()}>
            <GitPullRequest className="h-4 w-4" />
            Pull Requests
          </ContextMenuItem>
        )}
        {(onOpenBranches || onOpenPRs) && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => onArchiveSession(session.id)} variant="destructive">
          <Archive className="h-4 w-4" />
          Archive
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// --- Status group section (for 'status' and 'project-status' modes) ---

function StatusGroupSection({
  group,
  isExpanded,
  onToggle,
  contentView,
  selectedSessionId,
  workspaces,
  workspaceColors,
  onSelectSession,
  onArchiveSession,
  onTaskStatusChange,
  onOpenBranches,
  onOpenPRs,
  formatTimeAgo,
  showProjectIndicator,
}: {
  group: SidebarGroup;
  isExpanded: boolean;
  onToggle: () => void;
  contentView: ContentView;
  selectedSessionId: string | null;
  workspaces: Workspace[];
  workspaceColors: Record<string, string>;
  onSelectSession: (workspaceId: string, sessionId: string, event?: React.MouseEvent) => void;
  onArchiveSession: (sessionId: string) => void;
  onTaskStatusChange: (sessionId: string, status: SessionTaskStatus) => void;
  onOpenBranches: (workspaceId: string, event?: React.MouseEvent) => void;
  onOpenPRs: (workspaceId: string, event?: React.MouseEvent) => void;
  formatTimeAgo: (date: string) => string;
  showProjectIndicator?: boolean;
}) {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <div className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer hover:bg-surface-1 transition-colors">
          {group.statusValue && (
            <TaskStatusIcon status={group.statusValue} className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="text-sm font-semibold text-muted-foreground">{group.label}</span>
          <ChevronDown className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
            !isExpanded && '-rotate-90'
          )} />
          <span className="text-xs text-muted-foreground/50 ml-auto">{group.count}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-2">
          {group.sessions.map((session) => {
            const ws = workspaces.find((w) => w.id === session.workspaceId);
            return (
              <ErrorBoundary
                key={session.id}
                section="SessionRow"
                fallback={<CardErrorFallback message="Error loading session" />}
              >
                <SessionRow
                  session={session}
                  contentView={contentView}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={(id, e) => onSelectSession(session.workspaceId, id, e)}
                  onArchiveSession={onArchiveSession}
                  onTaskStatusChange={onTaskStatusChange}
                  onOpenBranches={(e) => onOpenBranches(session.workspaceId, e)}
                  onOpenPRs={(e) => onOpenPRs(session.workspaceId, e)}
                  formatTimeAgo={formatTimeAgo}
                  showProjectIndicator={showProjectIndicator}
                  workspaceColor={workspaceColors[session.workspaceId] || getWorkspaceColor(session.workspaceId)}
                  workspaceName={ws?.name}
                />
              </ErrorBoundary>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- Project > Status sortable item ---

interface SortableProjectStatusItemProps {
  workspace: Workspace;
  group: SidebarGroup;
  isExpanded: boolean;
  selectedSessionId: string | null;
  onToggle: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string, event?: React.MouseEvent) => void;
  onArchiveSession: (sessionId: string) => void;
  onTaskStatusChange: (sessionId: string, status: SessionTaskStatus) => void;
  onRemoveWorkspace: () => void;
  onOpenBranches: (event?: React.MouseEvent) => void;
  onOpenPRs: (event?: React.MouseEvent) => void;
  onOpenWorkspaceSettings: () => void;
  isUnread: boolean;
  onToggleUnread: () => void;
  contentView: ContentView;
  formatTimeAgo: (date: string) => string;
  isSubGroupExpanded: (key: string, defaultCollapsed: boolean) => boolean;
  onToggleSubGroup: (key: string) => void;
}

function SortableProjectStatusItem({
  workspace,
  group,
  isExpanded,
  selectedSessionId,
  onToggle,
  onCreateSession,
  onSelectSession,
  onArchiveSession,
  onTaskStatusChange,
  onRemoveWorkspace,
  onOpenBranches,
  onOpenPRs,
  onOpenWorkspaceSettings,
  isUnread,
  onToggleUnread,
  contentView,
  formatTimeAgo,
  isSubGroupExpanded,
  onToggleSubGroup,
}: SortableProjectStatusItemProps) {
  const { workspaceColors, setWorkspaceColor, clearWorkspaceColor } = useSettingsStore();
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const customColor = workspaceColors[workspace.id];
  const currentColor = customColor || getWorkspaceColor(workspace.id);

  const {
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div ref={setNodeRef} style={style} className="mb-1">
          <Collapsible open={isExpanded} onOpenChange={onToggle}>
            <CollapsibleTrigger asChild>
              <div
                className={cn(
                  'group flex items-center gap-1.5 pl-2 pr-1 py-1.5 rounded-md cursor-pointer',
                  'hover:bg-surface-1 transition-colors',
                  isDragging && 'bg-surface-2'
                )}
              >
                <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="shrink-0 p-0.5 -m-0.5 rounded hover:bg-muted/50 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setColorPickerOpen(true);
                      }}
                      aria-label="Change workspace color"
                    >
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: currentColor }}
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2" onClick={(e) => e.stopPropagation()}>
                    <div className="grid grid-cols-5 gap-1.5">
                      {WORKSPACE_COLORS.map((color) => (
                        <button
                          key={color}
                          className={cn(
                            'w-6 h-6 rounded-full transition-transform hover:scale-110',
                            currentColor === color && 'ring-2 ring-offset-2 ring-offset-background ring-primary'
                          )}
                          style={{ backgroundColor: color }}
                          onClick={() => {
                            setWorkspaceColor(workspace.id, color);
                            setColorPickerOpen(false);
                          }}
                          aria-label={`Set color to ${color}`}
                        />
                      ))}
                    </div>
                    {customColor && (
                      <button
                        className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground text-center py-1"
                        onClick={() => {
                          clearWorkspaceColor(workspace.id);
                          setColorPickerOpen(false);
                        }}
                      >
                        Reset to default
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
                <span className={cn("text-base truncate", isUnread ? "font-bold" : "font-semibold")}>
                  {workspace.name}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0',
                    !isExpanded && '-rotate-90'
                  )}
                />
                {isUnread && (
                  <div className="w-2 h-2 rounded-full bg-nav-icon-dashboard shrink-0" />
                )}
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
                      <DropdownMenuItem onClick={() => onOpenBranches()}>
                        <GitBranch className="size-4" />
                        Branches
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onOpenPRs()}>
                        <GitPullRequest className="size-4" />
                        Pull Requests
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onOpenWorkspaceSettings}>
                        <Settings2 className="size-4" />
                        Workspace Settings
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

            <CollapsibleContent>
              <div className="ml-3 overflow-hidden">
                {(!group.subGroups || group.subGroups.length === 0) ? (
                  <div className="py-2 px-2 text-sm text-muted-foreground/70">
                    No active sessions
                  </div>
                ) : (
                  group.subGroups.map((subGroup) => (
                    <Collapsible
                      key={subGroup.key}
                      open={isSubGroupExpanded(subGroup.key, subGroup.defaultCollapsed)}
                      onOpenChange={() => onToggleSubGroup(subGroup.key)}
                    >
                      <CollapsibleTrigger asChild>
                        <div className="group flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer hover:bg-surface-1 transition-colors">
                          {subGroup.statusValue && (
                            <TaskStatusIcon status={subGroup.statusValue} className="w-3 h-3 shrink-0" />
                          )}
                          <span className="text-xs font-semibold text-muted-foreground">{subGroup.label}</span>
                          <ChevronDown className={cn(
                            'h-3 w-3 text-muted-foreground transition-transform duration-200 shrink-0',
                            !isSubGroupExpanded(subGroup.key, subGroup.defaultCollapsed) && '-rotate-90'
                          )} />
                          <span className="text-xs text-muted-foreground/50 ml-auto">{subGroup.count}</span>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="ml-1">
                          {subGroup.sessions.map((session) => (
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
                                onArchiveSession={onArchiveSession}
                                onTaskStatusChange={onTaskStatusChange}
                                onOpenBranches={onOpenBranches}
                                onOpenPRs={onOpenPRs}
                                formatTimeAgo={formatTimeAgo}
                              />
                            </ErrorBoundary>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onToggleUnread}>
          {isUnread ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
          {isUnread ? 'Mark as read' : 'Mark as unread'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCreateSession}>
          <Plus className="size-4" />
          New Session
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onOpenBranches()}>
          <GitBranch className="size-4" />
          Branches
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onOpenPRs()}>
          <GitPullRequest className="size-4" />
          Pull Requests
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpenWorkspaceSettings}>
          <Settings2 className="size-4" />
          Workspace Settings
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onRemoveWorkspace}>
          <Trash2 className="size-4" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
