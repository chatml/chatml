'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { codeToHtml } from 'shiki';
import { useTheme } from 'next-themes';
import { diffLines as computeDiffLines, Change } from 'diff';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SplitDiffViewerProps {
  oldContent: string;
  newContent: string;
  filename: string;
  language: string;
}

interface DiffLine {
  content: string;
  type: 'unchanged' | 'added' | 'removed';
  oldLineNum?: number;
  newLineNum?: number;
}

export function SplitDiffViewer({
  oldContent,
  newContent,
  language,
}: SplitDiffViewerProps) {
  const { resolvedTheme } = useTheme();
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [oldHighlighted, setOldHighlighted] = useState<string[]>([]);
  const [newHighlighted, setNewHighlighted] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  // Compute diff and highlight
  useEffect(() => {
    setIsLoading(true);

    const computeDiff = async () => {
      // Get line-by-line diff
      const changes = computeDiffLines(oldContent || '', newContent || '');

      // Build aligned diff lines
      const lines: DiffLine[] = [];
      let oldLineNum = 1;
      let newLineNum = 1;

      changes.forEach((change: Change) => {
        const changeLines = change.value.split('\n');
        // Remove last empty element if the value ends with newline
        if (changeLines[changeLines.length - 1] === '') {
          changeLines.pop();
        }

        changeLines.forEach((line) => {
          if (change.added) {
            lines.push({
              content: line,
              type: 'added',
              newLineNum: newLineNum++,
            });
          } else if (change.removed) {
            lines.push({
              content: line,
              type: 'removed',
              oldLineNum: oldLineNum++,
            });
          } else {
            lines.push({
              content: line,
              type: 'unchanged',
              oldLineNum: oldLineNum++,
              newLineNum: newLineNum++,
            });
          }
        });
      });

      setDiffLines(lines);

      // Highlight the full files
      const theme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

      try {
        const [oldHtml, newHtml] = await Promise.all([
          codeToHtml(oldContent || ' ', { lang: language, theme }),
          codeToHtml(newContent || ' ', { lang: language, theme }),
        ]);

        // Extract individual lines from shiki output
        setOldHighlighted(extractLines(oldHtml));
        setNewHighlighted(extractLines(newHtml));
      } catch (err) {
        console.error('Highlighting failed:', err);
        // Fallback to plain text
        setOldHighlighted((oldContent || '').split('\n').map(escapeHtml));
        setNewHighlighted((newContent || '').split('\n').map(escapeHtml));
      }

      setIsLoading(false);
    };

    computeDiff();
  }, [oldContent, newContent, language, resolvedTheme]);

  // Synchronized scrolling
  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isScrolling.current) return;
    isScrolling.current = true;

    const sourceRef = source === 'left' ? leftRef : rightRef;
    const targetRef = source === 'left' ? rightRef : leftRef;

    if (sourceRef.current && targetRef.current) {
      targetRef.current.scrollTop = sourceRef.current.scrollTop;
      targetRef.current.scrollLeft = sourceRef.current.scrollLeft;
    }

    requestAnimationFrame(() => {
      isScrolling.current = false;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Computing diff...</span>
        </div>
      </div>
    );
  }

  // Build left (old) and right (new) panels
  let oldIdx = 0;
  let newIdx = 0;

  return (
    <div className="h-full flex">
      {/* Left panel (old) */}
      <div className="flex-1 flex flex-col border-r border-border/50 min-w-0">
        <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 border-b shrink-0">
          Original
        </div>
        <div
          ref={leftRef}
          className="flex-1 overflow-auto"
          onScroll={() => handleScroll('left')}
        >
          <div className="flex min-h-full">
            {/* Line numbers */}
            <div className="shrink-0 py-2 pl-2 pr-2 text-[11px] font-mono text-muted-foreground/50 text-right select-none border-r border-border/30 sticky left-0 bg-background">
              {diffLines.map((line, i) => (
                <div key={i} className="leading-[18px] h-[18px]">
                  {line.type !== 'added' ? line.oldLineNum : ''}
                </div>
              ))}
            </div>
            {/* Code */}
            <div className="flex-1 py-2 pl-2 pr-4 text-[11px] font-mono overflow-x-auto">
              {diffLines.map((line, i) => {
                const isRemoved = line.type === 'removed';
                const isAdded = line.type === 'added';
                const lineHtml = isAdded
                  ? ''
                  : oldHighlighted[oldIdx++] || escapeHtml(line.content);

                return (
                  <div
                    key={i}
                    className={cn(
                      'leading-[18px] min-h-[18px] whitespace-pre',
                      isRemoved && 'bg-red-500/20',
                      isAdded && 'bg-muted/30'
                    )}
                    dangerouslySetInnerHTML={{
                      __html: isAdded ? '&nbsp;' : lineHtml
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel (new) */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 border-b shrink-0">
          Modified
        </div>
        <div
          ref={rightRef}
          className="flex-1 overflow-auto"
          onScroll={() => handleScroll('right')}
        >
          <div className="flex min-h-full">
            {/* Line numbers */}
            <div className="shrink-0 py-2 pl-2 pr-2 text-[11px] font-mono text-muted-foreground/50 text-right select-none border-r border-border/30 sticky left-0 bg-background">
              {diffLines.map((line, i) => (
                <div key={i} className="leading-[18px] h-[18px]">
                  {line.type !== 'removed' ? line.newLineNum : ''}
                </div>
              ))}
            </div>
            {/* Code */}
            <div className="flex-1 py-2 pl-2 pr-4 text-[11px] font-mono overflow-x-auto">
              {diffLines.map((line, i) => {
                const isRemoved = line.type === 'removed';
                const isAdded = line.type === 'added';
                const lineHtml = isRemoved
                  ? ''
                  : newHighlighted[newIdx++] || escapeHtml(line.content);

                return (
                  <div
                    key={i}
                    className={cn(
                      'leading-[18px] min-h-[18px] whitespace-pre',
                      isAdded && 'bg-green-500/20',
                      isRemoved && 'bg-muted/30'
                    )}
                    dangerouslySetInnerHTML={{
                      __html: isRemoved ? '&nbsp;' : lineHtml
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
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

// Extract individual line HTML from shiki output
function extractLines(html: string): string[] {
  const lines: string[] = [];
  // Shiki wraps lines in <span class="line">...</span>
  const lineRegex = /<span class="line">(.*?)<\/span>/g;
  let match;
  while ((match = lineRegex.exec(html)) !== null) {
    lines.push(match[1]);
  }
  return lines;
}
