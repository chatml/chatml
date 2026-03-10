'use client';

import { memo, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PierreEditor } from '@/components/files/PierreEditor';
import { PierreDiffEditor } from '@/components/files/PierreDiffEditor';
import { MonacoEditor } from '@/components/files/MonacoEditor';
import { PROSE_CLASSES } from '@/lib/constants';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { CopyButton } from '@/components/shared/CopyButton';
import type { ReviewComment } from '@/lib/types';

type ViewMode = 'code' | 'rendered' | 'diff' | 'edit';

interface CodeViewerProps {
  content: string;
  filename: string;
  isLoading?: boolean;
  /** If provided, enables the Diff toggle button */
  oldContent?: string;
  /** Review comments to display in diff view */
  comments?: ReviewComment[];
  /** Callback when a comment is resolved/unresolved */
  onResolveComment?: (id: string, resolved: boolean, resolutionType?: 'fixed' | 'ignored') => void;
  /** Callback when a comment is deleted */
  onDeleteComment?: (id: string) => void;
  /** Callback when a user creates a new comment on a diff line */
  onCreateComment?: (lineNumber: number, content: string) => void;
  /** Line number to scroll to in diff view (e.g. from review comment click) */
  scrollToLine?: number;
  /** Callback when file content is edited. Enables the Edit toggle button. */
  onChange?: (content: string) => void;
  /** Initial word-wrap state for the code viewer (default: false) */
  defaultWordWrap?: boolean;
}

function isMarkdownFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ext === 'md' || ext === 'mdx';
}

function getDefaultViewMode(filename: string, hasOldContent?: boolean): ViewMode {
  if (hasOldContent) return 'diff';
  return isMarkdownFile(filename) ? 'rendered' : 'code';
}

export const CodeViewer = memo(function CodeViewer({
  content,
  filename,
  isLoading,
  oldContent,
  comments,
  onResolveComment,
  onDeleteComment,
  onCreateComment,
  scrollToLine,
  onChange,
  defaultWordWrap,
}: CodeViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(getDefaultViewMode(filename, typeof oldContent === 'string'));

  // Reset view mode when switching files
  const [prevFilename, setPrevFilename] = useState(filename);
  if (prevFilename !== filename) {
    setPrevFilename(filename);
    setViewMode(getDefaultViewMode(filename, typeof oldContent === 'string'));
  }

  // Reset view mode when diff data appears/disappears (loading → loaded transition).
  // Skip when the filename also changed — the block above already handles that case.
  const hasDiff = typeof oldContent === 'string';
  const [prevHasDiff, setPrevHasDiff] = useState(hasDiff);
  if (prevHasDiff !== hasDiff) {
    setPrevHasDiff(hasDiff);
    if (prevFilename === filename) {
      setViewMode(getDefaultViewMode(filename, hasDiff));
    }
  }

  const isMarkdown = isMarkdownFile(filename);
  const canEdit = !!onChange;
  const getContent = useCallback(() => content, [content]);

  // Toggle handler: clicking the active mode deselects it (returns to default)
  const toggleMode = useCallback(
    (mode: 'diff' | 'edit') => {
      setViewMode((current) => (current === mode ? getDefaultViewMode(filename) : mode));
    },
    [filename],
  );

  // --- Toggle buttons (Conductor-style) — must be before early returns ---
  const showToggles = hasDiff || canEdit;
  const toggleButtons = useMemo(() => {
    if (!showToggles) return null;
    return (
      <div className="flex items-center gap-0.5">
        {hasDiff && (
          <button
            onClick={() => toggleMode('diff')}
            className={cn(
              'px-2 py-0.5 text-2xs font-medium rounded-sm transition-colors',
              viewMode === 'diff'
                ? 'bg-brand/15 text-brand'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            Diff
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => toggleMode('edit')}
            className={cn(
              'px-2 py-0.5 text-2xs font-medium rounded-sm transition-colors',
              viewMode === 'edit'
                ? 'bg-brand/15 text-brand'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            Edit
          </button>
        )}
      </div>
    );
  }, [showToggles, hasDiff, canEdit, viewMode, toggleMode]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading file...</span>
        </div>
      </div>
    );
  }

  // In diff mode with no content at all (both old and new empty), show no changes
  if (hasDiff && !content && !oldContent) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">No changes to display</span>
      </div>
    );
  }

  // Show empty file only if not in diff mode and content is empty
  if (!hasDiff && !content && viewMode !== 'edit') {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Empty file</span>
      </div>
    );
  }

  // --- Edit mode: Monaco editor ---
  if (viewMode === 'edit' && canEdit) {
    return (
      <div className="h-full flex flex-col">
        {/* Header with toggles */}
        <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 text-2xs text-muted-foreground min-w-0">
            <span className="font-mono truncate" title={filename}>{filename}</span>
            {toggleButtons}
          </div>
          <div className="flex items-center gap-1">
            <CopyButton getText={getContent} />
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <MonacoEditor
            content={content}
            filename={filename}
            onChange={onChange}
          />
        </div>
      </div>
    );
  }

  // --- Diff mode: Pierre diff viewer (has its own header via renderHeaderMetadata) ---
  if (viewMode === 'diff' && hasDiff) {
    return (
      <div className="h-full">
        <PierreDiffEditor
          oldContent={oldContent || ''}
          newContent={content || ''}
          filename={filename}
          comments={comments}
          onResolveComment={onResolveComment}
          onDeleteComment={onDeleteComment}
          onCreateComment={onCreateComment}
          scrollToLine={scrollToLine}
          headerMetadata={toggleButtons}
        />
      </div>
    );
  }

  // --- Rendered markdown mode ---
  if (isMarkdown && viewMode === 'rendered') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 text-2xs text-muted-foreground min-w-0">
            <span className="font-mono truncate" title={filename}>{filename}</span>
            {toggleButtons}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground"
              onClick={() => setViewMode('code')}
              title="Show code"
            >
              <Code className="w-2.5 h-2.5" />
            </Button>
            <CopyButton getText={getContent} />
          </div>
        </div>
        <div className="flex-1 overflow-hidden min-h-0">
          <div className="h-full overflow-auto overscroll-contain">
            <div className={cn(PROSE_CLASSES, 'px-6 py-5')}>
              <CachedMarkdown cacheKey={`file-preview:${filename}`} content={content} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Default: Pierre code viewer ---
  return (
    <div className="h-full">
      <PierreEditor
        content={content}
        filename={filename}
        onToggleMarkdownView={isMarkdown ? () => setViewMode(v => v === 'code' ? 'rendered' : 'code') : undefined}
        headerMetadata={toggleButtons}
        defaultWordWrap={defaultWordWrap}
      />
    </div>
  );
});
