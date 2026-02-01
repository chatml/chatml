'use client';

import type { WorktreeSession, Workspace } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Terminal,
  MessageSquare,
  GitPullRequest,
  Archive,
  Eye,
} from 'lucide-react';

interface SessionRowProps {
  session: WorktreeSession;
  workspace: Workspace;
  onSelect: () => void;
  onUnarchive?: () => void;
  onPreview?: () => void;
}

export function SessionRow({ session, workspace, onSelect, onUnarchive, onPreview }: SessionRowProps) {
  const isActive = session.status === 'active';
  const hasPR = session.prStatus && session.prStatus !== 'none';
  const hasStats = session.stats && (session.stats.additions > 0 || session.stats.deletions > 0);

  // Format date
  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get PR status text
  const getPRStatusText = () => {
    if (!hasPR) return null;

    if (session.status === 'active') {
      return { text: 'Working...', color: 'text-text-warning' };
    }
    if (session.hasCheckFailures) {
      return { text: '1 check pending', color: 'text-text-warning' };
    }
    if (session.hasMergeConflict) {
      return { text: 'Merge conflict', color: 'text-text-error' };
    }
    if (session.prStatus === 'open') {
      return { text: 'Ready to merge', color: 'text-text-success' };
    }
    if (session.prStatus === 'merged') {
      return { text: 'Merged', color: 'text-primary' };
    }
    return null;
  };

  const prStatus = getPRStatusText();

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2 hover:bg-surface-1 cursor-pointer transition-colors',
        session.archived && 'opacity-60'
      )}
      onClick={onSelect}
    >
      {/* Type icon */}
      <div className="shrink-0">
        {isActive ? (
          <Terminal className="h-4 w-4 text-text-success" />
        ) : (
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Workspace name */}
      <span className="text-sm text-muted-foreground shrink-0 w-32 truncate">
        {workspace.name}
      </span>

      {/* Branch/session name - clickable area */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate">
          {session.branch || session.name}
        </span>
      </div>

      {/* PR info */}
      {hasPR && session.prNumber && (
        <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
          <GitPullRequest className="h-3 w-3" />
          PR #{session.prNumber}
        </span>
      )}

      {/* PR status text */}
      {prStatus && (
        <span className={cn('text-xs shrink-0', prStatus.color)}>
          {prStatus.text}
        </span>
      )}

      {/* Diff stats */}
      {hasStats && (
        <span className="text-xs px-1.5 py-0.5 rounded border border-text-success/40 font-mono tabular-nums shrink-0">
          <span className="text-text-success">+{session.stats!.additions}</span>
          <span className="text-text-error ml-1">-{session.stats!.deletions}</span>
        </span>
      )}

      {/* Date */}
      <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
        {formatDate(session.updatedAt)}
      </span>

      {/* Preview + Unarchive buttons for archived sessions */}
      {session.archived && onPreview && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          <Eye className="h-3 w-3" />
        </Button>
      )}
      {session.archived && onUnarchive && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onUnarchive();
          }}
        >
          <Archive className="h-3 w-3 mr-1" />
          Unarchive
        </Button>
      )}
    </div>
  );
}
