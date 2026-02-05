'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/files/FileTree';

interface MentionTextProps {
  content: string;
  className?: string;
}

// Regex to match @filepath mentions (supports paths with slashes, dots, hyphens, underscores)
const MENTION_REGEX = /@([\w./-]+)/g;

/**
 * Renders text content with @mentions styled as pills.
 * Mentions are detected by the pattern @filepath (e.g., @src/lib/utils.ts)
 */
export function MentionText({ content, className }: MentionTextProps) {
  const parts = React.useMemo(() => {
    const result: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Reset regex state
    MENTION_REGEX.lastIndex = 0;

    while ((match = MENTION_REGEX.exec(content)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        result.push(content.slice(lastIndex, match.index));
      }

      // Add the mention as a pill
      const filePath = match[1];
      const fileName = filePath.split('/').pop() || filePath;
      result.push(
        <span
          key={`${match.index}-${filePath}`}
          className="inline-flex items-center gap-1 rounded-md bg-muted mx-0.5 px-1.5 -my-px align-middle leading-none font-medium text-sm"
        >
          <FileIcon filename={fileName} className="h-3.5 w-3.5" />
          <span>{fileName}</span>
        </span>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text after last mention
    if (lastIndex < content.length) {
      result.push(content.slice(lastIndex));
    }

    return result;
  }, [content]);

  // If no mentions found, return plain text
  if (parts.length === 1 && typeof parts[0] === 'string') {
    return <span className={className}>{content}</span>;
  }

  return <span className={className}>{parts}</span>;
}
