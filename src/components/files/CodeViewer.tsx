'use client';

import { memo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Code } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PierreEditor } from '@/components/files/PierreEditor';
import { PierreDiffEditor } from '@/components/files/PierreDiffEditor';
import { PROSE_CLASSES } from '@/lib/constants';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { CopyButton } from '@/components/shared/CopyButton';
import type { ReviewComment } from '@/lib/types';

interface CodeViewerProps {
  content: string;
  filename: string;
  isLoading?: boolean;
  /** If provided, shows a diff view comparing oldContent to content */
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
}

function isMarkdownFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ext === 'md' || ext === 'mdx';
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
}: CodeViewerProps) {
  const [viewMode, setViewMode] = useState<'code' | 'rendered'>(
    isMarkdownFile(filename) ? 'rendered' : 'code'
  );

  // Reset view mode when switching files
  const [prevFilename, setPrevFilename] = useState(filename);
  if (prevFilename !== filename) {
    setPrevFilename(filename);
    setViewMode(isMarkdownFile(filename) ? 'rendered' : 'code');
  }

  const isMarkdown = isMarkdownFile(filename);
  const isDiffMode = typeof oldContent === 'string';
  const getContent = useCallback(() => content, [content]);

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
  if (isDiffMode && !content && !oldContent) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">No changes to display</span>
      </div>
    );
  }

  // Show empty file only if not in diff mode and content is empty
  if (!isDiffMode && !content) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Empty file</span>
      </div>
    );
  }

  // Render diff view — Pierre's native header + our toggle buttons via renderHeaderMetadata
  if (isDiffMode) {
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
        />
      </div>
    );
  }

  // Render markdown rendered view with minimal fallback header
  if (isMarkdown && viewMode === 'rendered') {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 text-2xs text-muted-foreground min-w-0">
            <span className="font-mono truncate" title={filename}>{filename}</span>
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

  // Render file view — Pierre's native header + our toggle buttons via renderHeaderMetadata
  return (
    <div className="h-full">
      <PierreEditor
        content={content}
        filename={filename}
        onToggleMarkdownView={isMarkdown ? () => setViewMode(v => v === 'code' ? 'rendered' : 'code') : undefined}
      />
    </div>
  );
});
