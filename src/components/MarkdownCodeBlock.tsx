'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import MermaidDiagram to avoid SSR issues with mermaid.js
const MermaidDiagram = dynamic(
  () => import('@/components/MermaidDiagram').then((mod) => mod.MermaidDiagram),
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

// Mermaid diagram type keywords
const MERMAID_KEYWORDS = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|xychart|block-beta)\b/i;

function isMermaidCode(code: string, language?: string): boolean {
  if (language === 'mermaid') return true;
  return MERMAID_KEYWORDS.test(code.trim());
}

// Handle <pre> elements - this wraps code blocks
export function MarkdownPre(props: React.HTMLAttributes<HTMLPreElement>) {
  const { children, ...rest } = props;

  // Try to find a code element child
  const childArray = React.Children.toArray(children);
  console.log('[MarkdownPre] childArray length:', childArray.length);

  for (const child of childArray) {
    if (React.isValidElement(child)) {
      const childProps = child.props as { className?: string; children?: React.ReactNode };
      const className = childProps?.className || '';
      const language = className.replace('language-', '');
      const code = String(childProps?.children || '').replace(/\n$/, '');

      console.log('[MarkdownPre]', { language, className, codePreview: code.substring(0, 80) });

      if (isMermaidCode(code, language)) {
        console.log('[MarkdownPre] Detected mermaid, rendering diagram');
        return <MermaidDiagram code={code} />;
      }
    }
  }

  // Default: render as normal pre
  return <pre {...rest}>{children}</pre>;
}

// Handle <code> elements - for inline code
export function MarkdownCode(props: React.HTMLAttributes<HTMLElement> & { inline?: boolean }) {
  const { className, children, inline, ...rest } = props;
  // Only handle inline code here - block code is handled by MarkdownPre
  return <code className={className} {...rest}>{children}</code>;
}
