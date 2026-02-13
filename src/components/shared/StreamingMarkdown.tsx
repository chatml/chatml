'use client';

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { REMARK_PLUGINS, REHYPE_PLUGINS, MARKDOWN_COMPONENTS } from '@/lib/markdownConfig';

/**
 * Split markdown content into blocks for memoized rendering.
 * Blocks are separated by blank lines, but code fences are kept intact.
 * This allows memoizing completed blocks while only re-rendering the last
 * (actively streaming) block.
 */
function parseMarkdownIntoBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.split('\n');
  let currentBlock: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    // Track code fence state (``` or ~~~)
    if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
      inCodeFence = !inCodeFence;
    }

    // Blank line outside code fence = block boundary
    if (line.trim() === '' && !inCodeFence && currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'));
      currentBlock = [];
    } else {
      currentBlock.push(line);
    }
  }

  // Don't forget the last block
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks;
}

/**
 * Memoized individual markdown block. Only re-renders when content changes.
 */
const MarkdownBlock = memo(function MarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
}, (prev, next) => prev.content === next.content);

interface StreamingMarkdownProps {
  /** Unique ID for stable keys (e.g., segment ID) */
  id: string;
  /** The markdown content being streamed */
  content: string;
}

/**
 * Markdown renderer optimized for streaming content.
 *
 * Splits content into blocks and memoizes each independently. During streaming,
 * only the last block (which is actively changing) re-renders. Completed blocks
 * above it are stable and skip rendering entirely.
 *
 * This addresses the O(n) re-render cost of parsing the entire content on each
 * text chunk, reducing it to O(1) for the active block.
 */
export function StreamingMarkdown({ id, content }: StreamingMarkdownProps) {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

  return (
    <>
      {blocks.map((block, index) => (
        <MarkdownBlock
          key={`${id}-block-${index}`}
          content={block}
        />
      ))}
    </>
  );
}
