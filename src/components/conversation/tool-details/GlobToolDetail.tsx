'use client';

import { memo, useMemo, useCallback } from 'react';
import { FileText, FileCode, FileJson, Image, File, FileType } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toRelativePath } from '@/lib/utils';
import { CopyButton } from '@/components/shared/CopyButton';
import { useAppStore } from '@/stores/appStore';

/** Map file extensions to icons */
function getFileIcon(filename: string): LucideIcon {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rs':
    case 'go':
    case 'rb':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'swift':
    case 'kt':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'css':
    case 'scss':
    case 'html':
    case 'vue':
    case 'svelte':
      return FileCode;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
      return FileJson;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return Image;
    case 'md':
    case 'mdx':
    case 'txt':
    case 'rst':
      return FileText;
    case 'woff':
    case 'woff2':
    case 'ttf':
    case 'otf':
      return FileType;
    default:
      return File;
  }
}

interface GlobToolDetailProps {
  stdout: string;
  worktreePath?: string;
}

export const GlobToolDetail = memo(function GlobToolDetail({
  stdout,
  worktreePath,
}: GlobToolDetailProps) {
  const files = useMemo(
    () => stdout.split('\n').filter(Boolean),
    [stdout],
  );
  const getStdout = useCallback(() => stdout, [stdout]);

  if (files.length === 0) {
    return (
      <div className="rounded border bg-muted/30 p-2 text-2xs text-muted-foreground">
        No files found
      </div>
    );
  }

  return (
    <div className="rounded border bg-muted/20 max-h-[500px] overflow-auto overscroll-contain">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 bg-muted border-b">
        <span className="text-2xs text-muted-foreground">
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        <CopyButton getText={getStdout} />
      </div>

      {/* File list */}
      <div className="divide-y divide-border/30">
        {files.map((filePath) => (
          <GlobFileRow key={filePath} filePath={filePath} worktreePath={worktreePath} />
        ))}
      </div>
    </div>
  );
});

const GlobFileRow = memo(function GlobFileRow({
  filePath,
  worktreePath,
}: {
  filePath: string;
  worktreePath?: string;
}) {
  const relativePath = toRelativePath(filePath, worktreePath);
  const filename = relativePath.split('/').pop() || relativePath;
  const dirPath = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/') + 1) : '';
  const Icon = getFileIcon(filename);

  const handleClick = useCallback(() => {
    const state = useAppStore.getState();
    const workspaceId = state.selectedWorkspaceId;
    const sessionId = state.selectedSessionId;
    if (!workspaceId || !sessionId) return;
    const tabId = `${workspaceId}-${sessionId}-${relativePath}`;
    state.openFileTab({ id: tabId, workspaceId, sessionId, path: relativePath, name: filename });
  }, [relativePath, filename]);

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1.5 px-2 py-1 w-full text-left text-2xs font-mono hover:bg-surface-2 transition-colors group"
    >
      <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
      {dirPath && (
        <span className="text-muted-foreground/60 shrink-0">{dirPath}</span>
      )}
      <span className="text-foreground/80 group-hover:underline truncate">{filename}</span>
    </button>
  );
});
