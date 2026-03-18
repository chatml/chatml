'use client';

import { memo, useMemo, useState, useCallback } from 'react';
import { FileDiff } from '@/lib/pierre';
import type { FileContents } from '@/lib/pierre';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import { useDiffWorker } from '@/hooks/useDiffWorker';
import { FileCode, Loader2, Rows, SplitSquareHorizontal, WrapText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { CopyButton } from '@/components/shared/CopyButton';
import { getShikiLanguage } from '@/lib/languageMapping';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Ensure strings end with newline to suppress Pierre's "No newline at end of file" marker
const ensureTrailingNewline = (s: string) => s.endsWith('\n') ? s : s + '\n';

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
    contents: ensureTrailingNewline(oldString),
    lang: language as FileContents['lang'],
    cacheKey: `tool-edit-old:${filePath}:${oldString.length}:${oldString.slice(0, 64)}`,
  }), [filename, filePath, oldString, language]);

  const newFile: FileContents = useMemo(() => ({
    name: filename,
    contents: ensureTrailingNewline(newString),
    lang: language as FileContents['lang'],
    cacheKey: `tool-edit-new:${filePath}:${newString.length}:${newString.slice(0, 64)}`,
  }), [filename, filePath, newString, language]);

  const { fileDiff, isPending: isDiffPending } = useDiffWorker(oldFile, newFile);

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
        {isDiffPending && !fileDiff ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Computing diff...</span>
            </div>
          </div>
        ) : fileDiff ? (
          <FileDiff
            fileDiff={fileDiff}
            options={options}
            renderHeaderMetadata={renderHeaderMetadata}
          />
        ) : null}
      </div>
    </ErrorBoundary>
  );
});
