'use client';

import { useState, useEffect } from 'react';
import { codeToHtml } from 'shiki';
import { useTheme } from 'next-themes';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'github-markdown-css';
import { Button } from '@/components/ui/button';
import { Copy, Check, Loader2, Code, Eye, SplitSquareHorizontal, Rows, WrapText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MonacoEditor, MonacoDiffEditor } from '@/components/MonacoEditor';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';
import { getShikiLanguage } from '@/lib/languageMapping';

interface EditorState {
  cursorPosition?: { line: number; column: number };
  scrollPosition?: { top: number; left: number };
}

interface CodeViewerProps {
  content: string;
  filename: string;
  isLoading?: boolean;
  /** If provided, shows a diff view comparing oldContent to content */
  oldContent?: string;
  /** Callback when editor state changes (cursor/scroll position) */
  onStateChange?: (state: EditorState) => void;
  /** Initial cursor position to restore */
  initialCursorPosition?: { line: number; column: number };
  /** Initial scroll position to restore */
  initialScrollPosition?: { top: number; left: number };
}

function isMarkdownFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ext === 'md' || ext === 'mdx';
}

export function CodeViewer({
  content,
  filename,
  isLoading,
  oldContent,
  onStateChange,
  initialCursorPosition,
  initialScrollPosition,
}: CodeViewerProps) {
  const { resolvedTheme } = useTheme();
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const [isHighlighting, setIsHighlighting] = useState(true);
  const [copied, setCopied] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [viewMode, setViewMode] = useState<'code' | 'rendered'>('code');
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const [wordWrap, setWordWrap] = useState(false);

  const isMarkdown = isMarkdownFile(filename);
  const isDiffMode = typeof oldContent === 'string';
  const language = getShikiLanguage(filename);

  useEffect(() => {
    // Monaco handles diff mode highlighting
    if (isDiffMode) {
      queueMicrotask(() => setIsHighlighting(false));
      return;
    }

    if (isLoading) {
      queueMicrotask(() => {
        setHighlightedHtml('');
        setIsHighlighting(false);
      });
      return;
    }

    if (!content) {
      queueMicrotask(() => {
        setHighlightedHtml('');
        setIsHighlighting(false);
      });
      return;
    }

    const lineCount = content.split('\n').length;
    queueMicrotask(() => {
      setIsHighlighting(true);
      setLineCount(lineCount);
    });

    // Use the appropriate theme based on current app theme
    const theme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

    codeToHtml(content, {
      lang: language,
      theme: theme,
    })
      .then((html) => {
        setHighlightedHtml(html);
        setIsHighlighting(false);
      })
      .catch((err) => {
        console.error('Syntax highlighting failed:', err);
        // Fallback to plain text
        setHighlightedHtml(`<pre class="shiki"><code>${escapeHtml(content)}</code></pre>`);
        setIsHighlighting(false);
      });
  }, [content, oldContent, filename, isLoading, resolvedTheme, isDiffMode, diffViewMode, language]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
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
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
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
                <Check className="w-2.5 h-2.5 text-green-500" />
              ) : (
                <Copy className="w-2.5 h-2.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Diff content - Monaco for both split and unified views */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <MonacoDiffEditor
            oldContent={oldContent || ''}
            newContent={content || ''}
            filename={filename}
            readOnly={true}
            sideBySide={diffViewMode === 'split'}
            wordWrap={wordWrap}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
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
              <Check className="w-2.5 h-2.5 text-green-500" />
            ) : (
              <Copy className="w-2.5 h-2.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isMarkdown && viewMode === 'rendered' ? (
          <div
            className="h-full overflow-auto overscroll-contain"
            data-color-mode={resolvedTheme === 'dark' ? 'dark' : 'light'}
          >
            <div className="markdown-body !bg-transparent px-6 py-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        ) : isMarkdown && viewMode === 'code' ? (
          // For markdown in code view, use Monaco
          <MonacoEditor
            content={content}
            filename={filename}
            readOnly={true}
            wordWrap={wordWrap}
            onStateChange={onStateChange}
            initialCursorPosition={initialCursorPosition}
            initialScrollPosition={initialScrollPosition}
          />
        ) : (
          // For all other code files, use Monaco
          <MonacoEditor
            content={content}
            wordWrap={wordWrap}
            filename={filename}
            readOnly={true}
            onStateChange={onStateChange}
            initialCursorPosition={initialCursorPosition}
            initialScrollPosition={initialScrollPosition}
          />
        )}
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

