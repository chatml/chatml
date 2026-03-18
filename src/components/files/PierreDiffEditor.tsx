'use client';

import { memo, useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { FileDiff } from '@/lib/pierre';
import type { FileContents, DiffLineAnnotation, FileDiffOptions, OnDiffLineClickProps } from '@/lib/pierre';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { useDiffWorker } from '@/hooks/useDiffWorker';
import { FileCode, Loader2, Rows, SplitSquareHorizontal, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { CopyButton } from '@/components/shared/CopyButton';
import { CommentThread } from '@/components/comments/CommentThread';
import { InlineCommentInput } from '@/components/comments/InlineCommentInput';
import { getShikiLanguage } from '@/lib/languageMapping';
import type { ReviewComment } from '@/lib/types';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Injected into Pierre's Shadow DOM to prevent annotation slots from causing horizontal overflow
// when the diff viewer is in scroll mode (line wrap off).
const ANNOTATION_OVERFLOW_CSS = '[data-overflow="scroll"] [data-annotation-slot] { overflow: hidden; }';

// Pierre renders all lines eagerly into the DOM (no virtualization).
// Truncate large diffs to keep the UI responsive — matches PierreEditor's limit.
const MAX_DIFF_LINES = 10000;

function countNewlines(s: string): number {
  let count = 0;
  let idx = -1;
  // eslint-disable-next-line no-cond-assign
  while ((idx = s.indexOf('\n', idx + 1)) !== -1) count++;
  return count;
}

function truncateDiffContent(
  oldContent: string,
  newContent: string,
): { old: string; new: string; truncated: boolean } {
  // Fast path: count newlines without allocating arrays
  const maxLines = Math.max(countNewlines(oldContent), countNewlines(newContent)) + 1;
  if (maxLines <= MAX_DIFF_LINES) {
    return { old: oldContent, new: newContent, truncated: false };
  }
  // Slow path: only split when we actually need to truncate
  return {
    old: oldContent.split('\n').slice(0, MAX_DIFF_LINES).join('\n'),
    new: newContent.split('\n').slice(0, MAX_DIFF_LINES).join('\n'),
    truncated: true,
  };
}

interface PierreDiffEditorProps {
  oldContent: string;
  newContent: string;
  filename: string;
  comments?: ReviewComment[];
  onResolveComment?: (id: string, resolved: boolean, resolutionType?: 'fixed' | 'ignored') => void;
  onDeleteComment?: (id: string) => void;
  onCreateComment?: (lineNumber: number, content: string) => void;
  /** Line number to scroll to (e.g. from review comment click) */
  scrollToLine?: number;
  /** Extra elements to render in the header bar (e.g. Diff/Edit toggle buttons) */
  headerMetadata?: React.ReactNode;
}

// Annotation metadata for review comments
interface CommentAnnotationData {
  type: 'comment' | 'input';
  comment?: ReviewComment;
}

export const PierreDiffEditor = memo(function PierreDiffEditor({
  oldContent,
  newContent,
  filename,
  comments,
  onResolveComment,
  onDeleteComment,
  onCreateComment,
  scrollToLine,
  headerMetadata,
}: PierreDiffEditorProps) {
  const themeType = useResolvedThemeType();
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const [wordWrap, setWordWrap] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);

  const getNewContent = useCallback(() => newContent, [newContent]);

  const language = getShikiLanguage(filename);

  // Truncate very large diffs to prevent unbounded DOM rendering
  const { old: truncatedOld, new: truncatedNew, truncated: isDiffTruncated } = useMemo(
    () => truncateDiffContent(oldContent, newContent),
    [oldContent, newContent],
  );

  const oldFile: FileContents = useMemo(() => ({
    name: filename,
    contents: truncatedOld,
    lang: language as FileContents['lang'],
    cacheKey: `old:${filename}:${truncatedOld.length}:${truncatedOld.slice(0, 64)}`,
  }), [filename, truncatedOld, language]);

  const newFile: FileContents = useMemo(() => ({
    name: filename,
    contents: truncatedNew,
    lang: language as FileContents['lang'],
    cacheKey: `new:${filename}:${truncatedNew.length}:${truncatedNew.slice(0, 64)}`,
  }), [filename, truncatedNew, language]);

  // Parse diff in a Web Worker to avoid blocking the main thread.
  // Falls back to synchronous computation if the worker is unavailable.
  const { fileDiff, isPending: isDiffPending } = useDiffWorker(oldFile, newFile);

  // Handle line number click to open comment input
  const handleLineNumberClick = useCallback((props: OnDiffLineClickProps) => {
    if (!onCreateComment) return;
    if (props.annotationSide === 'additions') {
      setActiveCommentLine(props.lineNumber);
    }
  }, [onCreateComment]);

  const renderHeaderMetadata = useCallback(() => (
    <div className="flex items-center gap-1">
      {headerMetadata}
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-5 w-5 text-muted-foreground', diffViewMode === 'unified' && 'bg-muted')}
        onClick={() => setDiffViewMode('unified')}
        title="Unified view"
      >
        <Rows className="w-2.5 h-2.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-5 w-5 text-muted-foreground', diffViewMode === 'split' && 'bg-muted')}
        onClick={() => setDiffViewMode('split')}
        title="Split view"
      >
        <SplitSquareHorizontal className="w-2.5 h-2.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-5 w-5 text-muted-foreground', wordWrap && 'bg-muted')}
        onClick={() => setWordWrap(w => !w)}
        title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
      >
        <WrapText className="w-2.5 h-2.5" />
      </Button>
      <CopyButton getText={getNewContent} />
    </div>
  ), [headerMetadata, diffViewMode, wordWrap, getNewContent]);

  const options: FileDiffOptions<CommentAnnotationData> = useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType,
    diffStyle: diffViewMode === 'split' ? 'split' as const : 'unified' as const,
    overflow: wordWrap ? 'wrap' as const : 'scroll' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word' as const,
    tokenizeMaxLineLength: 500,
    onLineNumberClick: handleLineNumberClick,
    unsafeCSS: ANNOTATION_OVERFLOW_CSS,
  }), [themeType, diffViewMode, wordWrap, handleLineNumberClick]);

  // Build annotations from review comments + active input
  const lineAnnotations = useMemo(() => {
    const annotations: DiffLineAnnotation<CommentAnnotationData>[] = [];

    if (comments) {
      for (const comment of comments) {
        annotations.push({
          lineNumber: comment.lineNumber,
          side: 'additions' as const,
          metadata: { type: 'comment', comment },
        });
      }
    }

    if (activeCommentLine !== null) {
      annotations.push({
        lineNumber: activeCommentLine,
        side: 'additions' as const,
        metadata: { type: 'input' },
      });
    }

    return annotations;
  }, [comments, activeCommentLine]);

  // Render annotation content
  const renderAnnotation = useCallback((annotation: DiffLineAnnotation<CommentAnnotationData>) => {
    const data = annotation.metadata;
    if (!data) return null;

    let content: ReactNode = null;

    if (data.type === 'comment' && data.comment) {
      content = (
        <CommentThread
          comment={data.comment}
          onResolve={onResolveComment ?? (() => {})}
          onDelete={onDeleteComment}
        />
      );
    } else if (data.type === 'input' && onCreateComment) {
      content = (
        <InlineCommentInput
          onSubmit={(c) => {
            onCreateComment(activeCommentLine!, c);
            setActiveCommentLine(null);
          }}
          onCancel={() => setActiveCommentLine(null)}
        />
      );
    }

    if (!content) return null;

    // In scroll mode, clamp annotation width to the visible container so
    // comments don't extend beyond the viewport and cause horizontal overflow.
    if (!wordWrap && containerWidth > 0) {
      return (
        <div style={{ maxWidth: containerWidth, boxSizing: 'border-box' }}>
          {content}
        </div>
      );
    }

    return content;
  }, [onResolveComment, onDeleteComment, onCreateComment, activeCommentLine, wordWrap, containerWidth]);

  // Track visible container width so annotations can be clamped in scroll mode.
  // Uses RAF to debounce — avoids setting state on every resize frame.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let latestWidth = 0;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        latestWidth = entry.contentRect.width;
      }
      if (rafId !== null) return; // Already scheduled — will use latestWidth
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setContainerWidth(latestWidth);
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Scroll to target line when scrollToLine or diff content changes (e.g. review comment click).
  // Pierre renders into Shadow DOM asynchronously, so poll until the element appears
  // instead of relying on a hard-coded delay.
  useEffect(() => {
    if (scrollToLine == null || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    let attempts = 0;
    const maxAttempts = 10;
    const intervalMs = 50;
    const timerId = setInterval(() => {
      attempts++;
      const pierreEl = container.querySelector('diffs-container');
      const shadowRoot = pierreEl?.shadowRoot;
      if (!shadowRoot) {
        if (attempts >= maxAttempts) clearInterval(timerId);
        return;
      }
      const lineEl = shadowRoot.querySelector(`[data-line="${scrollToLine}"]`);
      if (lineEl) {
        clearInterval(timerId);
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (attempts >= maxAttempts) {
        clearInterval(timerId);
      }
    }, intervalMs);
    return () => clearInterval(timerId);
  }, [scrollToLine, fileDiff]);

  return (
    <ErrorBoundary
      section="PierreDiffEditor"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Diff editor failed to load"
          description="There was an error initializing the diff viewer"
        />
      }
    >
      <div ref={scrollContainerRef} className="h-full overflow-auto overscroll-contain relative z-0">
        {isDiffPending && !fileDiff ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Computing diff...</span>
            </div>
          </div>
        ) : fileDiff ? (
          <FileDiff<CommentAnnotationData>
            fileDiff={fileDiff}
            options={options}
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
            renderHeaderMetadata={renderHeaderMetadata}
          />
        ) : null}
        {isDiffTruncated && (
          <div className="text-center py-3 text-xs text-muted-foreground border-t bg-muted/30">
            Diff truncated to {MAX_DIFF_LINES.toLocaleString()} lines for performance
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
});
