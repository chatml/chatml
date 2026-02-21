'use client';

/**
 * CommentThread - Inline comment display for Monaco view zones
 *
 * Displays a review comment with:
 * - Author and timestamp
 * - Severity indicator (error/warning/info/suggestion)
 * - Markdown content
 * - Resolve/delete actions
 */

import { memo, useCallback } from 'react';
import { AlertCircle, AlertTriangle, Info, Lightbulb, CheckCircle2, Circle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { cn } from '@/lib/utils';
import type { ReviewComment } from '@/lib/types';

interface CommentThreadProps {
  comment: ReviewComment;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete?: (id: string) => void;
}

/**
 * Format a relative time string from an ISO timestamp.
 */
function formatRelativeTime(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    // Check for Invalid Date
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
      return <Info className="w-4 h-4 text-text-info shrink-0" />;
    case 'suggestion':
      return <Lightbulb className="w-4 h-4 text-text-info shrink-0" />;
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
      return 'border-l-blue-500';
    case 'suggestion':
      return 'border-l-blue-500';
    default:
      return 'border-l-muted-foreground/50';
  }
}

/**
 * CommentThread component - memoized for performance in view zones.
 */
export const CommentThread = memo(function CommentThread({
  comment,
  onResolve,
  onDelete,
}: CommentThreadProps) {
  const handleResolve = useCallback(() => {
    onResolve(comment.id, !comment.resolved);
  }, [comment.id, comment.resolved, onResolve]);

  const handleDelete = useCallback(() => {
    onDelete?.(comment.id);
  }, [comment.id, onDelete]);

  const borderClass = getSeverityBorderClass(comment.severity);

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
          {comment.resolved && (
            <span className="text-xs text-text-success shrink-0">
              Resolved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleResolve}
            title={comment.resolved ? 'Mark as unresolved' : 'Mark as resolved'}
          >
            {comment.resolved ? (
              <CheckCircle2 className="w-4 h-4 text-text-success" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
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

      {/* Content - rendered as markdown */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground/90 break-words [&_pre]:my-1 [&_pre]:bg-muted/50 [&_pre]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
        <CachedMarkdown cacheKey={`review-comment:${comment.id}`} content={comment.content} />
      </div>
    </div>
  );
});
