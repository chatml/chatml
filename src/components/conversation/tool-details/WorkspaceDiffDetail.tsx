'use client';

import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { FileDiff, parseDiffFromFile } from '@/lib/pierre';
import type { FileContents, FileDiffMetadata } from '@/lib/pierre';
import { useResolvedThemeType } from '@/hooks/useResolvedThemeType';
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  FilePlus2,
  FileMinus2,
  FileQuestion,
  Rows,
  SplitSquareHorizontal,
  WrapText,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, toRelativePath } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { BlockErrorFallback } from '@/components/shared/ErrorFallbacks';
import { CopyButton } from '@/components/shared/CopyButton';
import { getShikiLanguage } from '@/lib/languageMapping';
import { useAppStore } from '@/stores/appStore';
import {
  getSessionChanges,
  getSessionFileDiff,
  type FileChangeDTO,
  type FileDiffDTO,
} from '@/lib/api';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;
const LARGE_FILE_THRESHOLD = 500_000; // 500KB combined old+new
const MANY_FILES_THRESHOLD = 50;

// ── Main Component ─────────────────────────────────────────────────────

interface WorkspaceDiffDetailProps {
  stdout?: string;
  worktreePath?: string;
}

export const WorkspaceDiffDetail = memo(function WorkspaceDiffDetail({
  stdout,
  worktreePath,
}: WorkspaceDiffDetailProps) {
  const workspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const sessionId = useAppStore((s) => s.selectedSessionId);
  const hasContext = !!(workspaceId && sessionId);

  const [fileChanges, setFileChanges] = useState<FileChangeDTO[] | null>(null);
  const [loading, setLoading] = useState(hasContext);
  const [error, setError] = useState<string | null>(hasContext ? null : 'No active session');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const diffCacheRef = useRef(new Map<string, FileDiffDTO>());

  useEffect(() => {
    if (!workspaceId || !sessionId) return;

    let cancelled = false;

    // Clear per-file diff cache so stale data isn't shown after re-fetch
    diffCacheRef.current.clear();

    getSessionChanges(workspaceId, sessionId)
      .then((changes) => {
        if (!cancelled) {
          setFileChanges(changes);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [workspaceId, sessionId]);

  const totalAdditions = useMemo(
    () => fileChanges?.reduce((sum, c) => sum + c.additions, 0) ?? 0,
    [fileChanges],
  );
  const totalDeletions = useMemo(
    () => fileChanges?.reduce((sum, c) => sum + c.deletions, 0) ?? 0,
    [fileChanges],
  );

  const handleToggle = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Fallback: raw stdout if API failed or no context
  if (error || (!loading && !fileChanges)) {
    return (
      <div className="rounded border bg-muted p-2">
        <div className="text-2xs text-muted-foreground/60 mb-1">Output</div>
        <pre className="font-mono text-2xs text-foreground/80 whitespace-pre-wrap break-all max-h-[500px] overflow-y-auto">
          {stdout}
        </pre>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded border bg-muted p-3 text-2xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading file changes...
      </div>
    );
  }

  if (!fileChanges) return null;

  if (fileChanges.length === 0) {
    return (
      <div className="rounded border bg-muted/30 p-3 text-2xs text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <div className="max-h-[500px] overflow-auto overscroll-contain rounded border bg-muted/20">
      {/* Sticky summary header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-muted border-b text-2xs font-medium">
        <FileCode className="w-3 h-3 text-muted-foreground" />
        <span>
          {fileChanges.length} file{fileChanges.length !== 1 ? 's' : ''} changed
        </span>
        <span className="font-mono text-text-success">+{totalAdditions}</span>
        <span className="font-mono text-text-error">-{totalDeletions}</span>
      </div>

      {/* Warning for many files */}
      {fileChanges.length > MANY_FILES_THRESHOLD && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-2xs text-amber-500 bg-amber-500/10 border-b">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{fileChanges.length} files changed — expanding individual diffs may be slow</span>
        </div>
      )}

      {/* File rows */}
      <div className="divide-y divide-border/50">
        {fileChanges.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            isExpanded={expandedFiles.has(file.path)}
            onToggle={handleToggle}
            worktreePath={worktreePath}
            workspaceId={workspaceId!}
            sessionId={sessionId!}
            diffCacheRef={diffCacheRef}
          />
        ))}
      </div>
    </div>
  );
});

// ── File Row ───────────────────────────────────────────────────────────

const StatusIcon = memo(function StatusIcon({ status }: { status: FileChangeDTO['status'] }) {
  switch (status) {
    case 'added':
    case 'untracked':
      return <FilePlus2 className="w-3 h-3 text-text-success shrink-0" />;
    case 'deleted':
      return <FileMinus2 className="w-3 h-3 text-text-error shrink-0" />;
    case 'modified':
      return <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />;
    default:
      return <FileQuestion className="w-3 h-3 text-muted-foreground shrink-0" />;
  }
});

interface FileRowProps {
  file: FileChangeDTO;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  worktreePath?: string;
  workspaceId: string;
  sessionId: string;
  diffCacheRef: React.MutableRefObject<Map<string, FileDiffDTO>>;
}

const FileRow = memo(function FileRow({
  file,
  isExpanded,
  onToggle,
  worktreePath,
  workspaceId,
  sessionId,
  diffCacheRef,
}: FileRowProps) {
  const relativePath = toRelativePath(file.path, worktreePath);

  return (
    <div>
      <button
        onClick={() => onToggle(file.path)}
        className="flex items-center gap-2 px-3 py-1.5 w-full text-left text-2xs font-mono hover:bg-surface-2 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <StatusIcon status={file.status} />
        <span className="flex-1 truncate text-foreground/80">{relativePath}</span>
        {file.additions > 0 && (
          <span className="text-text-success shrink-0">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-text-error shrink-0">-{file.deletions}</span>
        )}
      </button>

      {isExpanded && (
        <div className="border-t bg-background">
          <ErrorBoundary
            section="WorkspaceDiffFile"
            fallback={
              <div className="px-3 py-2 text-2xs text-muted-foreground">
                Unable to load diff for this file
              </div>
            }
          >
            <FileDiffViewer filePath={file.path} workspaceId={workspaceId} sessionId={sessionId} diffCacheRef={diffCacheRef} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
});

// ── Per-File Diff Viewer ───────────────────────────────────────────────

interface FileDiffViewerProps {
  filePath: string;
  workspaceId: string;
  sessionId: string;
  diffCacheRef: React.MutableRefObject<Map<string, FileDiffDTO>>;
}

const FileDiffViewer = memo(function FileDiffViewer({
  filePath,
  workspaceId,
  sessionId,
  diffCacheRef,
}: FileDiffViewerProps) {
  const themeType = useResolvedThemeType();
  const [diffData, setDiffData] = useState<FileDiffDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  useEffect(() => {
    const cached = diffCacheRef.current.get(filePath);
    if (cached) {
      setDiffData(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;

    getSessionFileDiff(workspaceId, sessionId, filePath)
      .then((data) => {
        if (!cancelled) {
          diffCacheRef.current.set(filePath, data);
          setDiffData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [filePath, workspaceId, sessionId, diffCacheRef]);

  const getNewContent = useCallback(() => diffData?.newContent ?? '', [diffData]);

  const filename = filePath.split('/').pop() || filePath;
  const language = getShikiLanguage(filename);

  const oldFile: FileContents | null = useMemo(() => {
    if (!diffData) return null;
    return {
      name: filename,
      contents: diffData.oldContent,
      lang: language as FileContents['lang'],
      cacheKey: `ws-diff-old:${filePath}:${diffData.oldContent.length}:${diffData.oldContent.slice(0, 64)}`,
    };
  }, [filename, filePath, diffData, language]);

  const newFile: FileContents | null = useMemo(() => {
    if (!diffData) return null;
    return {
      name: filename,
      contents: diffData.newContent,
      lang: language as FileContents['lang'],
      cacheKey: `ws-diff-new:${filePath}:${diffData.newContent.length}:${diffData.newContent.slice(0, 64)}`,
    };
  }, [filename, filePath, diffData, language]);

  const fileDiff: FileDiffMetadata | null = useMemo(() => {
    if (!oldFile || !newFile) return null;
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
        onClick={() => setWordWrap((w) => !w)}
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-2xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 text-2xs text-text-error">
        Failed to load diff: {error}
      </div>
    );
  }

  if (!diffData) return null;

  // Server indicated file exceeded size limit — show unified diff fallback
  if (diffData.truncated) {
    return (
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-2xs text-amber-500">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>File too large for inline diff</span>
        </div>
        {diffData.unifiedDiff && (
          <pre className="max-h-[350px] overflow-auto text-2xs bg-muted/50 rounded p-2 whitespace-pre font-mono">
            {diffData.unifiedDiff}
          </pre>
        )}
      </div>
    );
  }

  if (!fileDiff) return null;

  // Guard against very large files
  const totalSize = (diffData.oldContent?.length ?? 0) + (diffData.newContent?.length ?? 0);
  if (totalSize > LARGE_FILE_THRESHOLD) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 text-2xs text-amber-500">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>File too large to display inline ({Math.round(totalSize / 1024)} KB)</span>
      </div>
    );
  }

  return (
    <ErrorBoundary
      section="FileDiffViewer"
      fallback={
        <BlockErrorFallback
          icon={FileCode}
          title="Diff viewer failed to load"
          description="There was an error initializing the diff viewer"
        />
      }
    >
      <div className="max-h-[350px] overflow-auto overscroll-contain relative z-0">
        <FileDiff
          fileDiff={fileDiff}
          options={options}
          renderHeaderMetadata={renderHeaderMetadata}
        />
      </div>
    </ErrorBoundary>
  );
});
