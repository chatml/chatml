'use client';

import { memo, useState, useMemo, useCallback } from 'react';
import { File as PierreFile } from '@pierre/diffs/react';
import type { FileContents, FileOptions } from '@pierre/diffs/react';
import { useTheme } from 'next-themes';
import { FileCode } from 'lucide-react';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { getShikiLanguage } from '@/lib/languageMapping';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Pierre renders all lines eagerly into the DOM (no virtualization).
// Truncate large files to keep the UI responsive.
const MAX_LINES = 10000;

interface PierreEditorProps {
  content: string;
  filename: string;
  wordWrap?: boolean;
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
  wordWrap = false,
}: PierreEditorProps) {
  const { resolvedTheme } = useTheme();
  const themeType = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [showAll, setShowAll] = useState(false);

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
    disableFileHeader: true,
    tokenizeMaxLineLength: 500,
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
