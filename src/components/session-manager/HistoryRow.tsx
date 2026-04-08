'use client';

import type { ReactNode } from 'react';
import type { WorktreeSession, Workspace } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { useSettingsStore } from '@/stores/settingsStore';
import { BranchPill } from '@/components/shared/BranchPill';
import {
  Archive,
  Eye,
  Check,
  Pin,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem as ContextMenuItemUI,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

// Context menu item definition (matches data-table/types.ts)
export interface ContextMenuItemDef {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  onClick?: () => void;
  variant?: 'default' | 'destructive';
  separator?: boolean;
  disabled?: boolean;
  children?: ContextMenuItemDef[];
  checked?: boolean;
}

interface HistoryRowProps {
  session: WorktreeSession;
  workspace: Workspace;
  onSelect: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onPreview?: () => void;
  contextMenuItems?: ContextMenuItemDef[];
}

function renderMenuItem(item: ContextMenuItemDef, idx: number): ReactNode {
  if (item.separator) {
    return <ContextMenuSeparator key={`sep-${idx}`} />;
  }

  if (item.children && item.children.length > 0) {
    return (
      <ContextMenuSub key={item.label}>
        <ContextMenuSubTrigger disabled={item.disabled}>
          {item.icon}
          <span>{item.label}</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {item.children.map((child, childIdx) => renderMenuItem(child, childIdx))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  return (
    <ContextMenuItemUI
      key={item.label}
      onClick={item.onClick}
      disabled={item.disabled}
      variant={item.variant}
    >
      {item.icon}
      <span>{item.label}</span>
      {item.shortcut && (
        <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
      )}
      {item.checked && <Check className="ml-auto size-3.5 text-muted-foreground" />}
    </ContextMenuItemUI>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function HistoryRow({ session, workspace, onSelect, onArchive, onUnarchive, onPreview, contextMenuItems }: HistoryRowProps) {
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);
  const showDescription = session.prTitle && (session.prStatus === 'open' || session.prStatus === 'merged');
  const taskDescription = showDescription ? session.prTitle : session.task;

  const row = (
    <div
      className={cn(
        'group flex items-center gap-3 px-4 py-2 hover:bg-surface-1 cursor-pointer transition-colors',
        session.archived && 'opacity-50'
      )}
      onClick={onSelect}
    >
      {/* Workspace color dot + name */}
      <div className="flex items-center gap-2 shrink-0 w-[140px] min-w-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: resolveWorkspaceColor(workspace.id, workspaceColors) }}
        />
        <span className="text-sm text-muted-foreground truncate">
          {workspace.name}
        </span>
      </div>

      {/* Branch pill */}
      <BranchPill
        name={session.scheduledTaskId ? session.name : (session.branch || session.name)}
        muted={session.archived}
      />

      {/* Task/PR description */}
      {taskDescription && (
        <span className="text-sm text-muted-foreground truncate min-w-0 flex-1">
          {taskDescription}
        </span>
      )}
      {!taskDescription && <span className="flex-1" />}

      {/* Pin indicator */}
      {session.pinned && !session.archived && (
        <Pin className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      )}

      {/* Diff stats */}
      {hasStats && (
        <span className={cn(
          'text-2xs px-1 py-px rounded border font-mono tabular-nums shrink-0',
          session.archived
            ? 'border-border/50 text-muted-foreground/60'
            : 'border-text-success/40'
        )}>
          <span className={session.archived ? '' : 'text-text-success'}>+{session.stats!.additions}</span>
          <span className={cn('ml-1', session.archived ? '' : 'text-text-error')}>-{session.stats!.deletions}</span>
        </span>
      )}

      {/* Date */}
      <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
        {formatRelativeDate(session.updatedAt)}
      </span>

      {/* Hover actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity w-[60px] justify-end">
        {session.archived ? (
          <>
            {onPreview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => { e.stopPropagation(); onPreview(); }}
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            )}
            {onUnarchive && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => { e.stopPropagation(); onUnarchive(); }}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        ) : (
          onArchive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
            >
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )
        )}
      </div>
    </div>
  );

  if (contextMenuItems && contextMenuItems.length > 0) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {row}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {contextMenuItems.map((item, idx) => renderMenuItem(item, idx))}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return row;
}
