'use client';

import { useState, useMemo, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { Icon } from '@iconify/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIcon, getFolderIcon, getIconifyName, preloadFolderIcons } from '@/lib/vscodeIcons';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { FileContextMenu, FolderContextMenu, BackgroundContextMenu, MultiSelectContextMenu, type ContextAction } from './FileTreeContextMenu';
import { statusColorClass, type FileStatus } from '@/lib/fileTreeUtils';
import { fuzzyMatch } from '@/lib/fuzzyMatch';
import {
  DndContext,
  useDraggable,
  useDroppable,
  pointerWithin,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';

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
  truncated?: boolean;
}

interface FileTreeProps {
  files: FileNode[];
  onFileSelect?: (path: string) => void;
  onFilePreview?: (path: string) => void;
  onContextAction?: (action: ContextAction, node: FileNode | null) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onMoveFile?: (sourcePath: string, destDir: string) => void;
  filterQuery?: string;
  changedPaths?: Set<string>;
  fileStatuses?: Map<string, FileStatus>;
  folderIndicators?: Map<string, number>;
  showChangedOnly?: boolean;
  workspacePath?: string;
  workspaceName?: string;
}

export interface FileTreeHandle {
  collapseAll: () => void;
  expandAll: () => void;
  getSelectedPaths: () => Set<string>;
  clearSelection: () => void;
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

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree({ files, onFileSelect, onFilePreview, onContextAction, onRename, onMoveFile, filterQuery = '', changedPaths, fileStatuses, folderIndicators, showChangedOnly = false }, ref) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  // Lightweight fingerprint for detecting session switches — top-level paths only
  const filesKey = useMemo(() => {
    if (files.length === 0) return '';
    return files.map(f => f.path).join('\0') + ':' + files.length;
  }, [files]);
  const [prevKey, setPrevKey] = useState(filesKey);

  // Preload folder icons on first render
  useEffect(() => {
    ensureIconsPreloaded();
  }, []);

  // Reset expanded state when file list content changes (e.g., switching sessions)
  if (prevKey !== filesKey) {
    setPrevKey(filesKey);
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

  // Folder-scoped expand: expand all directories under a given path
  const expandAllUnder = useCallback((parentPath: string) => {
    function walkAll(nodes: FileNode[]): string[] {
      const dirs: string[] = [];
      for (const node of nodes) {
        if (node.isDir) {
          if (node.path === parentPath || node.path.startsWith(parentPath + '/')) {
            dirs.push(node.path);
          }
          if (node.children) dirs.push(...walkAll(node.children));
        }
      }
      return dirs;
    }
    const childDirs = walkAll(files);
    setExpandedPaths(prev => {
      const next = new Set(prev);
      for (const d of childDirs) next.add(d);
      return next;
    });
  }, [files]);

  const collapseAllUnder = useCallback((parentPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      for (const p of prev) {
        if (p === parentPath || p.startsWith(parentPath + '/')) {
          next.delete(p);
        }
      }
      return next;
    });
  }, []);

  // Build flat list of visible paths for range selection
  const flatVisiblePaths = useMemo(() => {
    const paths: string[] = [];
    function walk(nodes: FileNode[]) {
      for (const node of nodes) {
        paths.push(node.path);
        if (node.isDir && expandedPaths.has(node.path) && node.children) {
          walk(node.children);
        }
      }
    }
    walk(files);
    return paths;
  }, [files, expandedPaths]);

  // Pre-compute filter matching: O(n) walk once instead of O(n*d) per-node recursive checks
  const matchingPaths = useMemo(() => {
    if (!filterQuery) return null;
    const matching = new Set<string>();
    function walk(nodes: FileNode[]) {
      for (const node of nodes) {
        if (!node.isDir && fuzzyMatch(filterQuery, node.name).matched) {
          matching.add(node.path);
          // Mark all ancestor folder paths as having matching descendants
          const parts = node.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            matching.add(parts.slice(0, i).join('/'));
          }
        }
        if (node.children) walk(node.children);
      }
    }
    walk(files);
    return matching;
  }, [files, filterQuery]);

  // Pre-compute folders that have changed descendants: O(n) walk once
  const foldersWithChanges = useMemo(() => {
    if (!changedPaths || changedPaths.size === 0) return new Set<string>();
    const folders = new Set<string>();
    for (const filePath of changedPaths) {
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
    }
    return folders;
  }, [changedPaths]);

  const handleNodeClick = useCallback((path: string, isDir: boolean, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      // Toggle selection
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setAnchorPath(path);
      return true; // Consumed
    }
    if (e.shiftKey && anchorPath) {
      // Range select
      const anchorIdx = flatVisiblePaths.indexOf(anchorPath);
      const targetIdx = flatVisiblePaths.indexOf(path);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const range = new Set(flatVisiblePaths.slice(start, end + 1));
        setSelectedPaths(range);
      }
      return true; // Consumed
    }
    // Regular click — clear selection
    setSelectedPaths(new Set());
    setAnchorPath(path);
    return false; // Not consumed — let normal click handle it
  }, [anchorPath, flatVisiblePaths]);

  const handleRenameConfirm = useCallback((oldPath: string, newName: string) => {
    setRenamingPath(null);
    if (!newName.trim()) return;
    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    if (newPath !== oldPath) {
      onRename?.(oldPath, newPath);
    }
  }, [onRename]);

  const handleCancelRename = useCallback(() => setRenamingPath(null), []);

  const handleContextAction = useCallback((action: ContextAction, node: FileNode | null) => {
    // Intercept rename to handle inline
    if (action === 'rename' && node) {
      setRenamingPath(node.path);
      return;
    }
    // Handle tree-local actions internally
    if (action === 'expand-all' && node) {
      expandAllUnder(node.path);
      return;
    }
    if (action === 'collapse-all' && node) {
      collapseAllUnder(node.path);
      return;
    }
    if (action === 'expand-all' && !node) {
      setExpandedPaths(new Set(collectAllDirPaths(files)));
      return;
    }
    if (action === 'collapse-all' && !node) {
      setExpandedPaths(new Set());
      return;
    }
    // Delegate all other actions to parent
    onContextAction?.(action, node);
  }, [expandAllUnder, collapseAllUnder, files, onContextAction]);

  useImperativeHandle(ref, () => ({
    collapseAll: () => setExpandedPaths(new Set()),
    expandAll: () => setExpandedPaths(new Set(collectAllDirPaths(files))),
    getSelectedPaths: () => selectedPaths,
    clearSelection: () => setSelectedPaths(new Set()),
  }), [files, selectedPaths]);

  // Drag & drop state
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const draggedNode = useMemo(() => {
    if (!draggedPath) return null;
    function find(nodes: FileNode[]): FileNode | null {
      for (const n of nodes) {
        if (n.path === draggedPath) return n;
        if (n.children) {
          const found = find(n.children);
          if (found) return found;
        }
      }
      return null;
    }
    return find(files);
  }, [draggedPath, files]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDraggedPath(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDraggedPath(null);
    const { active, over } = event;
    if (!over || !onMoveFile) return;
    const sourcePath = active.id as string;
    const destDir = over.id as string;
    // Prevent dropping onto itself or into a descendant
    if (sourcePath === destDir || destDir.startsWith(sourcePath + '/')) return;
    // Compute the new path
    const fileName = sourcePath.split('/').pop() || sourcePath;
    const newPath = destDir ? `${destDir}/${fileName}` : fileName;
    if (newPath !== sourcePath) {
      onMoveFile(sourcePath, newPath);
    }
  }, [onMoveFile]);

  const handleDragCancel = useCallback(() => {
    setDraggedPath(null);
  }, []);

  return (
    <DndContext
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea className="h-full w-full">
            <div className="py-1 pr-2 min-h-full">
              {files.map((node) => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  onFileSelect={onFileSelect}
                  onFilePreview={onFilePreview}
                  onContextAction={handleContextAction}
                  onRenameConfirm={handleRenameConfirm}
                  renamingPath={renamingPath}
                  onCancelRename={handleCancelRename}
                  filterQuery={filterQuery}
                  matchingPaths={matchingPaths}
                  foldersWithChanges={foldersWithChanges}
                  showChangedOnly={showChangedOnly}
                  changedPaths={changedPaths}
                  fileStatuses={fileStatuses}
                  folderIndicators={folderIndicators}
                  expandedPaths={expandedPaths}
                  onToggle={togglePath}
                  selectedPaths={selectedPaths}
                  onNodeClick={handleNodeClick}
                />
              ))}
            </div>
          </ScrollArea>
        </ContextMenuTrigger>
        <BackgroundContextMenu
          showChangedOnly={showChangedOnly}
          onAction={(action) => handleContextAction(action, null)}
        />
      </ContextMenu>
      <DragOverlay dropAnimation={null}>
        {draggedNode && (
          <div className="flex items-center gap-1.5 py-0.5 px-2 bg-surface-2 border border-border rounded-sm shadow-md text-base opacity-90">
            {draggedNode.isDir ? (
              <SafeIcon icon={getIconifyName(getFolderIcon(draggedNode.name, false))} className="w-4 h-4 shrink-0" />
            ) : (
              <FileIcon filename={draggedNode.name} />
            )}
            <span className="truncate">{draggedNode.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
});

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onFileSelect?: (path: string) => void;
  onFilePreview?: (path: string) => void;
  onContextAction?: (action: ContextAction, node: FileNode) => void;
  onRenameConfirm?: (oldPath: string, newName: string) => void;
  renamingPath?: string | null;
  onCancelRename?: () => void;
  filterQuery?: string;
  matchingPaths?: Set<string> | null;
  foldersWithChanges: Set<string>;
  showChangedOnly?: boolean;
  changedPaths?: Set<string>;
  fileStatuses?: Map<string, FileStatus>;
  folderIndicators?: Map<string, number>;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  selectedPaths: Set<string>;
  onNodeClick: (path: string, isDir: boolean, e: React.MouseEvent) => boolean;
}

