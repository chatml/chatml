'use client';

import { useState, useEffect, useRef } from 'react';
import { codeToHtml } from 'shiki';
import { useTheme } from 'next-themes';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createTwoFilesPatch } from 'diff';
import 'github-markdown-css';
import { Button } from '@/components/ui/button';
import { Copy, Check, Loader2, Code, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeViewerProps {
  content: string;
  filename: string;
  isLoading?: boolean;
  /** If provided, shows a diff view comparing oldContent to content */
  oldContent?: string;
}

// Map file extensions to shiki language identifiers
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // Special files
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name === '.gitignore' || name === '.dockerignore') return 'ignore';

  const langMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mjs: 'javascript',
    cjs: 'javascript',
    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    // Data/Config
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    // Documentation
    md: 'markdown',
    mdx: 'mdx',
    // Programming languages
    go: 'go',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'zsh',
    ps1: 'powershell',
    // SQL
    sql: 'sql',
    // Others
    graphql: 'graphql',
    gql: 'graphql',
    prisma: 'prisma',
    env: 'dotenv',
    lock: 'text',
    txt: 'text',
  };

  return langMap[ext] || 'text';
}

function isMarkdownFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ext === 'md' || ext === 'mdx';
}

export function CodeViewer({ content, filename, isLoading, oldContent }: CodeViewerProps) {
  const { resolvedTheme } = useTheme();
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const [isHighlighting, setIsHighlighting] = useState(true);
  const [copied, setCopied] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [viewMode, setViewMode] = useState<'code' | 'rendered'>('code');
  const contentRef = useRef<HTMLDivElement>(null);

  const isMarkdown = isMarkdownFile(filename);
  const isDiffMode = typeof oldContent === 'string';

  useEffect(() => {
    if (isLoading) {
      setHighlightedHtml('');
      setIsHighlighting(false);
      return;
    }

    // In diff mode, allow empty content (deleted file) or empty oldContent (new file)
    if (!isDiffMode && !content) {
      setHighlightedHtml('');
      setIsHighlighting(false);
      return;
    }

    setIsHighlighting(true);

    let codeToHighlight: string;
    let language: string;

    if (isDiffMode) {
      // Generate unified diff
      const diffText = createTwoFilesPatch(
        filename,
        filename,
        oldContent || '',
        content || '',
        'original',
        'modified'
      );
      // Remove the header lines (first 4 lines) for cleaner display
      const lines = diffText.split('\n');
      codeToHighlight = lines.slice(4).join('\n');
      language = 'diff';
      setLineCount(lines.length - 4);
    } else {
      codeToHighlight = content;
      language = getLanguage(filename);
      setLineCount(content.split('\n').length);
    }

    // Use the appropriate theme based on current app theme
    const theme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

    codeToHtml(codeToHighlight, {
      lang: language,
      theme: theme,
    })
      .then((html) => {
        // For diff mode, add line-level styling for additions/deletions
        if (isDiffMode) {
          html = addDiffLineStyles(html);
        }
        setHighlightedHtml(html);
        setIsHighlighting(false);
      })
      .catch((err) => {
        console.error('Syntax highlighting failed:', err);
        // Fallback to plain text
        setHighlightedHtml(`<pre class="shiki"><code>${escapeHtml(codeToHighlight)}</code></pre>`);
        setIsHighlighting(false);
      });
  }, [content, oldContent, filename, isLoading, resolvedTheme, isDiffMode]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">{lineCount} lines</span>
          <span>|</span>
          <span className="font-mono">{isDiffMode ? 'diff' : getLanguage(filename)}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {isMarkdown && (
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-5 w-5', viewMode === 'rendered' && 'bg-muted')}
              onClick={() => setViewMode(viewMode === 'code' ? 'rendered' : 'code')}
              title={viewMode === 'code' ? 'Show rendered' : 'Show code'}
            >
              {viewMode === 'code' ? (
                <Eye className="w-3 h-3" />
              ) : (
                <Code className="w-3 h-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0 overscroll-contain">
        {isMarkdown && viewMode === 'rendered' ? (
          <div
            className="p-6 min-h-full"
            data-color-mode={resolvedTheme === 'dark' ? 'dark' : 'light'}
          >
            <div className="markdown-body !bg-transparent px-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {content}
              </ReactMarkdown>
            </div>
          </div>
        ) : isHighlighting ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex min-h-full">
            {/* Line numbers */}
            <div className="shrink-0 py-3 pl-3 pr-2 text-[11px] font-mono text-muted-foreground/50 text-right select-none border-r border-border/50 sticky left-0 bg-background min-h-full">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i + 1} className="leading-[18px]">
                  {i + 1}
                </div>
              ))}
            </div>
            {/* Code */}
            <div
              ref={contentRef}
              className={cn(
                'code-viewer text-[11px] font-mono flex-1 min-w-0 overflow-x-auto min-h-full',
                '[&_.shiki]:!bg-transparent [&_.shiki]:py-3 [&_.shiki]:pl-3 [&_.shiki]:pr-4',
                '[&_pre]:!bg-transparent [&_pre]:m-0',
                '[&_code]:block',
                '[&_.line]:leading-[18px] [&_.line]:min-h-[18px]',
                // Diff line backgrounds - full width with padding
                isDiffMode && '[&_.diff-add]:bg-green-500/15 [&_.diff-add]:pl-1 [&_.diff-add]:-ml-1 [&_.diff-add]:mr-0',
                isDiffMode && '[&_.diff-remove]:bg-red-500/15 [&_.diff-remove]:pl-1 [&_.diff-remove]:-ml-1 [&_.diff-remove]:mr-0',
                isDiffMode && '[&_.diff-hunk]:bg-blue-500/10 [&_.diff-hunk]:text-muted-foreground [&_.diff-hunk]:pl-1 [&_.diff-hunk]:-ml-1'
              )}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </div>
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

// Add background colors to diff lines based on their content
function addDiffLineStyles(html: string): string {
  // Shiki wraps each line in a span with class "line"
  // We need to detect if the line starts with +, -, or @@ and add appropriate styling
  return html.replace(/<span class="line">(.*?)<\/span>/g, (match, content) => {
    // Get the text content by stripping HTML tags
    const textContent = content.replace(/<[^>]*>/g, '');

    if (textContent.startsWith('+')) {
      return `<span class="line diff-add">${content}</span>`;
    } else if (textContent.startsWith('-')) {
      return `<span class="line diff-remove">${content}</span>`;
    } else if (textContent.startsWith('@@')) {
      return `<span class="line diff-hunk">${content}</span>`;
    }
    return match;
  });
}
