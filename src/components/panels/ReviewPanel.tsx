'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareDot,
  Check,
  FileCode,
  ChevronRight,
  ChevronDown,
  Circle,
  MinusCircle,
  Loader2,
  List,
  ListTree,
} from 'lucide-react';
import { cn, toBase64 } from '@/lib/utils';
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
import { ResolutionBadge } from '@/components/comments/ResolutionBadge';
import { formatTimeAgo } from '@/lib/format';
import { useAppStore } from '@/stores/appStore';
import {
  listReviewComments,
  updateReviewComment as apiUpdateReviewComment,
  listReviewScorecards,
} from '@/lib/api';
import type { ReviewScorecardDTO, ReviewScore } from '@/lib/api/sessions';
import type { Attachment, ReviewComment } from '@/lib/types';
import { dispatchAppEvent } from '@/lib/custom-events';

type CommentSeverity = 'error' | 'warning' | 'info' | 'suggestion';

const EMPTY: ReviewComment[] = [];

// Severity priority for sorting (lower = more critical = shown first)
const SEVERITY_PRIORITY: Record<string, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  info: 3,
};

interface ReviewPanelProps {
  workspaceId: string | null;
  sessionId: string | null;
  onFileSelect?: (path: string, line?: number) => void;
  showResolved?: boolean;
}

