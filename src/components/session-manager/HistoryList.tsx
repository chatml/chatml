'use client';

import { useState, useMemo, useCallback } from 'react';
import type { WorktreeSession, Workspace, SessionTaskStatus } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { HistoryRow, type ContextMenuItemDef } from './HistoryRow';
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';
import { TASK_STATUS_OPTIONS } from '@/lib/session-fields';
import { useAppStore } from '@/stores/appStore';
import { updateSession as apiUpdateSession } from '@/lib/api';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import {
  Search,
  History,
  ChevronDown,
  FolderOpen,
  ExternalLink,
  Copy,
  Archive,
  Eye,
  Pin,
  PinOff,
  CircleDot,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoryListProps {
  workspaces: Workspace[];
  sessions: WorktreeSession[];
  onSelectSession: (workspaceId: string, sessionId: string) => void;
  onArchiveSession: (sessionId: string) => void;
  onUnarchiveSession: (sessionId: string) => void;
  onPreviewSession?: (sessionId: string) => void;
}

interface SessionWithWorkspace {
  session: WorktreeSession;
  workspace: Workspace;
}

interface TimeGroup {
  key: string;
  label: string;
  sortOrder: number;
  items: SessionWithWorkspace[];
}

function getTimeGroup(date: string): { key: string; label: string; sortOrder: number } {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffDays === 0) return { key: 'today', label: 'Today', sortOrder: 0 };
  if (diffDays === 1) return { key: 'yesterday', label: 'Yesterday', sortOrder: 1 };
  if (diffDays < 7) return { key: `${diffDays}d`, label: `${diffDays} days ago`, sortOrder: 2 };
  if (diffWeeks === 1) return { key: '1w', label: '1 week ago', sortOrder: 3 };
  if (diffWeeks < 4) return { key: `${diffWeeks}w`, label: `${diffWeeks} weeks ago`, sortOrder: 4 };
  if (diffMonths <= 1) return { key: '1m', label: '1 month ago', sortOrder: 5 };
  return { key: `${diffMonths}m`, label: `${diffMonths} months ago`, sortOrder: 6 };
}

