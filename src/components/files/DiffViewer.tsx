'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { DiffView, DiffModeEnum, SplitSide } from '@git-diff-view/react';
import { DiffFile, generateDiffFile } from '@git-diff-view/file';
import '@git-diff-view/react/styles/diff-view.css';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  SplitSquareHorizontal,
  Rows,
  Send,
  Loader2,
  FileCode,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';

// Pre-computed skeleton widths (avoids Math.random() during render)
const DIFF_SKELETON_WIDTHS = [52, 78, 45, 89, 63, 71, 48, 85, 56, 74, 42, 82];

export interface DiffComment {
  id: string;
  lineNumber: number;
  side: 'old' | 'new';
  content: string;
  author: string;
  createdAt: string;
}

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  oldFilename: string;
  newFilename: string;
  language?: string;
  isLoading?: boolean;
  comments?: DiffComment[];
  onAddComment?: (lineNumber: number, side: 'old' | 'new', content: string) => void;
}

export function DiffViewer({
  oldContent,
  newContent,
  oldFilename,
  newFilename,
  language = 'text',
  isLoading,
  comments = [],
  onAddComment,
}: DiffViewerProps) {
  const { resolvedTheme } = useTheme();
  const [diffFile, setDiffFile] = useState<DiffFile | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('unified');
  const [activeCommentLine, setActiveCommentLine] = useState<{
    lineNumber: number;
    side: 'old' | 'new';
  } | null>(null);
  const [commentText, setCommentText] = useState('');

  // Generate diff file when content changes
  useEffect(() => {
    // Check for undefined/null but allow empty strings (new files have empty oldContent)
    if (isLoading || typeof oldContent !== 'string' || typeof newContent !== 'string') {
      queueMicrotask(() => setDiffFile(null));
      return;
    }

    try {
      const file = generateDiffFile(
        oldFilename,
        oldContent,
        newFilename,
        newContent,
        language,
        language
      );
      file.initTheme(resolvedTheme === 'dark' ? 'dark' : 'light');
      file.init();

      if (viewMode === 'split') {
        file.buildSplitDiffLines();
      } else {
        file.buildUnifiedDiffLines();
      }

      queueMicrotask(() => setDiffFile(file));
    } catch (err) {
      console.error('Failed to generate diff:', err);
    }
  }, [oldContent, newContent, oldFilename, newFilename, language, viewMode, resolvedTheme, isLoading]);

  // Group comments by line
  const commentsByLine = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    comments.forEach((comment) => {
      const key = `${comment.side}-${comment.lineNumber}`;
      const existing = map.get(key) || [];
      map.set(key, [...existing, comment]);
    });
    return map;
  }, [comments]);

  const handleAddComment = useCallback(() => {
    if (!activeCommentLine || !commentText.trim() || !onAddComment) return;
    onAddComment(activeCommentLine.lineNumber, activeCommentLine.side, commentText.trim());
    setCommentText('');
    setActiveCommentLine(null);
  }, [activeCommentLine, commentText, onAddComment]);

  // Render widget line (comment thread)
  const renderWidgetLine = useCallback(
    ({ lineNumber, side, onClose }: { lineNumber: number; side: SplitSide; diffFile: DiffFile; onClose: () => void }) => {
      const commentSide = side === SplitSide.old ? 'old' : 'new';
      const key = `${commentSide}-${lineNumber}`;
      const lineComments = commentsByLine.get(key) || [];
      const isAddingComment =
        activeCommentLine?.lineNumber === lineNumber &&
        activeCommentLine?.side === commentSide;

      if (lineComments.length === 0 && !isAddingComment) return null;

      return (
        <div className="bg-muted/50 border-y border-border p-3 space-y-2">
          {/* Existing comments */}
          {lineComments.map((comment) => (
            <div key={comment.id} className="bg-background rounded-md p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{comment.author}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-foreground">{comment.content}</p>
            </div>
          ))}

          {/* Comment input */}
          {isAddingComment && (
            <div className="bg-background rounded-md p-3 space-y-2">
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                className="min-h-[80px] text-sm"
                autoFocus
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActiveCommentLine(null);
                    setCommentText('');
                    onClose();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddComment}
                  disabled={!commentText.trim()}
                >
                  <Send className="w-3 h-3 mr-1" />
                  Comment
                </Button>
              </div>
            </div>
          )}
        </div>
      );
    },
    [commentsByLine, activeCommentLine, commentText, handleAddComment]
  );

  // Handle widget button click (add comment)
  const handleAddWidgetClick = useCallback(
    (lineNumber: number, side: SplitSide) => {
      const commentSide = side === SplitSide.old ? 'old' : 'new';
      setActiveCommentLine({ lineNumber, side: commentSide });
    },
    []
  );

  if (isLoading) {
    return (
      <div className="h-full flex flex-col" aria-busy="true" aria-label="Loading diff">
        {/* Skeleton toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-3 w-24 bg-muted-foreground/20 rounded animate-pulse" />
            <span className="text-muted-foreground/30">→</span>
            <div className="h-3 w-24 bg-muted-foreground/20 rounded animate-pulse" />
          </div>
          <div className="flex items-center gap-1">
            <div className="h-6 w-14 bg-muted-foreground/20 rounded animate-pulse" />
            <div className="h-6 w-16 bg-muted-foreground/20 rounded animate-pulse" />
          </div>
        </div>
        {/* Skeleton diff lines */}
        <div className="flex-1 overflow-hidden p-2 space-y-1">
          {DIFF_SKELETON_WIDTHS.map((width, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="h-4 w-8 bg-muted-foreground/10 rounded animate-pulse" />
              <div
                className="h-4 rounded animate-pulse"
                style={{
                  width: `${width}%`,
                  backgroundColor: i % 4 === 0 ? 'rgba(34, 197, 94, 0.1)' : i % 4 === 2 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(128, 128, 128, 0.1)',
                  animationDelay: `${i * 50}ms`,
                }}
              />
            </div>
          ))}
        </div>
        {/* Loading indicator */}
        <div className="flex items-center justify-center py-4 border-t bg-muted/20">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span className="text-sm">Loading diff...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!diffFile) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">No changes to display</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{oldFilename}</span>
          <span>→</span>
          <span className="font-mono">{newFilename}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={viewMode === 'split' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={() => setViewMode('split')}
          >
            <SplitSquareHorizontal className="w-3 h-3" />
            Split
          </Button>
          <Button
            variant={viewMode === 'unified' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 text-xs gap-1"
            onClick={() => setViewMode('unified')}
          >
            <Rows className="w-3 h-3" />
            Unified
          </Button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto min-h-0">
        <ErrorBoundary
          section="DiffView"
          fallback={
            <BlockErrorFallback
              icon={FileCode}
              title="Unable to render diff"
              description="There was an error displaying the file differences"
            />
          }
        >
          <DiffView
            diffFile={diffFile}
            diffViewMode={viewMode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
            diffViewHighlight
            diffViewAddWidget={!!onAddComment}
            renderWidgetLine={renderWidgetLine}
            onAddWidgetClick={handleAddWidgetClick}
            diffViewFontSize={12}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
