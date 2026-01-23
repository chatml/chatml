'use client';

import { useState } from 'react';
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
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Review comment severity levels
export type CommentSeverity = 'error' | 'warning' | 'info' | 'suggestion';

// Review comment status
export type CommentStatus = 'open' | 'resolved' | 'wont-fix';

// Review comment interface
export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber?: number;
  severity: CommentSeverity;
  status: CommentStatus;
  title: string;
  description?: string;
  author?: string;
  createdAt: string;
  updatedAt?: string;
}

// Mock data for demonstration - this would come from backend/store in real implementation
const MOCK_COMMENTS: ReviewComment[] = [
  {
    id: '1',
    filePath: 'src/components/ChatInput.tsx',
    lineNumber: 42,
    severity: 'error',
    status: 'open',
    title: 'Potential memory leak',
    description: 'useEffect cleanup function not properly disposing event listener',
    author: 'AI Review',
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
  },
  {
    id: '2',
    filePath: 'src/lib/api.ts',
    lineNumber: 156,
    severity: 'warning',
    status: 'open',
    title: 'Missing error handling',
    description: 'API call should handle network errors gracefully',
    author: 'AI Review',
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
  },
  {
    id: '3',
    filePath: 'src/stores/appStore.ts',
    lineNumber: 89,
    severity: 'suggestion',
    status: 'open',
    title: 'Consider memoization',
    description: 'This selector could benefit from memoization to prevent re-renders',
    author: 'AI Review',
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(), // 2 hours ago
  },
  {
    id: '4',
    filePath: 'src/components/WorkspaceSidebar.tsx',
    severity: 'info',
    status: 'open',
    title: 'Documentation needed',
    description: 'Complex component would benefit from JSDoc comments',
    author: 'AI Review',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(), // 3 hours ago
  },
];

interface ReviewPanelProps {
  onFileSelect?: (path: string, line?: number) => void;
}

export function ReviewPanel({ onFileSelect }: ReviewPanelProps) {
  const [filter, setFilter] = useState<CommentSeverity | 'all'>('all');
  const [comments] = useState<ReviewComment[]>(MOCK_COMMENTS);

  // Filter comments by severity and only show unresolved
  const filteredComments = comments.filter((c) => {
    if (c.status !== 'open') return false;
    if (filter === 'all') return true;
    return c.severity === filter;
  });

  // Count by severity for filter badges
  const counts = {
    all: comments.filter((c) => c.status === 'open').length,
    error: comments.filter((c) => c.status === 'open' && c.severity === 'error').length,
    warning: comments.filter((c) => c.status === 'open' && c.severity === 'warning').length,
    info: comments.filter((c) => c.status === 'open' && c.severity === 'info').length,
    suggestion: comments.filter((c) => c.status === 'open' && c.severity === 'suggestion').length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0">
        <Filter className="h-3 w-3 text-muted-foreground mr-1" />
        <Button
          variant={filter === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-5 text-[11px] px-1.5"
          onClick={() => setFilter('all')}
        >
          All
          {counts.all > 0 && (
            <span className="ml-1 text-[10px] opacity-70">{counts.all}</span>
          )}
        </Button>
        <Button
          variant={filter === 'error' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-[11px] px-1.5', filter === 'error' && 'text-red-500')}
          onClick={() => setFilter('error')}
        >
          <AlertCircle className="h-3 w-3 mr-0.5" />
          {counts.error > 0 && counts.error}
        </Button>
        <Button
          variant={filter === 'warning' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-[11px] px-1.5', filter === 'warning' && 'text-yellow-500')}
          onClick={() => setFilter('warning')}
        >
          <AlertTriangle className="h-3 w-3 mr-0.5" />
          {counts.warning > 0 && counts.warning}
        </Button>
        <Button
          variant={filter === 'info' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-[11px] px-1.5', filter === 'info' && 'text-blue-500')}
          onClick={() => setFilter('info')}
        >
          <Info className="h-3 w-3 mr-0.5" />
          {counts.info > 0 && counts.info}
        </Button>
        <Button
          variant={filter === 'suggestion' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('h-5 text-[11px] px-1.5', filter === 'suggestion' && 'text-purple-500')}
          onClick={() => setFilter('suggestion')}
        >
          <MessageSquare className="h-3 w-3 mr-0.5" />
          {counts.suggestion > 0 && counts.suggestion}
        </Button>
      </div>

      {/* Comments list */}
      {filteredComments.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No unresolved comments</p>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-2">
            {filteredComments.map((comment) => (
              <ReviewCommentCard
                key={comment.id}
                comment={comment}
                onClick={() => onFileSelect?.(comment.filePath, comment.lineNumber)}
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
}: {
  comment: ReviewComment;
  onClick?: () => void;
}) {
  const fileName = comment.filePath.split('/').pop() || comment.filePath;
  const dirPath = comment.filePath.split('/').slice(0, -1).join('/');

  const SeverityIcon = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
    suggestion: MessageSquare,
  }[comment.severity];

  const severityColor = {
    error: 'text-red-500 bg-red-500/10 border-red-500/20',
    warning: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20',
    info: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
    suggestion: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
  }[comment.severity];

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
        'rounded-lg border p-2.5 cursor-pointer transition-colors hover:bg-accent/50',
        severityColor
      )}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <SeverityIcon className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm leading-tight">{comment.title}</div>
          {comment.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {comment.description}
            </p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
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