export function HistoryList({
  workspaces,
  sessions,
  onSelectSession,
  onArchiveSession,
  onUnarchiveSession,
  onPreviewSession,
}: HistoryListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const storeUpdateSession = useAppStore((s) => s.updateSession);
  const toast = useToast();
  const showError = toast.error;

  const handleTaskStatusChange = useCallback((session: WorktreeSession, value: SessionTaskStatus) => {
    const prev = session.taskStatus;
    storeUpdateSession(session.id, { taskStatus: value });
    apiUpdateSession(session.workspaceId, session.id, { taskStatus: value }).catch(() => {
      storeUpdateSession(session.id, { taskStatus: prev });
      showError('Failed to update task status');
    });
  }, [storeUpdateSession, showError]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Filter and group sessions
  const { activeGroups, archivedItems } = useMemo(() => {
    const filterLower = searchTerm.toLowerCase();

    // Filter sessions
    const filtered = sessions.filter((session) => {
      if (!searchTerm) return true;
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      return (
        session.name.toLowerCase().includes(filterLower) ||
        session.branch?.toLowerCase().includes(filterLower) ||
        session.task?.toLowerCase().includes(filterLower) ||
        workspace?.name.toLowerCase().includes(filterLower)
      );
    });

    // Separate active and archived, pair with workspace
    const active: SessionWithWorkspace[] = [];
    const archived: SessionWithWorkspace[] = [];

    for (const session of filtered) {
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      if (!workspace) continue;
      if (session.archived) {
        archived.push({ session, workspace });
      } else {
        active.push({ session, workspace });
      }
    }

    // Sort by updatedAt descending
    active.sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime());
    archived.sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime());

    // Group active sessions by time
    const groupMap = new Map<string, TimeGroup>();
    for (const item of active) {
      const g = getTimeGroup(item.session.updatedAt);
      if (!groupMap.has(g.key)) {
        groupMap.set(g.key, { key: g.key, label: g.label, sortOrder: g.sortOrder, items: [] });
      }
      groupMap.get(g.key)!.items.push(item);
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);

    return { activeGroups: groups, archivedItems: archived };
  }, [sessions, workspaces, searchTerm]);

  // Context menu generator
  const getContextMenu = useCallback(
    (item: SessionWithWorkspace): ContextMenuItemDef[] => {
      const { session, workspace } = item;

      // Archived sessions: reduced menu
      if (session.archived) {
        const items: ContextMenuItemDef[] = [];
        if (onPreviewSession) {
          items.push(
            {
              label: 'Preview',
              icon: <Eye className="h-4 w-4" />,
              shortcut: '↩',
              onClick: () => onPreviewSession(session.id),
            },
            { label: '', separator: true },
          );
        }
        items.push(
          {
            label: 'Restore',
            icon: <Archive className="h-4 w-4" />,
            onClick: () => onUnarchiveSession(session.id),
          },
          {
            label: 'Copy branch name',
            icon: <Copy className="h-4 w-4" />,
            shortcut: 'C',
            onClick: async () => {
              const success = await copyToClipboard(session.branch);
              if (!success) showError('Failed to copy to clipboard');
            },
          },
        );
        return items;
      }

      // Active sessions: full menu
      const items: ContextMenuItemDef[] = [
        {
          label: 'Open session',
          icon: <FolderOpen className="h-4 w-4" />,
          shortcut: '↩',
          onClick: () => onSelectSession(workspace.id, session.id),
        },
      ];

      if (session.prUrl) {
        items.push({
          label: 'View PR on GitHub',
          icon: <ExternalLink className="h-4 w-4" />,
          onClick: () => window.open(session.prUrl, '_blank'),
        });
      }

      items.push(
        { label: '', separator: true },
        {
          label: 'Set status',
          icon: <CircleDot className="h-4 w-4" />,
          children: TASK_STATUS_OPTIONS.map((option) => ({
            label: option.label,
            icon: <TaskStatusIcon status={option.value} className="h-4 w-4" />,
            checked: session.taskStatus === option.value,
            onClick: () => handleTaskStatusChange(session, option.value),
          })),
        },
      );

      // Pin/unpin only for non-base sessions
      if (session.sessionType !== 'base') {
        items.push({
          label: session.pinned ? 'Unpin' : 'Pin',
          icon: session.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
          shortcut: 'P',
          onClick: () => {
            const newPinned = !session.pinned;
            storeUpdateSession(session.id, { pinned: newPinned });
            apiUpdateSession(workspace.id, session.id, { pinned: newPinned }).catch(() => {
              storeUpdateSession(session.id, { pinned: !newPinned });
              showError('Failed to update pin status');
            });
          },
        });
      }

      items.push(
        {
          label: 'Copy branch name',
          icon: <Copy className="h-4 w-4" />,
          shortcut: 'C',
          onClick: async () => {
            const success = await copyToClipboard(session.branch);
            if (!success) showError('Failed to copy to clipboard');
          },
        },
        { label: '', separator: true },
        {
          label: 'Archive',
          icon: <Archive className="h-4 w-4" />,
          shortcut: '⌘⇧A',
          onClick: () => onArchiveSession(session.id),
          variant: 'destructive',
        },
      );

      return items;
    },
    [onSelectSession, onArchiveSession, onUnarchiveSession, onPreviewSession, showError, storeUpdateSession, handleTaskStatusChange]
  );

  const isEmpty = activeGroups.length === 0 && archivedItems.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-4 py-3 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search history..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm bg-surface-1 border border-border rounded-md placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Sessions list */}
      <ScrollArea className="flex-1">
        {isEmpty ? (
          <div className="px-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">
              {searchTerm ? 'No matching sessions' : 'No sessions yet'}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {searchTerm ? 'Try adjusting your filter' : 'Add a workspace to get started'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            {/* Active sessions grouped by time */}
            {activeGroups.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);

              return (
                <div key={group.key}>
                  {/* Group header */}
                  <div
                    className="flex items-center gap-1.5 px-4 py-2 cursor-pointer hover:bg-surface-1/50 select-none"
                    onClick={() => toggleGroup(group.key)}
                  >
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200',
                        isCollapsed && '-rotate-90'
                      )}
                    />
                    <span className="text-xs font-medium text-muted-foreground">
                      {group.label}
                    </span>
                    <span className="text-xs text-muted-foreground/40 ml-1">
                      {group.items.length}
                    </span>
                  </div>

                  {/* Group rows */}
                  {!isCollapsed && group.items.map(({ session, workspace }) => (
                    <HistoryRow
                      key={session.id}
                      session={session}
                      workspace={workspace}
                      onSelect={() => onSelectSession(workspace.id, session.id)}
                      onArchive={() => onArchiveSession(session.id)}
                      onUnarchive={() => onUnarchiveSession(session.id)}
                      onPreview={onPreviewSession ? () => onPreviewSession(session.id) : undefined}
                      contextMenuItems={getContextMenu({ session, workspace })}
                    />
                  ))}
                </div>
              );
            })}

            {/* Archived sessions section */}
            {archivedItems.length > 0 && (
              <div className={cn(activeGroups.length > 0 && 'mt-2 pt-2 border-t')}>
                <div
                  className="flex items-center gap-1.5 px-4 py-2 cursor-pointer hover:bg-surface-1/50 select-none"
                  onClick={() => toggleGroup('archived')}
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-200',
                      collapsedGroups.has('archived') && '-rotate-90'
                    )}
                  />
                  <span className="text-xs font-medium text-muted-foreground">
                    Archived
                  </span>
                  <span className="text-xs text-muted-foreground/40 ml-1">
                    {archivedItems.length}
                  </span>
                </div>

                {!collapsedGroups.has('archived') && archivedItems.map(({ session, workspace }) => (
                  <HistoryRow
                    key={session.id}
                    session={session}
                    workspace={workspace}
                    onSelect={() => onSelectSession(workspace.id, session.id)}
                    onUnarchive={() => onUnarchiveSession(session.id)}
                    onPreview={onPreviewSession ? () => onPreviewSession(session.id) : undefined}
                    contextMenuItems={getContextMenu({ session, workspace })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
