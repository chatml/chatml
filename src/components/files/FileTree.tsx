'use client';

import { useState, useMemo, useEffect, useCallback, useImperativeHandle, forwardRef, useRef, memo, createContext, useContext } from 'react';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { Icon } from '@iconify/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIcon, getFolderIcon, getIconifyName, preloadFolderIcons } from '@/lib/vscodeIcons';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { FileContextMenu, FolderContextMenu, BackgroundContextMenu, MultiSelectContextMenu, type ContextAction } from './FileTreeContextMenu';

import { fuzzyMatch } from '@/lib/fuzzyMatch';
import {
  DndContext,
  useDraggable,
  useDroppable,
  pointerWithin,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { StoreApi } from 'zustand/vanilla';

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

// ---------------------------------------------------------------------------
// FileTree-scoped Zustand store
// ---------------------------------------------------------------------------

interface FileTreeStoreState {
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  anchorPath: string | null;
  renamingPath: string | null;
  _files: FileNode[];

  // Actions
  togglePath: (path: string) => void;
  expandAllUnder: (parentPath: string) => void;
  collapseAllUnder: (parentPath: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  resetExpanded: () => void;
  setSelectedPaths: (paths: Set<string>) => void;
  setAnchorPath: (path: string | null) => void;
  setRenamingPath: (path: string | null) => void;
  setFiles: (files: FileNode[]) => void;
  handleNodeClick: (path: string, isDir: boolean, metaKey: boolean, shiftKey: boolean) => boolean;
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

function computeFlatVisiblePaths(files: FileNode[], expandedPaths: Set<string>): string[] {
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
}

function createFileTreeStore() {
  return createStore<FileTreeStoreState>((set, get) => ({
    expandedPaths: new Set<string>(),
    selectedPaths: new Set<string>(),
    anchorPath: null,
    renamingPath: null,
    _files: [],

    togglePath: (path) => set(state => {
      const next = new Set(state.expandedPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedPaths: next };
    }),

    expandAllUnder: (parentPath) => {
      const { _files } = get();
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
      const childDirs = walkAll(_files);
      set(state => {
        const next = new Set(state.expandedPaths);
        for (const d of childDirs) next.add(d);
        return { expandedPaths: next };
      });
    },

    collapseAllUnder: (parentPath) => set(state => {
      const next = new Set(state.expandedPaths);
      for (const p of state.expandedPaths) {
        if (p === parentPath || p.startsWith(parentPath + '/')) {
          next.delete(p);
        }
      }
      return { expandedPaths: next };
    }),

    expandAll: () => {
      const { _files } = get();
      set({ expandedPaths: new Set(collectAllDirPaths(_files)) });
    },

    collapseAll: () => set({ expandedPaths: new Set() }),

    resetExpanded: () => set({ expandedPaths: new Set() }),

    setSelectedPaths: (paths) => set({ selectedPaths: paths }),

    setAnchorPath: (path) => set({ anchorPath: path }),

    setRenamingPath: (path) => set({ renamingPath: path }),

    setFiles: (files) => set({ _files: files }),

    handleNodeClick: (path, _isDir, metaKey, shiftKey) => {
      const state = get();
      if (metaKey) {
        const next = new Set(state.selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        set({ selectedPaths: next, anchorPath: path });
        return true;
      }
      if (shiftKey && state.anchorPath) {
        const flatVisiblePaths = computeFlatVisiblePaths(state._files, state.expandedPaths);
        const anchorIdx = flatVisiblePaths.indexOf(state.anchorPath);
        const targetIdx = flatVisiblePaths.indexOf(path);
        if (anchorIdx !== -1 && targetIdx !== -1) {
          const start = Math.min(anchorIdx, targetIdx);
          const end = Math.max(anchorIdx, targetIdx);
          const range = new Set(flatVisiblePaths.slice(start, end + 1));
          set({ selectedPaths: range });
        }
        return true;
      }
      // Regular click — clear selection (reuse empty set to avoid notifying subscribers needlessly)
      const next = state.selectedPaths.size > 0 ? new Set<string>() : state.selectedPaths;
      set({ selectedPaths: next, anchorPath: path });
      return false;
    },
  }));
}

type FileTreeStore = StoreApi<FileTreeStoreState>;

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const FileTreeStoreContext = createContext<FileTreeStore | null>(null);

function useFileTreeStore<T>(selector: (state: FileTreeStoreState) => T): T {
  const store = useContext(FileTreeStoreContext);
  if (!store) throw new Error('useFileTreeStore must be used within FileTree');
  return useStore(store, selector);
}

interface FileTreeDataContextValue {
  filterQuery: string;
  matchingPaths: Set<string> | null;
  foldersWithChanges: Set<string>;
  changedPaths?: Set<string>;
}

interface FileTreeCallbacksContextValue {
  onFileSelect?: (path: string) => void;
  onFilePreview?: (path: string) => void;
  onContextAction?: (action: ContextAction, node: FileNode) => void;
  onRenameConfirm?: (oldPath: string, newName: string) => void;
  onCancelRename?: () => void;
}

const FileTreeDataContext = createContext<FileTreeDataContextValue | null>(null);
const FileTreeCallbacksContext = createContext<FileTreeCallbacksContextValue | null>(null);

function useFileTreeData(): FileTreeDataContextValue {
  const ctx = useContext(FileTreeDataContext);
  if (!ctx) throw new Error('useFileTreeData must be used within FileTree');
  return ctx;
}

function useFileTreeCallbacks(): FileTreeCallbacksContextValue {
  const ctx = useContext(FileTreeCallbacksContext);
  if (!ctx) throw new Error('useFileTreeCallbacks must be used within FileTree');
  return ctx;
}

// ---------------------------------------------------------------------------
// FileTree (public component)
// ---------------------------------------------------------------------------

interface FileTreeProps {
  files: FileNode[];
  onFileSelect?: (path: string) => void;
  onFilePreview?: (path: string) => void;
  onContextAction?: (action: ContextAction, node: FileNode | null) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onMoveFile?: (sourcePath: string, destDir: string) => void;
  filterQuery?: string;
  changedPaths?: Set<string>;
  workspacePath?: string;
  workspaceName?: string;
}

export interface FileTreeHandle {
  collapseAll: () => void;
  expandAll: () => void;
  getSelectedPaths: () => Set<string>;
  clearSelection: () => void;
}

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree({ files, onFileSelect, onFilePreview, onContextAction, onRename, onMoveFile, filterQuery = '', changedPaths }, ref) {
  // Create store once per FileTree instance (lazy initializer runs only on mount)
  const [store] = useState(() => createFileTreeStore());

  const renameHandledRef = useRef(false);

  // Preload folder icons on first render
  useEffect(() => {
    ensureIconsPreloaded();
  }, []);

  // Lightweight fingerprint for detecting session switches — top-level paths only
  const filesKey = useMemo(() => {
    if (files.length === 0) return '';
    return files.map(f => f.path).join('\0') + ':' + files.length;
  }, [files]);

  // Sync files into store and reset expanded state on session switch
  const filesKeyRef = useRef(filesKey);
  useEffect(() => {
    if (filesKeyRef.current !== filesKey) {
      filesKeyRef.current = filesKey;
      store.getState().resetExpanded();
    }
    store.getState().setFiles(files);
  }, [store, files, filesKey]);

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

  const handleRenameConfirm = useCallback((oldPath: string, newName: string) => {
    // Guard against double-fire (Enter keydown confirms, then blur fires on unmount)
    if (renameHandledRef.current) return;
    renameHandledRef.current = true;
    store.getState().setRenamingPath(null);
    if (!newName.trim()) return;
    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    if (newPath !== oldPath) {
      onRename?.(oldPath, newPath);
    }
  }, [onRename, store]);

  const handleCancelRename = useCallback(() => {
    renameHandledRef.current = true;
    store.getState().setRenamingPath(null);
  }, [store]);

  const handleContextAction = useCallback((action: ContextAction, node: FileNode | null) => {
    const state = store.getState();
    // Intercept rename to handle inline
    if (action === 'rename' && node) {
      renameHandledRef.current = false;
      state.setRenamingPath(node.path);
      return;
    }
    // Handle tree-local actions internally
    if (action === 'expand-all' && node) {
      state.expandAllUnder(node.path);
      return;
    }
    if (action === 'collapse-all' && node) {
      state.collapseAllUnder(node.path);
      return;
    }
    if (action === 'expand-all' && !node) {
      state.expandAll();
      return;
    }
    if (action === 'collapse-all' && !node) {
      state.collapseAll();
      return;
    }
    // Delegate all other actions to parent
    onContextAction?.(action, node);
  }, [store, onContextAction]);

  useImperativeHandle(ref, () => ({
    collapseAll: () => store.getState().collapseAll(),
    expandAll: () => store.getState().expandAll(),
    getSelectedPaths: () => store.getState().selectedPaths,
    clearSelection: () => store.getState().setSelectedPaths(new Set()),
  }), [store]);

  // Split contexts: data changes on filter/file updates; callbacks are stable references
  const dataContext = useMemo<FileTreeDataContextValue>(() => ({
    filterQuery,
    matchingPaths,
    foldersWithChanges,
    changedPaths,
  }), [filterQuery, matchingPaths, foldersWithChanges, changedPaths]);

  const callbacksContext = useMemo<FileTreeCallbacksContextValue>(() => ({
    onFileSelect,
    onFilePreview,
    onContextAction: handleContextAction,
    onRenameConfirm: handleRenameConfirm,
    onCancelRename: handleCancelRename,
  }), [onFileSelect, onFilePreview, handleContextAction, handleRenameConfirm, handleCancelRename]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  return (
    <FileTreeStoreContext.Provider value={store}>
      <FileTreeDataContext.Provider value={dataContext}>
      <FileTreeCallbacksContext.Provider value={callbacksContext}>
        <DndContext
          sensors={sensors}
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
                    />
                  ))}
                </div>
              </ScrollArea>
            </ContextMenuTrigger>
            <BackgroundContextMenu
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
      </FileTreeCallbacksContext.Provider>
      </FileTreeDataContext.Provider>
    </FileTreeStoreContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// FileTreeNode (memoized, subscribes to store for own state)
// ---------------------------------------------------------------------------

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
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

const FileTreeNode = memo(function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  // Granular store subscriptions — each returns a primitive
  const isExpanded = useFileTreeStore(s => node.isDir && s.expandedPaths.has(node.path));
  const isSelected = useFileTreeStore(s => s.selectedPaths.has(node.path));
  // Whether this is a multi-select scenario (>1 items selected). Only needed for context menu branching.
  const isMultiSelected = useFileTreeStore(s => s.selectedPaths.has(node.path) && s.selectedPaths.size > 1);
  const isRenaming = useFileTreeStore(s => s.renamingPath === node.path);
  const togglePath = useFileTreeStore(s => s.togglePath);
  const handleNodeClick = useFileTreeStore(s => s.handleNodeClick);

  // Shared data from contexts (split for granular invalidation)
  const { filterQuery, matchingPaths, foldersWithChanges, changedPaths } = useFileTreeData();
  const { onFileSelect, onFilePreview, onContextAction, onRenameConfirm, onCancelRename } = useFileTreeCallbacks();

  const isChanged = changedPaths?.has(node.path) ?? false;

  // Filter logic — uses pre-computed sets (O(1) lookups instead of recursive walks)
  const matchResult = filterQuery ? fuzzyMatch(filterQuery, node.name) : null;
  const isDirectMatch = matchResult?.matched ?? true;
  const hasMatchingChild = matchingPaths ? matchingPaths.has(node.path) : false;
  const isVisible = !filterQuery || isDirectMatch || hasMatchingChild;
  const isDimmed = filterQuery && !isDirectMatch && hasMatchingChild;
  const hasChangedChildren = node.isDir && foldersWithChanges.has(node.path);
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

  const handleClick = (e: React.MouseEvent) => {
    // Let multi-select handle modifier clicks
    const consumed = handleNodeClick(node.path, node.isDir, e.metaKey || e.ctrlKey, e.shiftKey);
    if (consumed) return;
    // Normal click — toggle folder or open preview immediately
    if (node.isDir) {
      togglePath(node.path);
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

  // Hide nodes that don't match filter or have no matching descendants
  if (!isVisible) return null;

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
          onBlur={(e) => onRenameConfirm?.(node.path, e.currentTarget.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          {matchResult?.ranges.length ? (
            <HighlightedName name={node.name} ranges={matchResult.ranges} />
          ) : (
            <span className="truncate">{node.name}</span>
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
        {isMultiSelected ? (
          <MultiSelectMenuContent node={node} changedPaths={changedPaths} onContextAction={onContextAction} />
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
              />
            </ErrorBoundary>
          ))}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// MultiSelectMenuContent (subscribes to full selectedPaths — isolated to avoid
// re-rendering the entire FileTreeNode on every selection change)
// ---------------------------------------------------------------------------

function MultiSelectMenuContent({ node, changedPaths, onContextAction }: { node: FileNode; changedPaths?: Set<string>; onContextAction?: (action: ContextAction, node: FileNode) => void }) {
  const selectedPaths = useFileTreeStore(s => s.selectedPaths);
  let hasChangedFiles = false;
  if (changedPaths) {
    for (const p of selectedPaths) {
      if (changedPaths.has(p)) { hasChangedFiles = true; break; }
    }
  }
  return (
    <MultiSelectContextMenu
      selectedCount={selectedPaths.size}
      hasChangedFiles={hasChangedFiles}
      onAction={(action) => onContextAction?.(action, node)}
    />
  );
}

// ---------------------------------------------------------------------------
// Safe icon wrapper (memoized)
// ---------------------------------------------------------------------------

const SafeIcon = memo(function SafeIcon({ icon, className }: { icon: string; className?: string }) {
  return (
    <ErrorBoundary
      section="Icon"
      fallback={<div className={cn('w-4 h-4 rounded bg-muted', className)} title="Icon unavailable" />}
    >
      <Icon icon={icon} className={className} />
    </ErrorBoundary>
  );
});

// File icon component using VS Code icons (memoized)
export const FileIcon = memo(function FileIcon({ filename, className }: { filename: string; className?: string }) {
  const iconName = getFileIcon(filename);

  return (
    <SafeIcon
      icon={getIconifyName(iconName)}
      className={cn('w-4 h-4 shrink-0', className)}
    />
  );
});
