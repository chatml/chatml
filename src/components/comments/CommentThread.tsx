'use client';

/**
 * CommentThread - Inline comment display for Pierre diff annotations
 *
 * Displays a review comment with:
 * - Author and timestamp
 * - Severity indicator (error/warning/info/suggestion)
 * - Markdown content (compact prose rendering)
 * - Resolution dropdown (Fixed/Ignored) and status badge
 * - Delete action for user-created comments
 */

import { memo, useCallback } from 'react';
import { AlertCircle, AlertTriangle, Info, Lightbulb, CheckCircle2, Circle, MinusCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResolutionBadge } from '@/components/comments/ResolutionBadge';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { PROSE_CLASSES_COMPACT } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { ReviewComment } from '@/lib/types';

interface CommentThreadProps {
  comment: ReviewComment;
  onResolve: (id: string, resolved: boolean, resolutionType?: 'fixed' | 'ignored') => void;
  onDelete?: (id: string) => void;
}

/**
 * Format a relative time string from an ISO timestamp.
 */
function formatRelativeTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) {
      return 'unknown';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  } catch {
    return 'unknown';
  }
}

/**
 * Severity icon component.
 */
function SeverityIcon({ severity }: { severity?: 'error' | 'warning' | 'suggestion' | 'info' }) {
  switch (severity) {
    case 'error':
      return <AlertCircle className="w-4 h-4 text-text-error shrink-0" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-text-warning shrink-0" />;
    case 'info':
      return <Info className="w-4 h-4 text-slate-400 shrink-0" />;
    case 'suggestion':
      return <Lightbulb className="w-4 h-4 text-purple-500 shrink-0" />;
    default:
      return null;
  }
}

/**
 * Get border color class based on severity.
 */
function getSeverityBorderClass(severity?: 'error' | 'warning' | 'suggestion' | 'info'): string {
  switch (severity) {
    case 'error':
      return 'border-l-red-500';
    case 'warning':
      return 'border-l-yellow-500';
    case 'info':
      return 'border-l-slate-300 dark:border-l-slate-500';
    case 'suggestion':
      return 'border-l-purple-500';
    default:
      return 'border-l-muted-foreground/50';
  }
}

/**
 * Status badge showing open/resolved state for inline comment threads.
 */
function StatusBadge({ comment }: { comment: ReviewComment }) {
  if (comment.resolved) {
    return <ResolutionBadge type={comment.resolutionType} size="sm" />;
  }

  return (
    <span className="inline-flex items-center text-xs px-1.5 py-0 rounded-full border font-medium shrink-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
      Open
    </span>
  );
}

/**
 * CommentThread component - memoized for performance in view zones.
 */
export const CommentThread = memo(function CommentThread({
  comment,
  onResolve,
  onDelete,
}: CommentThreadProps) {
  const handleResolveAs = useCallback((resolutionType: 'fixed' | 'ignored') => {
    onResolve(comment.id, true, resolutionType);
  }, [comment.id, onResolve]);

  const handleUnresolve = useCallback(() => {
    onResolve(comment.id, false);
  }, [comment.id, onResolve]);

  const handleDelete = useCallback(() => {
    onDelete?.(comment.id);
  }, [comment.id, onDelete]);

  const borderClass = comment.resolved ? 'border-l-muted-foreground/30' : getSeverityBorderClass(comment.severity);

  return (
    <div
      className={cn(
        'border-l-4 bg-muted/60 backdrop-blur-sm p-3 my-1 rounded-r text-sm',
        'shadow-sm',
        borderClass,
        comment.resolved && 'opacity-60'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SeverityIcon severity={comment.severity} />
          <span className="font-medium text-foreground truncate">{comment.author}</span>
          <span className="text-muted-foreground text-xs shrink-0">
            {formatRelativeTime(comment.createdAt)}
          </span>
          <StatusBadge comment={comment} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {comment.resolved ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={handleUnresolve}
              title="Mark as open"
            >
              <CheckCircle2 className="w-4 h-4 text-text-success" />
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="Resolve comment"
                >
                  <Circle className="w-4 h-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => handleResolveAs('fixed')}>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Mark as Fixed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleResolveAs('ignored')}>
                  <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  Mark as Ignored
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* Only show delete for user-created comments */}
          {comment.source === 'user' && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
              onClick={handleDelete}
              title="Delete comment"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content - rendered as compact markdown */}
      <div className={cn(PROSE_CLASSES_COMPACT, 'text-foreground/90 break-words')}>
        <CachedMarkdown cacheKey={`review-comment:${comment.id}`} content={comment.content} />
      </div>
    </div>
  );
});
