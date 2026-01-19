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
import { Copy, Check, Loader2, Code, Eye, SplitSquareHorizontal, Rows } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SplitDiffViewer } from '@/components/SplitDiffViewer';

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
  const [diffViewMode, setDiffViewMode] = useState<'split' | 'unified'>('unified');
  const contentRef = useRef<HTMLDivElement>(null);

  const isMarkdown = isMarkdownFile(filename);
  const isDiffMode = typeof oldContent === 'string';
  const language = getLanguage(filename);

  useEffect(() => {
    // In split diff mode, SplitDiffViewer handles highlighting
    if (isDiffMode && diffViewMode === 'split') {
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

    // Handle unified diff mode
    if (isDiffMode && diffViewMode === 'unified') {
      const diffText = createTwoFilesPatch(
        filename,
        filename,
        oldContent || '',
        content || '',
        'original',
        'modified'
      );
      const lines = diffText.split('\n');
      const codeToHighlight = lines.slice(4).join('\n');
      queueMicrotask(() => {
        setIsHighlighting(true);
        setLineCount(lines.length - 4);
      });

      const theme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
      codeToHtml(codeToHighlight, { lang: 'diff', theme })
        .then((html) => {
          setHighlightedHtml(addDiffLineStyles(html));
          setIsHighlighting(false);
        })
        .catch((err) => {
          console.error('Syntax highlighting failed:', err);
          setHighlightedHtml(`<pre class="shiki"><code>${escapeHtml(codeToHighlight)}</code></pre>`);
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

        {/* Diff content */}
        <div className="flex-1 min-h-0 overflow-auto">
          {diffViewMode === 'split' ? (
            <SplitDiffViewer
              oldContent={oldContent || ''}
              newContent={content || ''}
              filename={filename}
              language={language}
            />
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
                className="code-viewer text-[11px] font-mono flex-1 min-w-0 overflow-x-auto min-h-full [&_.shiki]:!bg-transparent [&_.shiki]:py-3 [&_.shiki]:pl-3 [&_.shiki]:pr-4 [&_pre]:!bg-transparent [&_pre]:m-0 [&_code]:block [&_.line]:leading-[18px] [&_.line]:min-h-[18px] [&_.diff-add]:bg-green-500/15 [&_.diff-add]:pl-1 [&_.diff-add]:-ml-1 [&_.diff-remove]:bg-red-500/15 [&_.diff-remove]:pl-1 [&_.diff-remove]:-ml-1 [&_.diff-hunk]:bg-blue-500/10 [&_.diff-hunk]:text-muted-foreground [&_.diff-hunk]:pl-1 [&_.diff-hunk]:-ml-1"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-0.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
          <span className="font-mono shrink-0">{lineCount} lines</span>
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
                <Eye className="w-1 h-1" />
              ) : (
                <Code className="w-1 h-1" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="w-1 h-1 text-green-500" />
            ) : (
              <Copy className="w-1 h-1" />
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
              className="code-viewer text-[11px] font-mono flex-1 min-w-0 overflow-x-auto min-h-full [&_.shiki]:!bg-transparent [&_.shiki]:py-3 [&_.shiki]:pl-3 [&_.shiki]:pr-4 [&_pre]:!bg-transparent [&_pre]:m-0 [&_code]:block [&_.line]:leading-[18px] [&_.line]:min-h-[18px]"
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
  return html.replace(/<span class="line">(.*?)<\/span>/g, (match, content) => {
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
