'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';
import { getFileIcon, getFolderIcon, getIconifyName, preloadFolderIcons } from '@/lib/vscodeIcons';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Preload folder icons on module load to prevent flicker
let iconsPreloaded = false;
function ensureIconsPreloaded() {
  if (!iconsPreloaded) {
    iconsPreloaded = true;
    preloadFolderIcons().catch(console.error);
  }
}

export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect?: (path: string) => void;
  workspacePath?: string;
  workspaceName?: string;
}

export function FileTree({ files, onFileSelect, workspacePath, workspaceName }: FileTreeProps) {
  // Preload folder icons on first render
  useEffect(() => {
    ensureIconsPreloaded();
  }, []);

  const handleOpenInVSCode = async () => {
    if (!workspacePath || !isTauri()) return;
    try {
      const { Command } = await import('@tauri-apps/plugin-shell');
      Command.create('code', [workspacePath]).spawn().catch(console.error);
    } catch (e) {
      console.error('Failed to open in VS Code:', e);
    }
  };

  // Truncate path for display, showing the last part
  const displayPath = workspacePath
    ? workspacePath.length > 35
      ? '...' + workspacePath.slice(-32)
      : workspacePath
    : workspaceName || 'Files';

  return (
    <ScrollArea className="h-full w-full">
      <div className="py-1 pr-2">
        {files.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onFileSelect?: (path: string) => void;
}

function FileTreeNode({ node, depth, onFileSelect }: FileTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleClick = () => {
    if (node.isDir) {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect?.(node.path);
    }
  };

  const isHidden = node.name.startsWith('.');

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 py-0.5 px-1 hover:bg-surface-2 cursor-pointer text-sm rounded-sm transition-colors',
          isHidden && 'text-muted-foreground/75'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        {node.isDir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
            <SafeIcon
              icon={getIconifyName(getFolderIcon(node.name, isExpanded))}
              className={cn('w-4 h-4 shrink-0', isHidden && 'opacity-50')}
            />
          </>
        ) : (
          <>
            <span className="w-3" /> {/* Spacer for alignment with folder chevrons */}
            <FileIcon filename={node.name} className={isHidden ? 'opacity-50' : undefined} />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {node.isDir && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <ErrorBoundary
              key={child.path}
              section="FileTreeNode"
              fallback={
                <div
                  className="flex items-center gap-1.5 py-0.5 px-1 text-sm text-destructive/70"
                  style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span className="truncate">Error: {child.name}</span>
                </div>
              }
            >
              <FileTreeNode
                node={child}
                depth={depth + 1}
                onFileSelect={onFileSelect}
              />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  );
}

// Safe icon wrapper that catches rendering errors
function SafeIcon({ icon, className }: { icon: string; className?: string }) {
  return (
    <ErrorBoundary
      section="Icon"
      fallback={<div className={cn('w-4 h-4 rounded bg-muted', className)} title="Icon unavailable" />}
    >
      <Icon icon={icon} className={className} />
    </ErrorBoundary>
  );
}

// File icon component using VS Code icons
export function FileIcon({ filename, className }: { filename: string; className?: string }) {
  const iconName = getFileIcon(filename);

  return (
    <SafeIcon
      icon={getIconifyName(iconName)}
      className={cn('w-4 h-4 shrink-0', className)}
    />
  );
}
