'use client';

import { memo, useMemo, useState, useCallback } from 'react';
import { File as PierreFile, PIERRE_THEMES } from '@/lib/pierre';
import type { FileContents, FileOptions } from '@/lib/pierre';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { FileCode, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { CopyButton } from '@/components/shared/CopyButton';
import { getShikiLanguage } from '@/lib/languageMapping';

const MAX_LINES = 5000;

interface CodeViewerDetailProps {
  content: string;
  filePath: string;
  /** Cache key prefix to distinguish different tool types (e.g. 'tool-read', 'tool-write') */
  cachePrefix: string;
}

function truncateContent(content: string): { text: string; truncated: boolean; totalLines: number } {
  const lines = content.split('\n');
  if (lines.length <= MAX_LINES) {
    return { text: content, truncated: false, totalLines: lines.length };
  }
  return { text: lines.slice(0, MAX_LINES).join('\n'), truncated: true, totalLines: lines.length };
}

export const CodeViewerDetail = memo(function CodeViewerDetail({
  content,
  filePath,
  cachePrefix,
}: CodeViewerDetailProps) {
  const themeType = useResolvedThemeType();
  const [wordWrap, setWordWrap] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const getContent = useCallback(() => content, [content]);

  const filename = filePath.split('/').pop() || filePath;
  const language = getShikiLanguage(filename);

  const { text: displayContent, truncated, totalLines } = useMemo(
    () => showAll ? { text: content, truncated: false, totalLines: content.split('\n').length } : truncateContent(content),
    [content, showAll],
  );

  const renderHeaderMetadata = useCallback(() => (
    <div className="flex items-center gap-1">
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
  ), [wordWrap, getContent]);

  const file: FileContents = useMemo(() => ({
    name: filename,
    contents: displayContent,
    lang: language as FileContents['lang'],
    cacheKey: `${cachePrefix}:${filePath}:${displayContent.length}:${displayContent.slice(0, 64)}`,
  }), [filename, filePath, displayContent, language, cachePrefix]);

  const options: FileOptions<undefined> = useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType,
    overflow: wordWrap ? 'wrap' as const : 'scroll' as const,
    tokenizeMaxLineLength: 500,
  }), [themeType, wordWrap]);

  return (
    <ErrorBoundary
      section="CodeViewerDetail"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Code viewer failed to load"
          description="There was an error initializing the code viewer"
        />
      }
    >
      <div className="max-h-[400px] overflow-auto overscroll-contain relative z-0 rounded border">
        <PierreFile
          file={file}
          options={options}
          renderHeaderMetadata={renderHeaderMetadata}
        />
        {truncated && (
          <div className="sticky bottom-0 flex items-center justify-center gap-2 px-4 py-2 bg-muted/80 backdrop-blur-sm border-t text-xs text-muted-foreground">
            <span>Showing {MAX_LINES.toLocaleString()} of {totalLines.toLocaleString()} lines</span>
            <button
              onClick={() => setShowAll(true)}
              className="text-brand hover:underline font-medium"
            >
              Show all
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
});
