'use client';

import { useState, useEffect, useRef } from 'react';
import { codeToHtml } from 'shiki';
import { useTheme } from 'next-themes';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Copy, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeViewerProps {
  content: string;
  filename: string;
  isLoading?: boolean;
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

export function CodeViewer({ content, filename, isLoading }: CodeViewerProps) {
  const { resolvedTheme } = useTheme();
  const [highlightedHtml, setHighlightedHtml] = useState<string>('');
  const [isHighlighting, setIsHighlighting] = useState(true);
  const [copied, setCopied] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!content || isLoading) {
      setHighlightedHtml('');
      setIsHighlighting(false);
      return;
    }

    setIsHighlighting(true);
    const language = getLanguage(filename);
    const lines = content.split('\n').length;
    setLineCount(lines);

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
  }, [content, filename, isLoading, resolvedTheme]);

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

  if (!content) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Empty file</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{lineCount} lines</span>
          <span>|</span>
          <span className="font-mono">{getLanguage(filename)}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Code content */}
      <div className="flex-1 overflow-auto min-h-0 overscroll-contain">
        {isHighlighting ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex">
            {/* Line numbers */}
            <div className="shrink-0 py-3 pl-3 pr-2 text-[11px] font-mono text-muted-foreground/50 text-right select-none border-r border-border/50 sticky left-0 bg-background">
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
                'code-viewer text-[11px] font-mono flex-1 min-w-0 overflow-x-auto',
                '[&_.shiki]:!bg-transparent [&_.shiki]:py-3 [&_.shiki]:pl-3 [&_.shiki]:pr-4',
                '[&_pre]:!bg-transparent [&_pre]:m-0',
                '[&_code]:block',
                '[&_.line]:leading-[18px]'
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
