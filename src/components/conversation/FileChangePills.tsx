'use client';

import { memo, useMemo, useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { FileCode, Loader2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useSelectedIds } from '@/stores/selectors';
import { getSessionFileDiff } from '@/lib/api/files';
import { getDiffFromCache, setDiffInCache } from '@/lib/diffCache';
import { extractTurnFileChanges, type TurnFileChange } from '@/lib/fileChangeUtils';
import type { ToolUsage } from '@/lib/types';
import type { FileDiffDTO } from '@/lib/api/files';

const PierreDiffEditor = lazy(() =>
  import('@/components/files/PierreDiffEditor').then((m) => ({ default: m.PierreDiffEditor }))
);

const MAX_VISIBLE_PILLS = 10;

interface FileChangePillsProps {
  toolUsage: ToolUsage[];
}

export const FileChangePills = memo(function FileChangePills({ toolUsage }: FileChangePillsProps) {
  const changes = useMemo(() => extractTurnFileChanges(toolUsage), [toolUsage]);

  if (changes.length === 0) return null;

  const visible = changes.slice(0, MAX_VISIBLE_PILLS);
  const overflow = changes.length - MAX_VISIBLE_PILLS;

  return (
    <div className="flex flex-wrap gap-1.5 items-center mt-2">
      {visible.map((change) => (
        <FilePill key={change.path} change={change} />
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs text-muted-foreground bg-muted/50 border border-border/50">
          +{overflow} more
        </span>
      )}
    </div>
  );
});

// ── Individual pill with diff popover ──

function FilePill({ change }: { change: TurnFileChange }) {
  const { selectedWorkspaceId, selectedSessionId } = useSelectedIds();
  const [isOpen, setIsOpen] = useState(false);
  const [diffData, setDiffData] = useState<FileDiffDTO | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isFetchingRef = useRef(false);

  const hasStats = change.additions > 0 || change.deletions > 0;

  const fetchDiff = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    if (isFetchingRef.current) return;

    // Check cache first
    const cached = getDiffFromCache(selectedWorkspaceId, selectedSessionId, change.path);
    if (cached) {
      setDiffData(cached);
      return;
    }

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const diff = await getSessionFileDiff(
        selectedWorkspaceId,
        selectedSessionId,
        change.path,
        controller.signal,
      );
      setDiffInCache(selectedWorkspaceId, selectedSessionId, change.path, diff);
      setDiffData(diff);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError('Failed to load diff');
    } finally {
      isFetchingRef.current = false;
      setIsLoading(false);
    }
  }, [selectedWorkspaceId, selectedSessionId, change.path]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open && !diffData) {
        fetchDiff();
      }
      if (!open) {
        abortRef.current?.abort();
        abortRef.current = null;
      }
    },
    [fetchDiff, diffData],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full',
            'text-2xs font-mono border border-border/50',
            'bg-surface-1 hover:bg-surface-2 transition-colors cursor-pointer',
          )}
        >
          <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="truncate max-w-[160px]">{change.basename}</span>
          {hasStats && (
            <span className="flex items-center gap-0.5 shrink-0">
              {change.additions > 0 && (
                <span className="text-text-success">+{change.additions}</span>
              )}
              {change.deletions > 0 && (
                <span className="text-text-error">-{change.deletions}</span>
              )}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-[600px] max-w-[90vw] max-h-[400px] overflow-hidden p-0"
      >
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && error && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">{error}</div>
        )}
        {!isLoading && !error && diffData && (
          <div className="max-h-[400px] overflow-auto">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <PierreDiffEditor
                oldContent={diffData.oldContent}
                newContent={diffData.newContent}
                filename={diffData.newFilename || change.path}
              />
            </Suspense>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
