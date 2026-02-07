'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  MessageSquare,
  Zap,
  Eye,
  CheckCircle2,
  Archive,
  Plus,
  Search,
  X,
  LayoutList,
  List,
} from 'lucide-react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useSettingsStore, type SidebarFilter } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { WorktreeSession } from '@/lib/types';

// ─── Nav Filter Items ────────────────────────────────────────────────────────

interface NavItem {
  id: SidebarFilter;
  label: string;
  icon: React.ElementType;
}

const NAV_FILTERS: NavItem[] = [
  { id: 'all', label: 'All Sessions', icon: MessageSquare },
  { id: 'active', label: 'Active', icon: Zap },
  { id: 'needs-review', label: 'Needs Review', icon: Eye },
  { id: 'done', label: 'Done', icon: CheckCircle2 },
  { id: 'archived', label: 'Archived', icon: Archive },
];


// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo`;
}

function matchesFilter(session: WorktreeSession, filter: SidebarFilter): boolean {
  switch (filter) {
    case 'all':
      return !session.archived;
    case 'active':
      return !session.archived && (session.status === 'active' || session.taskStatus === 'in_progress');
    case 'needs-review':
      return !session.archived && session.taskStatus === 'in_review';
    case 'done':
      return !session.archived && session.taskStatus === 'done';
    case 'archived':
      return !!session.archived;
    default:
      return !session.archived;
  }
}

