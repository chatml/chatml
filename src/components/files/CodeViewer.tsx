'use client';

import { memo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Check, Loader2, Code, Eye, SplitSquareHorizontal, Rows, WrapText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PierreEditor } from '@/components/files/PierreEditor';
import { PierreDiffEditor } from '@/components/files/PierreDiffEditor';
import { COPY_FEEDBACK_DURATION_MS, PROSE_CLASSES } from '@/lib/constants';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { getShikiLanguage } from '@/lib/languageMapping';
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
  onResolveComment?: (id: string, resolved: boolean) => void;
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
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'rendered'>(
    isMarkdownFile(filename) ? 'rendered' : 'code'
  );
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  // Reset view mode when switching files
  const [prevFilename, setPrevFilename] = useState(filename);
  if (prevFilename !== filename) {
    setPrevFilename(filename);
    setViewMode(isMarkdownFile(filename) ? 'rendered' : 'code');
  }

  const isMarkdown = isMarkdownFile(filename);
  const isDiffMode = typeof oldContent === 'string';
  const language = getShikiLanguage(filename);

  const handleCopy = async () => {
    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } else {
      toast.error('Failed to copy to clipboard');
    }
  };

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

  // Render diff view (split or unified)
  if (isDiffMode) {
    return (
      <div className="h-full flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 text-2xs text-muted-foreground min-w-0">
            <span className="font-mono shrink-0">{language}</span>
            <span className="shrink-0">|</span>
            <span className="font-mono truncate" title={filename}>{filename}</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Diff view mode toggle */}
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
              onClick={() => setWordWrap(!wordWrap)}
              title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
            >
              <WrapText className="w-2.5 h-2.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="w-2.5 h-2.5 text-text-success" />
              ) : (
                <Copy className="w-2.5 h-2.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Diff content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <PierreDiffEditor
            oldContent={oldContent || ''}
            newContent={content || ''}
            filename={filename}
            sideBySide={diffViewMode === 'split'}
            wordWrap={wordWrap}
            comments={comments}
            onResolveComment={onResolveComment}
            onDeleteComment={onDeleteComment}
            onCreateComment={onCreateComment}
            scrollToLine={scrollToLine}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-2xs text-muted-foreground min-w-0">
          <span className="font-mono shrink-0">{content.split('\n').length} lines</span>
          <span className="shrink-0">|</span>
          <span className="font-mono shrink-0">{language}</span>
          <span className="shrink-0">|</span>
          <span className="font-mono truncate" title={filename}>{filename}</span>
        </div>
        <div className="flex items-center gap-1">
          {isMarkdown && (
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-5 w-5 text-muted-foreground', viewMode === 'rendered' && 'bg-muted')}
              onClick={() => setViewMode(viewMode === 'code' ? 'rendered' : 'code')}
              title={viewMode === 'code' ? 'Show rendered' : 'Show code'}
            >
              {viewMode === 'code' ? (
                <Eye className="w-2.5 h-2.5" />
              ) : (
                <Code className="w-2.5 h-2.5" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-5 w-5 text-muted-foreground', wordWrap && 'bg-muted')}
            onClick={() => setWordWrap(!wordWrap)}
            title={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}
          >
            <WrapText className="w-2.5 h-2.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="w-2.5 h-2.5 text-text-success" />
            ) : (
              <Copy className="w-2.5 h-2.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isMarkdown && viewMode === 'rendered' ? (
          <div className="h-full overflow-auto overscroll-contain">
            <div className={cn(PROSE_CLASSES, 'px-6 py-5')}>
              <CachedMarkdown cacheKey={`file-preview:${filename}`} content={content} skipCache />
            </div>
          </div>
        ) : (
          <PierreEditor
            content={content}
            filename={filename}
            wordWrap={wordWrap}
          />
        )}
      </div>
    </div>
  );
});