// Render a file name with fuzzy match highlights
function HighlightedName({ name, ranges, className }: { name: string; ranges: [number, number][]; className?: string }) {
  if (ranges.length === 0) return <span className={cn('truncate', className)}>{name}</span>;
  const parts: React.ReactNode[] = [];
  let prev = 0;
  for (const [start, end] of ranges) {
    if (start > prev) parts.push(name.slice(prev, start));
    parts.push(<mark key={start} className="bg-brand/30 text-inherit rounded-sm">{name.slice(start, end)}</mark>);
    prev = end;
  }
  if (prev < name.length) parts.push(name.slice(prev));
  return <span className={cn('truncate', className)}>{parts}</span>;
}

function FileTreeNode({ node, depth, onFileSelect, onFilePreview, onContextAction, onRenameConfirm, renamingPath, onCancelRename, filterQuery = '', matchingPaths, foldersWithChanges, showChangedOnly = false, changedPaths, fileStatuses, folderIndicators, expandedPaths, onToggle, selectedPaths, onNodeClick }: FileTreeNodeProps) {
  const isExpanded = node.isDir && expandedPaths.has(node.path);
  const isChanged = changedPaths?.has(node.path) ?? false;

  // Filter logic — uses pre-computed sets (O(1) lookups instead of recursive walks)
  const matchResult = filterQuery ? fuzzyMatch(filterQuery, node.name) : null;
  const isDirectMatch = matchResult?.matched ?? true;
  const hasMatchingChild = matchingPaths ? matchingPaths.has(node.path) : false;
  const isVisible = !filterQuery || isDirectMatch || hasMatchingChild;
  const isDimmed = filterQuery && !isDirectMatch && hasMatchingChild;
  const hasChangedChildren = node.isDir && foldersWithChanges.has(node.path);

  // showChangedOnly: hide nodes with no changes and no changed descendants
  const hiddenByChangedFilter = showChangedOnly && !isChanged && !hasChangedChildren;
  const fileStatus = fileStatuses?.get(node.path);
  const folderChangeCount = node.isDir ? folderIndicators?.get(node.path) : undefined;
  const isRenaming = renamingPath === node.path;
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Drag & drop
  const { attributes: dragAttributes, listeners: dragListeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.path,
    disabled: isRenaming,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.path,
    disabled: !node.isDir, // Only folders can be drop targets
  });
  const nodeRef = useCallback((el: HTMLDivElement | null) => {
    setDragRef(el);
    if (node.isDir) setDropRef(el);
  }, [setDragRef, setDropRef, node.isDir]);

  // Auto-focus and select name (not extension) when entering rename mode
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      const input = renameInputRef.current;
      input.focus();
      // Select just the name part (not the extension) for files
      if (!node.isDir) {
        const dotIndex = node.name.lastIndexOf('.');
        if (dotIndex > 0) {
          input.setSelectionRange(0, dotIndex);
        } else {
          input.select();
        }
      } else {
        input.select();
      }
    }
  }, [isRenaming, node.name, node.isDir]);

  const isSelected = selectedPaths.has(node.path);

  const handleClick = (e: React.MouseEvent) => {
    // Let multi-select handle modifier clicks
    const consumed = onNodeClick(node.path, node.isDir, e);
    if (consumed) return;
    // Normal click — toggle folder or open preview immediately
    if (node.isDir) {
      onToggle(node.path);
    } else {
      // Single click → preview (no delay — VS Code pattern)
      (onFilePreview ?? onFileSelect)?.(node.path);
    }
  };

  const handleDoubleClick = () => {
    // Double click on file → persistent open
    if (!node.isDir) {
      onFileSelect?.(node.path);
    }
  };

  const isHidden = node.name.startsWith('.');

  // Hide nodes that don't match filter, have no matching descendants, or are filtered by changed-only mode
  if (!isVisible || hiddenByChangedFilter) return null;

  if (node.truncated && !node.isDir) {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 px-1 text-xs text-muted-foreground italic"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span className="w-3" />
        <span className="truncate">... truncated (too many files)</span>
      </div>
    );
  }

  // Auto-expand folders with matching descendants when filtering
  const shouldForceExpand = filterQuery && hasMatchingChild && !isExpanded;

  const nodeContent = (
    <div
      ref={nodeRef}
      {...dragAttributes}
      {...dragListeners}
      className={cn(
        'flex items-center gap-1.5 py-0.5 px-1 hover:bg-surface-2 cursor-pointer text-base rounded-sm transition-colors',
        isHidden && 'text-muted-foreground/75',
        isDimmed && 'opacity-50',
        isSelected && 'bg-accent/30 ring-1 ring-accent/40',
        isDragging && 'opacity-30',
        isOver && node.isDir && 'ring-1 ring-brand bg-brand/10',
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      onClick={isRenaming ? undefined : handleClick}
      onDoubleClick={isRenaming ? undefined : handleDoubleClick}
    >
      {node.isDir ? (
        <>
          {(isExpanded || shouldForceExpand) ? (
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
      {isRenaming ? (
        <input
          ref={renameInputRef}
          defaultValue={node.name}
          aria-label={`Rename ${node.name}`}
          className="flex-1 min-w-0 bg-transparent border border-ring rounded px-1 py-0 text-base outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onRenameConfirm?.(node.path, (e.target as HTMLInputElement).value);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancelRename?.();
            }
            e.stopPropagation();
          }}
          onBlur={(e) => onRenameConfirm?.(node.path, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          {matchResult?.ranges.length ? (
            <HighlightedName name={node.name} ranges={matchResult.ranges} className={fileStatus ? statusColorClass(fileStatus) : undefined} />
          ) : (
            <span className={cn('truncate', fileStatus && statusColorClass(fileStatus))}>{node.name}</span>
          )}
          {/* Folder change count badge */}
          {node.isDir && folderChangeCount && folderChangeCount > 0 && !isExpanded && (
            <span className="ml-auto text-[11px] text-muted-foreground bg-surface-2 rounded-full px-1.5 py-0 leading-tight shrink-0">
              {folderChangeCount}
            </span>
          )}
        </>
      )}
    </div>
  );

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {nodeContent}
        </ContextMenuTrigger>
        {isSelected && selectedPaths.size > 1 ? (
          <MultiSelectContextMenu
            selectedCount={selectedPaths.size}
            hasChangedFiles={(() => { if (!changedPaths) return false; for (const p of selectedPaths) { if (changedPaths.has(p)) return true; } return false; })()}
            onAction={(action) => onContextAction?.(action, node)}
          />
        ) : node.isDir ? (
          <FolderContextMenu
            node={node}
            hasChanges={hasChangedChildren}
            onAction={(action) => onContextAction?.(action, node)}
          />
        ) : (
          <FileContextMenu
            node={node}
            isChanged={isChanged}
            onAction={(action) => onContextAction?.(action, node)}
          />
        )}
      </ContextMenu>
      {node.isDir && isExpanded && node.truncated && (!node.children || node.children.length === 0) && (
        <div
          className="flex items-center gap-1.5 py-0.5 px-1 text-xs text-muted-foreground italic"
          style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
        >
          <span className="w-3" />
          <span className="truncate">... truncated (too many files)</span>
        </div>
      )}
      {node.isDir && (isExpanded || shouldForceExpand) && node.children && (
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
                onFilePreview={onFilePreview}
                onContextAction={onContextAction}
                onRenameConfirm={onRenameConfirm}
                renamingPath={renamingPath}
                onCancelRename={onCancelRename}
                filterQuery={filterQuery}
                matchingPaths={matchingPaths}
                foldersWithChanges={foldersWithChanges}
                showChangedOnly={showChangedOnly}
                changedPaths={changedPaths}
                fileStatuses={fileStatuses}
                folderIndicators={folderIndicators}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                selectedPaths={selectedPaths}
                onNodeClick={onNodeClick}
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