export function ReviewPanel({ workspaceId, sessionId, onFileSelect, showResolved }: ReviewPanelProps) {
  const [filter, setFilter] = useState<CommentSeverity | 'all'>('all');
  const [loading, setLoading] = useState(false);
  const [fetchSession, setFetchSession] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [groupByFile, setGroupByFile] = useState(false);
  const [addedToChatIds, setAddedToChatIds] = useState<Set<string>>(new Set());
  const [justFixedAll, setJustFixedAll] = useState(false);
  const [scorecards, setScorecards] = useState<ReviewScorecardDTO[]>([]);

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

    // Also fetch scorecards
    listReviewScorecards(workspaceId, sessionId)
      .then((data) => { if (!cancelled) setScorecards(data); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [workspaceId, sessionId, setReviewComments]);

  // Filter comments by severity and resolved state
  const filteredComments = useMemo(() => {
    const filtered = comments.filter((c) => {
      if (c.resolved && !showResolved) return false;
      if (filter === 'all') return true;
      return c.severity === filter;
    });

    // Sort: unresolved first, then by severity priority, file path, line number
    return filtered.sort((a, b) => {
      // Resolved comments go to the bottom
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      const aPriority = SEVERITY_PRIORITY[a.severity || 'info'] ?? 3;
      const bPriority = SEVERITY_PRIORITY[b.severity || 'info'] ?? 3;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // Within same severity, sort by file path then line number
      const fileCompare = a.filePath.localeCompare(b.filePath);
      if (fileCompare !== 0) return fileCompare;
      return a.lineNumber - b.lineNumber;
    });
  }, [comments, filter, showResolved]);

  // Group sorted comments by file path (preserves sort order within groups)
  const groupedComments = useMemo(() => {
    const groups = new Map<string, ReviewComment[]>();
    for (const comment of filteredComments) {
      const existing = groups.get(comment.filePath);
      if (existing) {
        existing.push(comment);
      } else {
        groups.set(comment.filePath, [comment]);
      }
    }
    return groups;
  }, [filteredComments]);

  // Count by severity for filter badges (single pass)
  const KNOWN_SEVERITIES = new Set(['error', 'warning', 'info', 'suggestion'] as const);
  type Severity = typeof KNOWN_SEVERITIES extends Set<infer T> ? T : never;
  const counts = useMemo(() => {
    const c = { all: 0, error: 0, warning: 0, info: 0, suggestion: 0 };
    for (const comment of comments) {
      if (comment.resolved) continue;
      c.all++;
      const sev = comment.severity || 'info';
      if (KNOWN_SEVERITIES.has(sev as Severity)) c[sev as Severity]++;
    }
    return c;
  }, [comments]);

  const handleResolveAs = useCallback(
    async (commentId: string, resolutionType: 'fixed' | 'ignored') => {
      if (!workspaceId || !sessionId) return;

      // Optimistically update the store immediately
      updateReviewComment(sessionId, commentId, {
        resolved: true,
        resolvedBy: 'user',
        resolutionType,
      });

      try {
        await apiUpdateReviewComment(workspaceId, sessionId, commentId, {
          resolved: true,
          resolvedBy: 'user',
          resolutionType,
        });
      } catch {
        // Revert optimistic update on failure
        updateReviewComment(sessionId, commentId, {
          resolved: false,
          resolvedBy: undefined,
          resolutionType: undefined,
        });
      }
    },
    [workspaceId, sessionId, updateReviewComment]
  );

  const handleUnresolve = useCallback(
    async (commentId: string) => {
      if (!workspaceId || !sessionId) return;

      updateReviewComment(sessionId, commentId, {
        resolved: false,
        resolvedBy: undefined,
        resolutionType: undefined,
      });

      try {
        await apiUpdateReviewComment(workspaceId, sessionId, commentId, {
          resolved: false,
        });
      } catch {
        updateReviewComment(sessionId, commentId, {
          resolved: true,
          resolvedBy: 'user',
        });
      }
    },
    [workspaceId, sessionId, updateReviewComment]
  );

  const toggleFileCollapsed = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleAddToChat and setAddedToChatIds are stable module-level/setter refs
  const handleAddToChatTracked = useCallback((comment: ReviewComment) => {
    handleAddToChat(comment);
    setAddedToChatIds((prev) => new Set(prev).add(comment.id));
  }, []);

  // Unresolved comments not yet added to chat — drives both the Fix all
  // dispatch and the footer's visibility so the button hides when there's
  // nothing left to add.
  const fixableComments = useMemo(
    () => comments.filter((c) => !c.resolved && !addedToChatIds.has(c.id)),
    [comments, addedToChatIds],
  );

  const handleFixAll = useCallback(() => {
    if (fixableComments.length === 0) return;

    dispatchAppEvent('compose-action', {
      text: 'Fix the attached review comments',
      attachments: [commentsToBulkAttachment(fixableComments)],
    });

    setAddedToChatIds((prev) => {
      const next = new Set(prev);
      for (const c of fixableComments) next.add(c.id);
      return next;
    });
    setJustFixedAll(true);
  }, [fixableComments]);

  // Briefly keep the footer mounted with a confirming label so the click has
  // explicit feedback rather than the footer flickering away.
  useEffect(() => {
    if (!justFixedAll) return;
    const id = setTimeout(() => setJustFixedAll(false), 1500);
    return () => clearTimeout(id);
  }, [justFixedAll]);

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
            <span className="ml-1 text-xs opacity-70">{counts.all}</span>
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
          className={cn('h-5 text-xs px-1.5', filter === 'info' ? 'text-slate-500 dark:text-slate-400' : 'text-muted-foreground')}
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-1.5 text-muted-foreground ml-auto"
              onClick={() => setGroupByFile((prev) => !prev)}
              aria-label={groupByFile ? 'Switch to flat list' : 'Group by file'}
            >
              {groupByFile ? (
                <ListTree className="h-3 w-3" />
              ) : (
                <List className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {groupByFile ? 'Switch to flat list' : 'Group by file'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Scorecards */}
      {scorecards.length > 0 && (
        <div className="border-b px-2 py-2 space-y-2">
          {scorecards.map((sc) => {
            let scores: ReviewScore[] = [];
            try { scores = JSON.parse(sc.scores); } catch (e) { console.warn('Failed to parse scorecard scores:', e); }
            const avg = scores.length > 0
              ? scores.reduce((s, d) => s + d.score, 0) / scores.length
              : 0;
            return (
              <div key={sc.id} className="rounded-md border bg-surface-1 p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium capitalize">{sc.reviewType} Review</span>
                  <span className="text-[10px] text-muted-foreground">{avg.toFixed(1)}/10 avg</span>
                </div>
                <div className="space-y-1">
                  {scores.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground w-20 truncate shrink-0">{d.dimension}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            d.score >= 7 ? 'bg-green-500' : d.score >= 4 ? 'bg-amber-500' : 'bg-red-500',
                          )}
                          style={{ width: `${(d.score / (d.maxScore || 10)) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-6 text-right shrink-0">{d.score}/{d.maxScore || 10}</span>
                    </div>
                  ))}
                </div>
                {sc.summary && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2">{sc.summary}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

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
          <div className="p-1.5 space-y-1">
            {groupByFile ? (
              Array.from(groupedComments.entries()).map(([filePath, fileComments]) => {
                const fileName = filePath.split('/').pop() || filePath;
                const dirPath = filePath.split('/').slice(0, -1).join('/');
                const unresolvedCount = fileComments.filter((c) => !c.resolved).length;
                const isCollapsed = collapsedFiles.has(filePath);

                return (
                  <div key={filePath}>
                    {/* File group header */}
                    <button
                      className="flex items-center gap-1.5 w-full px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-2 rounded transition-colors"
                      onClick={() => toggleFileCollapsed(filePath)}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      )}
                      <FileCode className="h-3 w-3 shrink-0" />
                      <span className="truncate text-left" title={filePath}>
                        {dirPath && <span className="opacity-60">{dirPath}/</span>}
                        <span className="text-foreground">{fileName}</span>
                      </span>
                      {unresolvedCount > 0 && (
                        <span className="ml-auto shrink-0 bg-muted text-muted-foreground rounded-full px-1.5 py-0 text-2xs font-medium">
                          {unresolvedCount}
                        </span>
                      )}
                    </button>

                    {/* File comments */}
                    {!isCollapsed && (
                      <div className="ml-2 space-y-1 mt-0.5">
                        {fileComments.map((comment) => (
                          <ReviewCommentCard
                            key={comment.id}
                            comment={comment}
                            onNavigate={() => onFileSelect?.(comment.filePath, comment.lineNumber)}
                            onResolveAs={(type) => handleResolveAs(comment.id, type)}
                            onUnresolve={() => handleUnresolve(comment.id)}
                            onAddToChat={handleAddToChatTracked}
                            addedToChat={addedToChatIds.has(comment.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              filteredComments.map((comment) => (
                <ReviewCommentCard
                  key={comment.id}
                  comment={comment}
                  onNavigate={() => onFileSelect?.(comment.filePath, comment.lineNumber)}
                  onResolveAs={(type) => handleResolveAs(comment.id, type)}
                  showFilePath
                  onAddToChat={handleAddToChatTracked}
                  addedToChat={addedToChatIds.has(comment.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* Fix all footer — stays mounted briefly after click to confirm, then hides. */}
      {(fixableComments.length > 0 || justFixedAll) && !loading && (
        <div className="px-2 py-1.5 border-t shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleFixAll}
            disabled={justFixedAll}
          >
            {justFixedAll ? (
              <>
                <Check className="h-3 w-3 mr-1 text-green-500" />
                Added to chat
              </>
            ) : (
              `Fix all (${fixableComments.length})`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function commentTitle(comment: ReviewComment): string {
  return comment.title || comment.content.split('\n')[0].slice(0, 60);
}

/** Create an instruction attachment from a single review comment. */
function commentToAttachment(comment: ReviewComment): Attachment {
  const title = commentTitle(comment);
  const content = [
    `## Review Comment: ${title}`,
    '',
    `**Comment ID:** \`${comment.id}\``,
    `**File:** \`${comment.filePath}:${comment.lineNumber}\``,
    `**Severity:** ${comment.severity || 'info'}`,
    '',
    comment.content,
    '',
    `**Action:** After fixing, call \`resolve_review_comment\` with commentId \`${comment.id}\`.`,
  ].join('\n');

  return {
    id: `review-${comment.id}-${Date.now()}`,
    type: 'file',
    name: title,
    mimeType: 'text/markdown',
    size: new Blob([content]).size,
    lineCount: content.split('\n').length,
    base64Data: toBase64(content),
    preview: content.slice(0, 200),
    isInstruction: true,
  };
}

/**
 * Create a single instruction attachment that bundles many review comments,
 * grouped by file and sorted by line number. Used by "Fix all" so the composer
 * gets one attachment instead of N.
 */
function commentsToBulkAttachment(comments: ReviewComment[]): Attachment {
  const byFile = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const existing = byFile.get(c.filePath);
    if (existing) existing.push(c);
    else byFile.set(c.filePath, [c]);
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  const lines: string[] = [
    `# Review Feedback`,
    '',
    `The following ${comments.length} review comment${comments.length === 1 ? '' : 's'} need${comments.length === 1 ? 's' : ''} to be addressed.`,
    '',
  ];

  for (const [filePath, fileComments] of byFile) {
    lines.push(`## ${filePath}`, '');
    for (const c of fileComments) {
      lines.push(`### Line ${c.lineNumber} — ${commentTitle(c)}`);
      lines.push(`**Comment ID:** \`${c.id}\``);
      lines.push(`**Severity:** ${c.severity || 'info'}`);
      lines.push('');
      lines.push(c.content);
      lines.push('');
    }
  }

  lines.push(
    '---',
    '',
    '**Action:** After fixing each comment, call `resolve_review_comment` with its `Comment ID`.',
  );

  const content = lines.join('\n');
  return {
    id: `review-bulk-${Date.now()}`,
    type: 'file',
    name: `Review Feedback (${comments.length})`,
    mimeType: 'text/markdown',
    size: new Blob([content]).size,
    lineCount: content.split('\n').length,
    base64Data: toBase64(content),
    preview: content.slice(0, 200),
    isInstruction: true,
  };
}

function handleAddToChat(comment: ReviewComment) {
  const attachment = commentToAttachment(comment);
  dispatchAppEvent('compose-action', {
    text: `Fix the attached review comment`,
    attachments: [attachment],
  });
}

function ReviewCommentCard({
  comment,
  onNavigate,
  onResolveAs,
  onUnresolve,
  showFilePath,
  onAddToChat,
  addedToChat,
}: {
  comment: ReviewComment;
  onNavigate: () => void;
  onResolveAs?: (type: 'fixed' | 'ignored') => void;
  onUnresolve?: () => void;
  showFilePath?: boolean;
  onAddToChat?: (comment: ReviewComment) => void;
  addedToChat?: boolean;
}) {
  const title = comment.title || comment.content.split('\n')[0];
  const isResolved = comment.resolved;

  // Refresh relative timestamps every 60s
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const severity = comment.severity || 'info';

  const SeverityIcon = {
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
    suggestion: MessageSquare,
  }[severity];

  const severityStyles = {
    error: {
      card: 'bg-red-500/10 border-red-500/20',
      icon: 'text-text-error',
      title: 'font-medium text-text-error',
    },
    warning: {
      card: 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20',
      icon: 'text-amber-600 dark:text-amber-400',
      title: 'font-semibold text-foreground',
    },
    info: {
      card: 'bg-slate-100/60 border-slate-200 dark:bg-slate-500/8 dark:border-slate-400/20',
      icon: 'text-slate-400',
      title: 'font-medium text-muted-foreground',
    },
    suggestion: {
      card: 'bg-purple-500/10 border-purple-500/20',
      icon: 'text-purple-500',
      title: 'font-medium text-purple-500',
    },
  }[severity];

  return (
    <div
      className={cn(
        'group/comment rounded-lg border p-2 transition-colors cursor-pointer',
        isResolved ? 'bg-muted/40 border-border/50' : severityStyles?.card
      )}
      onClick={onNavigate}
    >
      {/* Header row */}
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 min-w-0">
            <span className={cn('text-xs leading-tight line-clamp-2', isResolved ? 'font-medium text-muted-foreground' : severityStyles?.title)}>{title}</span>
            {isResolved && <ResolutionBadge type={comment.resolutionType} />}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!isResolved && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-5 w-5 p-0 transition-opacity duration-150',
                    addedToChat
                      ? 'opacity-100'
                      : 'opacity-0 group-hover/comment:opacity-40 hover:!opacity-100 hover:bg-foreground/10'
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToChat?.(comment);
                  }}
                >
                  {addedToChat ? (
                    <MessageSquareDot className="h-3 w-3 text-foreground" />
                  ) : (
                    <MessageSquarePlus className="h-3 w-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {addedToChat ? 'Re-add to chat' : 'Add to chat'}
              </TooltipContent>
            </Tooltip>
          )}
          {isResolved ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 hover:bg-foreground/10"
              onClick={(e) => {
                e.stopPropagation();
                onUnresolve?.();
              }}
              title="Mark as open"
            >
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 hover:bg-foreground/10"
                  onClick={(e) => e.stopPropagation()}
                  title="Resolve comment"
                >
                  <Circle className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => onResolveAs?.('fixed')}>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  Mark as Fixed
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onResolveAs?.('ignored')}>
                  <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  Mark as Ignored
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Footer row - location and time */}
      <div className="flex items-center gap-1.5 mt-1 text-2xs text-muted-foreground min-w-0">
        {!isResolved && (
          <SeverityIcon className={cn('h-3 w-3 shrink-0', severityStyles?.icon)} />
        )}
        {comment.lineNumber > 0 && (
          <span
            className="truncate min-w-0"
            title={showFilePath ? `${comment.filePath}:${comment.lineNumber}` : undefined}
          >
            {showFilePath
              ? `${comment.filePath}:${comment.lineNumber}`
              : `L${comment.lineNumber}`
            }
          </span>
        )}
        <span className="ml-auto shrink-0">
          {formatTimeAgo(comment.createdAt)}
        </span>
      </div>
    </div>
  );
}
