'use client';

import { useState, useEffect, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  MessageSquare,
  Clock,
  FileCode,
  ChevronRight,
  Check,
  Loader2,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/appStore';
import {
  listReviewComments,
  updateReviewComment as apiUpdateReviewComment,
} from '@/lib/api';
import type { ReviewComment } from '@/lib/types';

type CommentSeverity = 'error' | 'warning' | 'info' | 'suggestion';

const EMPTY: ReviewComment[] = [];

interface ReviewPanelProps {
  workspaceId: string | null;
  sessionId: string | null;
  onFileSelect?: (path: string, line?: number) => void;
  onSendFeedback?: () => void;
}

export function ReviewPanel({ workspaceId, sessionId, onFileSelect, onSendFeedback }: ReviewPanelProps) {
  const [filter, setFilter] = useState<CommentSeverity | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [fetchSession, setFetchSession] = useState<string | null>(null);

  const comments = useAppStore((s) =>
    sessionId ? s.reviewComments[sessionId] || EMPTY : EMPTY
  );
  const setReviewComments = useAppStore((s) => s.setReviewComments);
  const updateReviewComment = useAppStore((s) => s.updateReviewComment);

  // Track when session changes to trigger loading state outside the effect
  if (sessionId !== fetchSession) {
    setFetchSession(sessionId);
    if (workspaceId && sessionId) {
      setLoading(true);
    }
  }

  // Fetch comments from API on mount / session change
  useEffect(() => {
    if (!workspaceId || !sessionId) return;

    let cancelled = false;

    listReviewComments(workspaceId, sessionId)
      .then((data) => {
        if (!cancelled) {
          setReviewComments(sessionId, data as ReviewComment[]);
        }
      })
      .catch(() => {
        // Silently fail - store may already have data from WebSocket
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [workspaceId, sessionId, setReviewComments]);

  // Filter comments by severity and only show unresolved
  const filteredComments = comments.filter((c) => {
    if (c.resolved) return false;
    if (filter === 'all') return true;
    return c.severity === filter;
  });

  // Count by severity for filter badges
  const unresolvedComments = comments.filter((c) => !c.resolved);
  const counts = {
    all: unresolvedComments.length,
    error: unresolvedComments.filter((c) => c.severity === 'error').length,
    warning: unresolvedComments.filter((c) => c.severity === 'warning').length,
    info: unresolvedComments.filter((c) => c.severity === 'info').length,
    suggestion: unresolvedComments.filter((c) => c.severity === 'suggestion').length,
  };

  const handleResolve = useCallback(
    async (commentId: string) => {
      if (!workspaceId || !sessionId) return;

      // Optimistically update the store immediately
      updateReviewComment(sessionId, commentId, {
        resolved: true,
        resolvedBy: 'user',
      });

      try {
        await apiUpdateReviewComment(workspaceId, sessionId, commentId, {
          resolved: true,
          resolvedBy: 'user',
        });
      } catch {
        // Revert optimistic update on failure
        updateReviewComment(sessionId, commentId, {
          resolved: false,
          resolvedBy: undefined,
        });
      }
    },
    [workspaceId, sessionId, updateReviewComment]
  );

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Select a session to view review comments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0">
        <Button
          variant={filter === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-xs px-1.5', filter !== 'all' && 'text-muted-foreground')}
          onClick={() => setFilter('all')}
        >
          All
          {counts.all > 0 && (
            <span className="ml-1 text-2xs opacity-70">{counts.all}</span>
          )}
        </Button>
        <Button
          variant={filter === 'error' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-xs px-1.5', filter === 'error' ? 'text-text-error' : 'text-muted-foreground')}
          onClick={() => setFilter('error')}
        >
          <AlertCircle className="h-3 w-3 mr-0.5" />
          {counts.error > 0 && counts.error}
        </Button>
        <Button
          variant={filter === 'warning' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-xs px-1.5', filter === 'warning' ? 'text-text-warning' : 'text-muted-foreground')}
          onClick={() => setFilter('warning')}
        >
          <AlertTriangle className="h-3 w-3 mr-0.5" />
          {counts.warning > 0 && counts.warning}
        </Button>
        <Button
          variant={filter === 'info' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-xs px-1.5', filter === 'info' ? 'text-text-info' : 'text-muted-foreground')}
          onClick={() => setFilter('info')}
        >
          <Info className="h-3 w-3 mr-0.5" />
          {counts.info > 0 && counts.info}
        </Button>
        <Button
          variant={filter === 'suggestion' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-xs px-1.5', filter === 'suggestion' ? 'text-purple-500' : 'text-muted-foreground')}
          onClick={() => setFilter('suggestion')}
        >
          <MessageSquare className="h-3 w-3 mr-0.5" />
          {counts.suggestion > 0 && counts.suggestion}
        </Button>
        {onSendFeedback && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-xs px-1.5 ml-auto text-muted-foreground hover:text-foreground"
            onClick={onSendFeedback}
            disabled={counts.all === 0}
            title="Send unresolved comments as feedback to AI"
          >
            <Send className="h-3 w-3 mr-0.5" />
            Send Feedback
          </Button>
        )}
      </div>

      {/* Comments list */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredComments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {comments.length === 0
                ? 'No review comments yet'
                : counts.all === 0
                  ? 'All comments resolved'
                  : 'No unresolved comments'}
            </p>
            {comments.length === 0 && (
              <p className="text-xs mt-1 opacity-70">
                Use /review to start a code review
              </p>
            )}
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-2">
            {filteredComments.map((comment) => (
              <ReviewCommentCard
                key={comment.id}
                comment={comment}
                onClick={() => onFileSelect?.(comment.filePath, comment.lineNumber)}
                onResolve={() => handleResolve(comment.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ReviewCommentCard({
  comment,
  onClick,
  onResolve,
}: {
  comment: ReviewComment;
  onClick?: () => void;
  onResolve?: () => void;
}) {
  const fileName = comment.filePath.split('/').pop() || comment.filePath;
  const dirPath = comment.filePath.split('/').slice(0, -1).join('/');

  // Use title field if available, otherwise extract first line of content
  const title = comment.title || comment.content.split('\n')[0];
  const description = comment.title
    ? comment.content
    : comment.content.split('\n').slice(1).join('\n').trim();

  const severity = comment.severity || 'info';

  const SeverityIcon = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
    suggestion: MessageSquare,
  }[severity];

  const severityColor = {
    error: 'text-text-error bg-red-500/10 border-red-500/20',
    warning: 'text-text-warning bg-yellow-500/10 border-yellow-500/20',
    info: 'text-text-info bg-blue-500/10 border-blue-500/20',
    suggestion: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  }[severity];

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-2.5 cursor-pointer transition-colors hover:bg-surface-2',
        severityColor
      )}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <SeverityIcon className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight">{title}</div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 hover:bg-green-500/20 hover:text-green-500"
            onClick={(e) => {
              e.stopPropagation();
              onResolve?.();
            }}
            title="Resolve comment"
          >
            <Check className="h-3 w-3" />
          </Button>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Footer row */}
      <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1 min-w-0">
          <FileCode className="h-3 w-3 shrink-0" />
          <span className="truncate" title={comment.filePath}>
            {dirPath && <span className="opacity-60">{dirPath}/</span>}
            {fileName}
            {comment.lineNumber && <span className="opacity-60">:{comment.lineNumber}</span>}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          <Clock className="h-3 w-3" />
          <span>{formatTimeAgo(comment.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
