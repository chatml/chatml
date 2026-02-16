'use client';

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Icon } from '@iconify/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIcon, getFolderIcon, getIconifyName, preloadFolderIcons } from '@/lib/vscodeIcons';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

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

export interface FileTreeHandle {
  collapseAll: () => void;
  expandAll: () => void;
}

function collectAllDirPaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  function walk(list: FileNode[]) {
    for (const node of list) {
      if (node.isDir) {
        paths.push(node.path);
        if (node.children) walk(node.children);
      }
    }
  }
  walk(nodes);
  return paths;
}

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree({ files, onFileSelect }, ref) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [prevFiles, setPrevFiles] = useState(files);

  // Preload folder icons on first render
  useEffect(() => {
    ensureIconsPreloaded();
  }, []);

  // Reset expanded state when files change (e.g., switching sessions)
  if (prevFiles !== files) {
    setPrevFiles(files);
    setExpandedPaths(new Set());
  }

  const togglePath = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  useImperativeHandle(ref, () => ({
    collapseAll: () => setExpandedPaths(new Set()),
    expandAll: () => setExpandedPaths(new Set(collectAllDirPaths(files))),
  }), [files]);

  return (
    <ScrollArea className="h-full w-full">
      <div className="py-1 pr-2">
        {files.map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            onFileSelect={onFileSelect}
            expandedPaths={expandedPaths}
            onToggle={togglePath}
          />
        ))}
      </div>
    </ScrollArea>
  );
});

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onFileSelect?: (path: string) => void;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
}

function FileTreeNode({ node, depth, onFileSelect, expandedPaths, onToggle }: FileTreeNodeProps) {
  const isExpanded = node.isDir && expandedPaths.has(node.path);

  const handleClick = () => {
    if (node.isDir) {
      onToggle(node.path);
    } else {
      onFileSelect?.(node.path);
    }
  };

  const isHidden = node.name.startsWith('.');

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 py-0.5 px-1 hover:bg-surface-2 cursor-pointer text-base rounded-sm transition-colors',
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
                  className="flex items-center gap-1.5 py-0.5 px-1 text-base text-destructive/70"
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
                expandedPaths={expandedPaths}
                onToggle={onToggle}
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
