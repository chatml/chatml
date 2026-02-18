'use client';

import { memo, useState, useMemo, useCallback } from 'react';
import { File as PierreFile } from '@pierre/diffs/react';
import type { FileContents, FileOptions } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { FileCode, Eye, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { CopyButton } from '@/components/shared/CopyButton';
import { getShikiLanguage } from '@/lib/languageMapping';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Injected into Pierre's Shadow DOM to improve scroll performance.
// - Removes position:sticky from line numbers (avoids 1000s of sticky recalculations per scroll frame)
// - Adds CSS containment to the code grid so the browser can optimize layout/paint
const SCROLL_PERF_CSS = [
  '[data-column-number] { position: relative !important; }',
  'code { contain: layout style paint !important; }',
].join('\n');

// Pierre renders all lines eagerly into the DOM (no virtualization).
// Truncate large files to keep the UI responsive.
const MAX_LINES = 10000;

interface PierreEditorProps {
  content: string;
  filename: string;
  onToggleMarkdownView?: () => void;
}

function truncateContent(content: string): { text: string; truncated: boolean; totalLines: number } {
  const lines = content.split('\n');
  if (lines.length <= MAX_LINES) {
    return { text: content, truncated: false, totalLines: lines.length };
  }
  return { text: lines.slice(0, MAX_LINES).join('\n'), truncated: true, totalLines: lines.length };
}

export const PierreEditor = memo(function PierreEditor({
  content,
  filename,
  onToggleMarkdownView,
}: PierreEditorProps) {
  const { resolvedTheme } = useTheme();
  const themeType = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [showAll, setShowAll] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);

  const getContent = useCallback(() => content, [content]);

  // Reset showAll when file changes
  const [prevFilename, setPrevFilename] = useState(filename);
  if (prevFilename !== filename) {
    setPrevFilename(filename);
    setShowAll(false);
  }

  const language = getShikiLanguage(filename);

  const { text: displayContent, truncated, totalLines } = useMemo(
    () => showAll ? { text: content, truncated: false, totalLines: content.split('\n').length } : truncateContent(content),
    [content, showAll],
  );

  const handleShowAll = useCallback(() => setShowAll(true), []);

  const renderHeaderMetadata = useCallback(() => (
    <div className="flex items-center gap-1">
      {onToggleMarkdownView && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground"
          onClick={onToggleMarkdownView}
          title="Show rendered"
        >
          <Eye className="w-2.5 h-2.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-5 w-5 text-muted-foreground', wordWrap && 'bg-muted')}
        onClick={() => setWordWrap(w => !w)}
        title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
      >
        <WrapText className="w-2.5 h-2.5" />
      </Button>
      <CopyButton getText={getContent} />
    </div>
  ), [onToggleMarkdownView, wordWrap, getContent]);

  const file: FileContents = useMemo(() => ({
    name: filename,
    contents: displayContent,
    lang: language as FileContents['lang'],
    cacheKey: `${filename}:${displayContent.length}:${displayContent.slice(0, 64)}`,
  }), [filename, displayContent, language]);

  const options: FileOptions<undefined> = useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType,
    overflow: wordWrap ? 'wrap' as const : 'scroll' as const,
    tokenizeMaxLineLength: 500,
    unsafeCSS: SCROLL_PERF_CSS,
  }), [themeType, wordWrap]);

  return (
    <ErrorBoundary
      section="PierreEditor"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Editor failed to load"
          description="There was an error initializing the code viewer"
        />
      }
    >
      <div className="h-full overflow-auto overscroll-contain relative z-0">
        <PierreFile
          file={file}
          options={options}
          renderHeaderMetadata={renderHeaderMetadata}
        />
        {truncated && (
          <div className="sticky bottom-0 flex items-center justify-center gap-2 px-4 py-2 bg-muted/80 backdrop-blur-sm border-t text-xs text-muted-foreground">
            <span>Showing {MAX_LINES.toLocaleString()} of {totalLines.toLocaleString()} lines</span>
            <button
              onClick={handleShowAll}
              className="text-primary hover:underline font-medium"
            >
              Show all
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
});
