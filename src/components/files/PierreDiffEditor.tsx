'use client';

import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { FileDiff } from '@pierre/diffs/react';
import type { FileContents, DiffLineAnnotation } from '@pierre/diffs/react';
import type { FileDiffOptions, FileDiffMetadata, OnDiffLineClickProps } from '@pierre/diffs';
import { parseDiffFromFile } from '@pierre/diffs';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { FileCode, Rows, SplitSquareHorizontal, WrapText } from 'lucide-react';
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

interface PierreDiffEditorProps {
  oldContent: string;
  newContent: string;
  filename: string;
  comments?: ReviewComment[];
  onResolveComment?: (id: string, resolved: boolean) => void;
  onDeleteComment?: (id: string) => void;
  onCreateComment?: (lineNumber: number, content: string) => void;
  /** Line number to scroll to (e.g. from review comment click) */
  scrollToLine?: number;
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
}: PierreDiffEditorProps) {
  const themeType = useResolvedThemeType();
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  const getNewContent = useCallback(() => newContent, [newContent]);

  const language = getShikiLanguage(filename);

  const oldFile: FileContents = useMemo(() => ({
    name: filename,
    contents: oldContent,
    lang: language as FileContents['lang'],
    cacheKey: `old:${filename}:${oldContent.length}:${oldContent.slice(0, 64)}`,
  }), [filename, oldContent, language]);

  const newFile: FileContents = useMemo(() => ({
    name: filename,
    contents: newContent,
    lang: language as FileContents['lang'],
    cacheKey: `new:${filename}:${newContent.length}:${newContent.slice(0, 64)}`,
  }), [filename, newContent, language]);

  // Parse diff synchronously — separates computation from rendering
  const fileDiff: FileDiffMetadata = useMemo(() => {
    return parseDiffFromFile(oldFile, newFile);
  }, [oldFile, newFile]);

  // Handle line number click to open comment input
  const handleLineNumberClick = useCallback((props: OnDiffLineClickProps) => {
    if (!onCreateComment) return;
    if (props.annotationSide === 'additions') {
      setActiveCommentLine(props.lineNumber);
    }
  }, [onCreateComment]);

  const renderHeaderMetadata = useCallback(() => (
    <div className="flex items-center gap-1">
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
  ), [diffViewMode, wordWrap, getNewContent]);

  const options: FileDiffOptions<CommentAnnotationData> = useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType,
    diffStyle: diffViewMode === 'split' ? 'split' as const : 'unified' as const,
    overflow: wordWrap ? 'wrap' as const : 'scroll' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word' as const,
    tokenizeMaxLineLength: 500,
    onLineNumberClick: handleLineNumberClick,
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

    if (data.type === 'comment' && data.comment) {
      return (
        <CommentThread
          comment={data.comment}
          onResolve={onResolveComment ?? (() => {})}
          onDelete={onDeleteComment}
        />
      );
    }

    if (data.type === 'input' && onCreateComment) {
      return (
        <InlineCommentInput
          onSubmit={(content) => {
            onCreateComment(activeCommentLine!, content);
            setActiveCommentLine(null);
          }}
          onCancel={() => setActiveCommentLine(null)}
        />
      );
    }

    return null;
  }, [onResolveComment, onDeleteComment, onCreateComment, activeCommentLine]);

  // Scroll to target line when scrollToLine or diff content changes (e.g. review comment click)
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollToLine == null || !scrollContainerRef.current) return;
    // Pierre renders inside a Shadow DOM — query through it
    const container = scrollContainerRef.current;
    const pierreEl = container.querySelector('diffs-container');
    const shadowRoot = pierreEl?.shadowRoot;
    if (!shadowRoot) return;
    // Delay to allow Pierre to finish rendering after diff content loads
    const timer = setTimeout(() => {
      const lineEl = shadowRoot.querySelector(`[data-line="${scrollToLine}"]`);
      if (lineEl) {
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
    return () => clearTimeout(timer);
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
        <FileDiff<CommentAnnotationData>
          fileDiff={fileDiff}
          options={options}
          lineAnnotations={lineAnnotations}
          renderAnnotation={renderAnnotation}
          renderHeaderMetadata={renderHeaderMetadata}
        />
      </div>
    </ErrorBoundary>
  );
});
