'use client';

import dynamic from 'next/dynamic';
import React, { memo } from 'react';
import { CodeBlockWithCopy } from '@/components/shared/CodeBlockWithCopy';

// Dynamically import MermaidDiagram to avoid SSR issues with mermaid.js
const MermaidDiagram = dynamic(
  () => import('@/components/shared/MermaidDiagram').then((mod) => mod.MermaidDiagram),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8 rounded-lg border border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading diagram...
        </div>
      </div>
    ),
  }
);

// Dynamically import HtmlPreview for live HTML rendering
const HtmlPreview = dynamic(
  () => import('@/components/shared/HtmlPreview').then((mod) => mod.HtmlPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8 rounded-lg border border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading preview...
        </div>
      </div>
    ),
  }
);

// Mermaid diagram type keywords
const MERMAID_KEYWORDS = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|xychart|block-beta)\b/i;

function isMermaidCode(code: string, language?: string): boolean {
  if (language === 'mermaid') return true;
  return MERMAID_KEYWORDS.test(code.trim());
}

function isRenderableHtml(code: string): boolean {
  const trimmed = code.trim();
  return trimmed.startsWith('<') && trimmed.length > 20;
}

// Handle <pre> elements - this wraps code blocks
export const MarkdownPre = memo(function MarkdownPre(props: React.HTMLAttributes<HTMLPreElement>) {
  const { children, ...rest } = props;

  // Try to find a code element child
  const childArray = React.Children.toArray(children);

  for (const child of childArray) {
    if (React.isValidElement(child)) {
      const childProps = child.props as { className?: string; children?: React.ReactNode };
      const className = childProps?.className || '';
      const language = className.replace('language-', '');
      const code = String(childProps?.children || '').replace(/\n$/, '');

      if (language === 'html' && isRenderableHtml(code)) {
        return <HtmlPreview code={code} />;
      }

      if (isMermaidCode(code, language)) {
        return <MermaidDiagram code={code} />;
      }

      // For non-mermaid code blocks, wrap with copy button
      return <CodeBlockWithCopy code={code} {...rest}>{children}</CodeBlockWithCopy>;
    }
  }

  // Default: render as normal pre (fallback for edge cases)
  return <pre {...rest}>{children}</pre>;
});

// Handle <code> elements - for inline code
export const MarkdownCode = memo(function MarkdownCode(props: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
  const { className, children, ...rest } = props;
  // Only handle inline code here - block code is handled by MarkdownPre
  return <code className={className} {...rest}>{children}</code>;
});
