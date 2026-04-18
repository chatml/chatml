'use client';

import * as React from 'react';
import { FileIcon } from '@/components/files/FileTree';
import { openUrlInBrowser } from '@/lib/tauri';

interface MentionTextProps {
  content: string;
  className?: string;
}

// Regex pattern to match @filepath mentions. Lookbehind ensures @ is not preceded by a word character,
// aligning with MentionPlugin's triggerPreviousCharPattern which requires start-of-input, whitespace, or quote.
const MENTION_PATTERN = /(?<!\w)@([\w./-]+)/g;

// URL pattern — matches http(s) URLs, stops before trailing punctuation that's likely sentence-level
const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,;:!?"')}\]]/g;

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

interface MatchEntry {
  index: number;
  length: number;
  type: 'mention' | 'url';
  value: string;
}

/**
 * Renders text content with @mentions styled as pills and URLs as clickable links.
 */
export function MentionText({ content, className }: MentionTextProps) {
  const parts = React.useMemo(() => {
    // Collect all matches (mentions + URLs) with positions
    const mentions: MatchEntry[] = [];
    const urls: MatchEntry[] = [];

    // Find mentions
    const mentionRegex = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags);
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(content)) !== null) {
      if (looksLikeFilePath(match[1])) {
        mentions.push({ index: match.index, length: match[0].length, type: 'mention', value: match[1] });
      }
    }

    // Find URLs
    const urlRegex = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
    while ((match = urlRegex.exec(content)) !== null) {
      urls.push({ index: match.index, length: match[0].length, type: 'url', value: match[0] });
    }

    // Remove mentions that are contained within a URL (e.g. @user in https://github.com/@user/repo)
    const filteredMentions = mentions.filter((m) => {
      const mEnd = m.index + m.length;
      return !urls.some((u) => m.index >= u.index && mEnd <= u.index + u.length);
    });

    // Remove URLs that overlap with remaining mentions
    const filteredUrls = urls.filter((u) => {
      const uEnd = u.index + u.length;
      return !filteredMentions.some((m) => {
        const mEnd = m.index + m.length;
        return u.index < mEnd && uEnd > m.index;
      });
    });

    const matches = [...filteredMentions, ...filteredUrls];

    if (matches.length === 0) return null;

    // Sort by position
    matches.sort((a, b) => a.index - b.index);

    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    for (const m of matches) {
      // Add text before this match
      if (m.index > lastIndex) {
        result.push(content.slice(lastIndex, m.index));
      }

      if (m.type === 'mention') {
        const fileName = m.value.split('/').pop()!;
        result.push(
          <span
            key={`mention-${m.index}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted text-foreground mx-0.5 px-1.5 -my-px align-middle leading-none font-medium text-sm"
          >
            <FileIcon filename={fileName} className="h-3.5 w-3.5" />
            <span>{fileName}</span>
          </span>
        );
      } else {
        result.push(
          <a
            key={`url-${m.index}`}
            href={m.value}
            onClick={(e) => {
              e.preventDefault();
              openUrlInBrowser(m.value);
            }}
            className="text-brand underline underline-offset-2 hover:text-brand/80 cursor-pointer"
          >
            {m.value}
          </a>
        );
      }

      lastIndex = m.index + m.length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      result.push(content.slice(lastIndex));
    }

    return result;
  }, [content]);

  // If no special content found, return plain text
  if (!parts) {
    return <span className={className}>{content}</span>;
  }

  return <span className={className}>{parts}</span>;
}
