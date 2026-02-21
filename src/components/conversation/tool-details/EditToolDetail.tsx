'use client';

import { memo, useMemo, useState, useCallback } from 'react';
import { FileDiff } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import type { FileDiffMetadata } from '@pierre/diffs';
import { parseDiffFromFile } from '@pierre/diffs';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { FileCode, Rows, SplitSquareHorizontal, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { CopyButton } from '@/components/shared/CopyButton';
import { getShikiLanguage } from '@/lib/languageMapping';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

interface EditToolDetailProps {
  oldString: string;
  newString: string;
  filePath: string;
}

export const EditToolDetail = memo(function EditToolDetail({
  oldString,
  newString,
  filePath,
}: EditToolDetailProps) {
  const themeType = useResolvedThemeType();
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  const getNewContent = useCallback(() => newString, [newString]);

  const filename = filePath.split('/').pop() || filePath;
  const language = getShikiLanguage(filename);

  const oldFile: FileContents = useMemo(() => ({
    name: filename,
    contents: oldString,
    lang: language as FileContents['lang'],
    cacheKey: `tool-edit-old:${filePath}:${oldString.length}:${oldString.slice(0, 64)}`,
  }), [filename, filePath, oldString, language]);

  const newFile: FileContents = useMemo(() => ({
    name: filename,
    contents: newString,
    lang: language as FileContents['lang'],
    cacheKey: `tool-edit-new:${filePath}:${newString.length}:${newString.slice(0, 64)}`,
  }), [filename, filePath, newString, language]);

  const fileDiff: FileDiffMetadata = useMemo(() => {
    return parseDiffFromFile(oldFile, newFile);
  }, [oldFile, newFile]);

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

  const options = useMemo(() => ({
    theme: PIERRE_THEMES,
    themeType,
    diffStyle: diffViewMode === 'split' ? 'split' as const : 'unified' as const,
    overflow: wordWrap ? 'wrap' as const : 'scroll' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word' as const,
    tokenizeMaxLineLength: 500,
  }), [themeType, diffViewMode, wordWrap]);

  return (
    <ErrorBoundary
      section="EditToolDetail"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Diff viewer failed to load"
          description="There was an error initializing the diff viewer"
        />
      }
    >
      <div className="max-h-[400px] overflow-auto overscroll-contain relative z-0 rounded border">
        <FileDiff
          fileDiff={fileDiff}
          options={options}
          renderHeaderMetadata={renderHeaderMetadata}
        />
      </div>
    </ErrorBoundary>
  );
});
