'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '@/lib/tauri';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/constants';

// Wrapper component with hover copy button
export function CodeBlockWithCopy({ children, code, ...rest }: React.HTMLAttributes<HTMLPreElement> & { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    }
  };

  return (
    <div className="relative group">
      <pre {...rest}>{children}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-surface-2"
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? (
          <Check className="w-4 h-4 text-text-success" />
        ) : (
          <Copy className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
