'use client';

import { memo, useMemo, useCallback, useState } from 'react';
import { ChevronRight, ChevronDown, FileText } from 'lucide-react';
import { toRelativePath } from '@/lib/utils';
import { CopyButton } from '@/components/shared/CopyButton';
import { useAppStore } from '@/stores/appStore';

interface GrepMatch {
  line: number;
  content: string;
}

interface GrepFileGroup {
  filePath: string;
  matches: GrepMatch[];
}

/**
 * Parse ripgrep-style "content" output into file-grouped matches.
 * Expected format: `filepath:linenum:content` or `filepath-linenum-content` (context lines)
 * Also handles `filepath` only lines (files_with_matches mode).
 */
function parseGrepOutput(stdout: string, outputMode?: string): GrepFileGroup[] {
  const lines = stdout.split('\n').filter(Boolean);

  if (outputMode === 'files_with_matches' || outputMode === 'count') {
    // Each line is just a file path (or file:count)
    return lines.map(line => {
      const colonIdx = line.lastIndexOf(':');
      // If count mode, strip the count suffix
      const filePath = outputMode === 'count' && colonIdx > 0 ? line.slice(0, colonIdx) : line;
      return { filePath, matches: [] };
    });
  }

  // Content mode: parse filepath:linenum:content
  const groups = new Map<string, GrepMatch[]>();
  const order: string[] = [];

  for (const line of lines) {
    // Match `filepath:linenum:content` or `filepath-linenum-content`
    const match = line.match(/^(.+?)[:\-](\d+)[:\-](.*)$/);
    if (match) {
      const [, filePath, lineStr, content] = match;
      const lineNum = parseInt(lineStr, 10);
      if (!groups.has(filePath)) {
        groups.set(filePath, []);
        order.push(filePath);
      }
      groups.get(filePath)!.push({ line: lineNum, content });
    }
  }

  return order.map(filePath => ({
    filePath,
    matches: groups.get(filePath) || [],
  }));
}

interface GrepToolDetailProps {
  stdout: string;
  pattern?: string;
  outputMode?: string;
  worktreePath?: string;
}

export const GrepToolDetail = memo(function GrepToolDetail({
  stdout,
  pattern,
  outputMode,
  worktreePath,
}: GrepToolDetailProps) {
  const fileGroups = useMemo(() => parseGrepOutput(stdout, outputMode), [stdout, outputMode]);
  const getStdout = useCallback(() => stdout, [stdout]);

  if (fileGroups.length === 0) {
    return (
      <div className="rounded border bg-muted/30 p-2 text-2xs text-muted-foreground">
        No matches found
      </div>
    );
  }

  // files_with_matches or count mode: simple file list
  const isFileListMode = outputMode === 'files_with_matches' || outputMode === 'count' ||
    fileGroups.every(g => g.matches.length === 0);

  return (
    <div className="rounded border bg-muted/20 max-h-[500px] overflow-auto overscroll-contain">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 bg-muted border-b">
        <span className="text-2xs text-muted-foreground">
          {fileGroups.length} file{fileGroups.length !== 1 ? 's' : ''}
          {!isFileListMode && (() => {
            const totalMatches = fileGroups.reduce((sum, g) => sum + g.matches.length, 0);
            return <> &middot; {totalMatches} match{totalMatches !== 1 ? 'es' : ''}</>;
          })()}
        </span>
        <CopyButton getText={getStdout} />
      </div>

      {isFileListMode ? (
        <div className="divide-y divide-border/30">
          {fileGroups.map(({ filePath }) => (
            <FilePathRow key={filePath} filePath={filePath} worktreePath={worktreePath} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {fileGroups.map(({ filePath, matches }) => (
            <GrepFileSection
              key={filePath}
              filePath={filePath}
              matches={matches}
              pattern={pattern}
              worktreePath={worktreePath}
            />
          ))}
        </div>
      )}
    </div>
  );
});

/** Clickable file path row for file-list modes */
const FilePathRow = memo(function FilePathRow({
  filePath,
  worktreePath,
}: {
  filePath: string;
  worktreePath?: string;
}) {
  const relativePath = toRelativePath(filePath, worktreePath);

  const handleClick = useCallback(() => {
    const state = useAppStore.getState();
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    if (!workspaceId || !sessionId) return;
    const filename = relativePath.split('/').pop() || relativePath;
    const tabId = `${workspaceId}-${sessionId}-${relativePath}`;
    state.openFileTab({ id: tabId, workspaceId, sessionId, path: relativePath, name: filename });
  }, [relativePath]);

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-2 py-1 w-full text-left text-2xs font-mono hover:bg-surface-2 transition-colors"
    >
      <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
      <span className="text-foreground/80 hover:underline truncate">{relativePath}</span>
    </button>
  );
});

/** Collapsible file section with match lines */
const GrepFileSection = memo(function GrepFileSection({
  filePath,
  matches,
  pattern,
  worktreePath,
}: {
  filePath: string;
  matches: GrepMatch[];
  pattern?: string;
  worktreePath?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const relativePath = toRelativePath(filePath, worktreePath);

  const handleFileClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const state = useAppStore.getState();
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    if (!workspaceId || !sessionId) return;
    const filename = relativePath.split('/').pop() || relativePath;
    const tabId = `${workspaceId}-${sessionId}-${relativePath}`;
    state.openFileTab({ id: tabId, workspaceId, sessionId, path: relativePath, name: filename });
  }, [relativePath]);

  // Build a regex from the pattern for highlighting (safely)
  // Convert capturing groups to non-capturing so split() produces clean alternating pairs
  const highlightRegex = useMemo(() => {
    if (!pattern) return null;
    try {
      const safePattern = pattern.replace(/\((?!\?)/g, '(?:');
      return new RegExp(`(${safePattern})`, 'gi');
    } catch {
      // If the pattern is invalid regex, try literal match
      try {
        return new RegExp(`(${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      } catch {
        return null;
      }
    }
  }, [pattern]);

  return (
    <div>
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        className="flex items-center gap-1.5 px-2 py-1 w-full text-left text-2xs hover:bg-surface-2 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
        <span
          className="font-mono text-foreground/80 hover:underline truncate cursor-pointer"
          onClick={handleFileClick}
        >
          {relativePath}
        </span>
        <span className="text-muted-foreground/60 shrink-0">
          {matches.length} match{matches.length !== 1 ? 'es' : ''}
        </span>
      </button>

      {isExpanded && (
        <div className="ml-4 border-l border-border/30">
          {matches.map((m, idx) => (
            <div
              key={`${m.line}-${idx}`}
              className="flex gap-2 px-2 py-0.5 text-2xs font-mono hover:bg-surface-2/50"
            >
              <span className="text-muted-foreground/50 select-none shrink-0 w-8 text-right tabular-nums">
                {m.line}
              </span>
              <span className="text-foreground/80 whitespace-pre-wrap break-all min-w-0">
                {highlightRegex ? highlightContent(m.content, highlightRegex) : m.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Highlight matched portions of a line */
function highlightContent(content: string, regex: RegExp): React.ReactNode {
  const parts = content.split(regex);
  if (parts.length <= 1) return content;

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      // Matched part
      return (
        <span key={i} className="bg-yellow-500/25 dark:bg-yellow-500/30 text-yellow-700 dark:text-yellow-200 rounded-sm px-0.5">
          {part}
        </span>
      );
    }
    return part;
  });
}
