'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Copy, ChevronDown, ChevronRight, FileJson } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StructuredOutputDisplayProps {
  data: unknown;
  className?: string;
}

export function StructuredOutputDisplay({ data, className }: StructuredOutputDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedJson = JSON.stringify(data, null, 2);

  return (
    <div className={cn('border rounded-md bg-muted/30', className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <FileJson className="w-3 h-3" />
          <span>Structured Output</span>
        </button>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="w-3 h-3 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>
      {expanded && (
        <ScrollArea className="max-h-[300px]">
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">
            {formattedJson}
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}
