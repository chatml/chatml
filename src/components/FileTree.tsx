'use client';

import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/tauri';
import { getFileIcon, getFolderIcon, getIconifyName, preloadFolderIcons } from '@/lib/vscodeIcons';

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
    <div className="h-full flex flex-col">
      {/* Header bar with path and VS Code link */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b bg-muted/30 shrink-0 min-h-[28px]">
        <span className="text-[10px] text-muted-foreground truncate flex-1" title={workspacePath}>
          {displayPath}
        </span>
        <button
          onClick={handleOpenInVSCode}
          className="text-[10px] text-primary/70 hover:text-primary transition-colors shrink-0"
          title="⌘⇧O"
        >
          Open in VSCode
        </button>
      </div>

      {/* File tree content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-1">
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
    </div>
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
          'flex items-center gap-1.5 py-0.5 px-1 hover:bg-surface-2 cursor-pointer text-xs rounded-sm transition-colors',
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
            <Icon
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
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// File icon component using VS Code icons
export function FileIcon({ filename, className }: { filename: string; className?: string }) {
  const iconName = getFileIcon(filename);

  return (
    <Icon
      icon={getIconifyName(iconName)}
      className={cn('w-4 h-4 shrink-0', className)}
    />
  );
}
