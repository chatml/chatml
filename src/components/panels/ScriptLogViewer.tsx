'use client';

import { useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Copy, Check } from 'lucide-react';

interface ScriptLogViewerProps {
  lines: string[];
  streaming?: boolean;
  maxHeight?: string;
}

export function ScriptLogViewer({ lines, streaming = false, maxHeight = '200px' }: ScriptLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  // Auto-scroll when new lines arrive and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    setAutoScroll(isAtBottom);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (lines.length === 0) return null;

  return (
    <div className="relative group">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="bg-background-subtle rounded-sm overflow-auto font-mono text-xs leading-relaxed p-2"
        style={{ maxHeight }}
      >
        {lines.map((line, i) => (
          <div key={i} className="text-muted-foreground whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
        {streaming && (
          <div className="text-muted-foreground/50 animate-pulse">...</div>
        )}
      </div>
      <button
        onClick={handleCopy}
        className={cn(
          'absolute top-1.5 right-1.5 p-1 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity',
          'bg-background-subtle hover:bg-muted text-muted-foreground'
        )}
        title="Copy output"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}
