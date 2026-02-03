'use client';

import { GitBranch, Check, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthorAvatar } from '@/components/ui/author-avatar';
import { cn } from '@/lib/utils';
import type { BranchDTO } from '@/lib/api';

interface BranchCardProps {
  branch: BranchDTO;
  currentBranch: string;
  avatarUrl?: string;
  onJumpToSession?: () => void;
  onViewOnGitHub?: () => void;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function BranchCard({
  branch,
  currentBranch,
  avatarUrl,
  onJumpToSession,
  onViewOnGitHub,
}: BranchCardProps) {
  const isCurrentBranch = branch.name === currentBranch;
  const hasSession = !!branch.sessionId;
  const isRemote = branch.isRemote;

  // Get status badge for session
  const getSessionStatusBadge = () => {
    if (!branch.sessionStatus) return null;

    const statusStyles: Record<string, string> = {
      active: 'bg-green-500/10 text-green-500 border-green-500/20',
      idle: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
      done: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      error: 'bg-red-500/10 text-red-500 border-red-500/20',
    };

    return (
      <span
        className={cn(
          'px-1.5 py-0.5 text-xs rounded border capitalize',
          statusStyles[branch.sessionStatus] || 'bg-surface-2 text-muted-foreground'
        )}
      >
        {branch.sessionStatus}
      </span>
    );
  };

  // Get branch display name (strip origin/ prefix for display)
  const displayName = isRemote && branch.name.startsWith('origin/')
    ? branch.name.slice(7)
    : branch.name;

  return (
    <div
      className={cn(
        'border rounded-lg bg-card hover:bg-surface-1 transition-colors p-3',
        hasSession && 'border-purple-500/30 bg-purple-500/5',
        isCurrentBranch && 'border-green-500/30'
      )}
    >
      {/* Row 1: Branch icon, name, badges, actions */}
      <div className="flex items-center gap-2">
        <GitBranch
          className={cn(
            'h-4 w-4 shrink-0',
            hasSession ? 'text-purple-400' : isRemote ? 'text-muted-foreground' : 'text-green-400'
          )}
        />

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={cn(
              'font-medium text-sm truncate',
              isRemote && 'text-muted-foreground'
            )}
          >
            {displayName}
          </span>

          {isCurrentBranch && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-green-500/10 text-green-500 border border-green-500/20">
              <Check className="h-3 w-3" />
              HEAD
            </span>
          )}

          {hasSession && getSessionStatusBadge()}

          {isRemote && !branch.name.startsWith('origin/') && (
            <span className="px-1.5 py-0.5 text-xs rounded bg-surface-2 text-muted-foreground">
              remote
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {hasSession && onJumpToSession && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onJumpToSession}
              className="h-7 px-2 text-xs gap-1"
            >
              Go to
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}

          {onViewOnGitHub && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onViewOnGitHub}
              title="View on GitHub"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Metadata - author, date, ahead/behind */}
      <div className="flex items-center gap-2 mt-1.5 ml-6 text-xs text-muted-foreground">
        {branch.lastAuthor && (
          <span className="flex items-center gap-1.5 truncate max-w-[150px]">
            <AuthorAvatar name={branch.lastAuthor} avatarUrl={avatarUrl} size="sm" />
            <span className="truncate">{branch.lastAuthor}</span>
          </span>
        )}

        {branch.lastCommitDate && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span>{formatTimeAgo(branch.lastCommitDate)}</span>
          </>
        )}

        {/* Ahead/behind badges */}
        {(branch.aheadMain > 0 || branch.behindMain > 0) && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="flex items-center gap-1 font-mono text-xs">
              {branch.aheadMain > 0 && (
                <span className="text-green-500">+{branch.aheadMain}</span>
              )}
              {branch.behindMain > 0 && (
                <span className="text-red-500">-{branch.behindMain}</span>
              )}
              <span className="text-muted-foreground/50">main</span>
            </span>
          </>
        )}

        {/* Session name if different from branch */}
        {hasSession && branch.sessionName && (
          <>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-purple-400 truncate max-w-[100px]">
              {branch.sessionName}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
