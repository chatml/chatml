'use client';

import * as React from 'react';
import { FileIcon } from '@/components/files/FileTree';

interface MentionTextProps {
  content: string;
  className?: string;
}

// Regex pattern to match @filepath mentions. Lookbehind ensures @ is not preceded by a word character,
// aligning with MentionPlugin's triggerPreviousCharPattern which requires start-of-input, whitespace, or quote.
const MENTION_PATTERN = /(?<!\w)@([\w./-]+)/g;

/** Known extensionless filenames that should be treated as file paths. */
const KNOWN_EXTENSIONLESS_FILES = new Set([
  'Makefile',
  'Dockerfile',
  'Containerfile',
  'Gemfile',
  'Rakefile',
  'Procfile',
  'Vagrantfile',
  'LICENSE',
  'CHANGELOG',
  'README',
  'CODEOWNERS',
]);

/** Check if the matched text looks like a file path (has a file extension or is a known filename). */
function looksLikeFilePath(path: string): boolean {
  const lastSegment = path.split('/').pop()!;
  return /\.\w{1,10}$/.test(lastSegment) || KNOWN_EXTENSIONLESS_FILES.has(lastSegment);
}

/**
 * Renders text content with @mentions styled as pills.
 * Mentions are detected by the pattern @filepath (e.g., @src/lib/utils.ts)
 */
export function MentionText({ content, className }: MentionTextProps) {
  const parts = React.useMemo(() => {
    const result: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Create new regex instance to avoid shared state issues
    const regex = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);

    while ((match = regex.exec(content)) !== null) {
      const filePath = match[1];

      // Skip matches that don't look like file paths (e.g., npm scoped packages)
      if (!looksLikeFilePath(filePath)) {
        continue;
      }

      // Add text before the mention
      if (match.index > lastIndex) {
        result.push(content.slice(lastIndex, match.index));
      }

      // Add the mention as a pill
      const fileName = filePath.split('/').pop()!;
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