function getStatusColor(session: WorktreeSession): string {
  if (session.status === 'active') return 'bg-green-500';
  if (session.taskStatus === 'in_review') return 'bg-amber-500';
  if (session.taskStatus === 'done') return 'bg-purple-500';
  if (session.taskStatus === 'in_progress') return 'bg-blue-500';
  return 'bg-muted-foreground/30';
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface StreamlinedSidebarProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onQuickStart: () => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StreamlinedSidebar({
  onOpenProject,
  onCloneFromUrl,
}: StreamlinedSidebarProps) {
  const { workspaces, sessions, selectedSessionId, selectedWorkspaceId } = useWorkspaceSelection();
  const sidebarFilter = useSettingsStore((s) => s.sidebarFilter);
  const setSidebarFilter = useSettingsStore((s) => s.setSidebarFilter);
  const sessionListGrouped = useSettingsStore((s) => s.sessionListGrouped);
  const setSessionListGrouped = useSettingsStore((s) => s.setSessionListGrouped);
  const contentView = useSettingsStore((s) => s.contentView);
  const setContentView = useSettingsStore((s) => s.setContentView);

  const [searchQuery, setSearchQuery] = useState('');

  // Build workspace lookup
  const workspaceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workspaces) {
      map.set(w.id, w.name);
    }
    return map;
  }, [workspaces]);

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let result = sessions.filter((s) => matchesFilter(s, sidebarFilter));

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.branch.toLowerCase().includes(q) ||
          (s.task && s.task.toLowerCase().includes(q))
      );
    }

    // Sort: pinned first, then by updatedAt desc
    result.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return result;
  }, [sessions, sidebarFilter, searchQuery]);

  // Count sessions per filter (for badges)
  const filterCounts = useMemo(() => {
    const counts: Record<SidebarFilter, number> = {
      all: 0,
      active: 0,
      'needs-review': 0,
      done: 0,
      archived: 0,
    };
    for (const s of sessions) {
      if (matchesFilter(s, 'all')) counts.all++;
      if (matchesFilter(s, 'active')) counts.active++;
      if (matchesFilter(s, 'needs-review')) counts['needs-review']++;
      if (matchesFilter(s, 'done')) counts.done++;
      if (matchesFilter(s, 'archived')) counts.archived++;
    }
    return counts;
  }, [sessions]);

  // Group sessions by workspace if toggled
  const groupedSessions = useMemo(() => {
    if (!sessionListGrouped) return null;
    const groups = new Map<string, WorktreeSession[]>();
    for (const s of filteredSessions) {
      const list = groups.get(s.workspaceId) || [];
      list.push(s);
      groups.set(s.workspaceId, list);
    }
    return groups;
  }, [filteredSessions, sessionListGrouped]);

  const handleSelectSession = useCallback(
    (session: WorktreeSession) => {
      navigate({
        workspaceId: session.workspaceId,
        sessionId: session.id,
        contentView: { type: 'conversation' },
      });
    },
    []
  );

  // Resolve workspace name for the "new session" CTA
  const activeWorkspaceName = useMemo(() => {
    if (selectedWorkspaceId) return workspaceMap.get(selectedWorkspaceId);
    if (workspaces.length === 1) return workspaces[0].name;
    return undefined;
  }, [selectedWorkspaceId, workspaces, workspaceMap]);

  const handleNewSession = useCallback(() => {
    window.dispatchEvent(new CustomEvent('spawn-agent'));
  }, []);

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* ── Navigation Filters ── */}
      <nav className="flex flex-col pt-2 px-2 gap-0.5">
        {NAV_FILTERS.map((item) => {
          const Icon = item.icon;
          const isActive = sidebarFilter === item.id;
          const count = filterCounts[item.id];

          return (
            <button
              key={item.id}
              onClick={() => {
                setSidebarFilter(item.id);
                if (contentView.type !== 'conversation') {
                  setContentView({ type: 'conversation' });
                }
              }}
              className={cn(
                'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors w-full text-left',
                isActive
                  ? 'bg-sidebar-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{item.label}</span>
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    isActive
                      ? 'text-foreground/60'
                      : 'text-muted-foreground/60'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}

      </nav>

      <div className="h-px bg-border/50 my-2 mx-4" />

      {/* ── Session List Header ── */}
      <div className="flex items-center justify-between px-4 py-1">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Sessions
        </span>
        <div className="flex items-center gap-0.5">
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => setSessionListGrouped(!sessionListGrouped)}
              >
                {sessionListGrouped ? (
                  <LayoutList className="h-3.5 w-3.5" />
                ) : (
                  <List className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {sessionListGrouped ? 'Flat list' : 'Group by project'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Session List ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <p className="text-sm text-muted-foreground">Add a project to get started</p>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-xs"
              onClick={onOpenProject}
            >
              <Plus className="h-3.5 w-3.5" />
              Open Project
            </Button>
          </div>
        ) : (
          <>
            {filteredSessions.length === 0 ? (
              <NewSessionButton
                workspaceName={activeWorkspaceName}
                onClick={handleNewSession}
              />
            ) : sessionListGrouped && groupedSessions ? (
              // Grouped view
              Array.from(groupedSessions.entries()).map(
                ([workspaceId, wSessions]) => (
                  <div key={workspaceId} className="mb-2">
                    <div className="px-2 py-1 text-xs font-medium text-muted-foreground/70 uppercase tracking-wide truncate">
                      {workspaceMap.get(workspaceId) || 'Unknown'}
                    </div>
                    {wSessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        workspaceName={workspaceMap.get(session.workspaceId)}
                        isSelected={
                          contentView.type === 'conversation' &&
                          selectedSessionId === session.id
                        }
                        showWorkspace={false}
                        onSelect={handleSelectSession}
                      />
                    ))}
                  </div>
                )
              )
            ) : (
              // Flat view
              filteredSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  workspaceName={workspaceMap.get(session.workspaceId)}
                  isSelected={
                    contentView.type === 'conversation' &&
                    selectedSessionId === session.id
                  }
                  showWorkspace={true}
                  onSelect={handleSelectSession}
                />
              ))
            )}

            {/* New session button below existing sessions */}
            {filteredSessions.length > 0 && (
              <NewSessionButton
                workspaceName={activeWorkspaceName}
                onClick={handleNewSession}
              />
            )}
          </>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex flex-col gap-2 p-2 border-t border-border/50">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-8 text-sm bg-sidebar-accent/50 border border-border/50 rounded-md placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/30"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* New button */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full h-8 text-sm text-muted-foreground hover:text-foreground justify-start gap-2"
            >
              <Plus className="h-4 w-4" />
              New...
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={handleNewSession}>
              New Session
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenProject}>
              Open Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCloneFromUrl}>
              Clone from URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── New Session Button (styled like a session entry) ────────────────────────

function NewSessionButton({
  workspaceName,
  onClick,
}: {
  workspaceName?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-2.5 w-full px-3 py-2.5 rounded-md text-left transition-colors group text-muted-foreground/60 hover:text-foreground hover:bg-sidebar-accent/50 border border-dashed border-border/50 hover:border-border mt-1"
    >
      <div className="mt-1 shrink-0">
        <Plus className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm">
          New session{workspaceName ? ` in ${workspaceName}` : ''}
        </div>
        <div className="text-xs text-muted-foreground/40 mt-0.5">
          ⌘N
        </div>
      </div>
    </button>
  );
}

// ─── Session Item ────────────────────────────────────────────────────────────

interface SessionItemProps {
  session: WorktreeSession;
  workspaceName?: string;
  isSelected: boolean;
  showWorkspace: boolean;
  onSelect: (session: WorktreeSession) => void;
}

function SessionItem({
  session,
  workspaceName,
  isSelected,
  showWorkspace,
  onSelect,
}: SessionItemProps) {
  const displayName = session.name || session.branch;

  return (
    <button
      onClick={() => onSelect(session)}
      className={cn(
        'flex items-start gap-2.5 w-full px-3 py-2.5 rounded-md text-left transition-colors group',
        isSelected
          ? 'bg-sidebar-accent text-foreground'
          : 'text-foreground/80 hover:bg-sidebar-accent/50'
      )}
    >
      {/* Status dot */}
      <div className="mt-1.5 shrink-0">
        <div
          className={cn(
            'h-2 w-2 rounded-full transition-colors',
            getStatusColor(session),
            session.status === 'active' && 'animate-pulse'
          )}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <span className="text-xs text-muted-foreground/50 shrink-0 tabular-nums">
            {formatTimeAgo(session.updatedAt)}
          </span>
        </div>
        {showWorkspace && workspaceName && (
          <div className="text-xs text-muted-foreground/60 truncate mt-0.5">
            {workspaceName}
          </div>
        )}
      </div>
    </button>
  );
}
