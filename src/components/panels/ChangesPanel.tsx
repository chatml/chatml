'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds, useFileTabState, useTodoState, useFileCommentStats, useReviewComments } from '@/stores/selectors';
import { listSessionFiles, getSessionFileContent, getSessionFileDiff, sendConversationMessage, updateReviewComment as apiUpdateReviewComment, ApiError, ErrorCode, type FileChangeDTO, type BranchStatsDTO } from '@/lib/api';
import { getDiffFromCache, setDiffInCache, invalidateDiffCache } from '@/lib/diffCache';
import { getFileContentFromCache, setFileContentInCache, invalidateFileContentCache } from '@/lib/fileContentCache';
import { getSessionData, setSessionData, invalidateSessionData } from '@/lib/sessionDataCache';
import { formatReviewFeedback } from '@/lib/formatReviewFeedback';
import { dispatchAppEvent } from '@/lib/custom-events';
import type { Attachment } from '@/lib/types';
import { FileTree, FileIcon, type FileNode, type FileTreeHandle } from '@/components/files/FileTree';
import type { ContextAction } from '@/components/files/FileTreeContextMenu';
import { useFileOperations } from '@/hooks/useFileOperations';
import { ConfirmDeleteDialog, ConfirmDiscardDialog, NewItemDialog } from '@/components/files/FileOperationDialogs';
import { FileTreeFilter } from '@/components/files/FileTreeFilter';
import { TodoPanel } from '@/components/panels/TodoPanel';
import { BudgetStatusPanel } from '@/components/panels/BudgetStatusPanel';
import { ChecksPanel, type ChecksPanelHandle } from '@/components/panels/ChecksPanel';
import { useToast } from '@/components/ui/toast';


import { McpServersPanel } from '@/components/panels/McpServersPanel';
import { ReviewPanel } from '@/components/panels/ReviewPanel';
import { FileHistoryPanel } from '@/components/panels/FileHistoryPanel';
import { BackgroundTasksPanel } from '@/components/panels/BackgroundTasksPanel';
import { useBackgroundTasks } from '@/stores/selectors';
import { useAppEventListener } from '@/lib/custom-events';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useSettingsStore, type BottomPanelTab, type AllBottomPanelTab, type AllTopPanelTab } from '@/stores/settingsStore';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
  type PanelImperativeHandle,
} from '@/components/ui/resizable';
import {
  MoreVertical,
  FileText,
  FolderX,
  Search,
  Loader2,
  MessageSquare,
  ChevronRight,
  RefreshCw,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  CheckCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn, toBase64 } from '@/lib/utils';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { InlineErrorFallback } from '@/components/shared/ErrorFallbacks';
import type { FileTab } from '@/lib/types';
import { useShortcuts } from '@/hooks/useShortcut';
import { getShortcutById, formatShortcutKeys } from '@/lib/shortcuts';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { isBinaryFile } from '@/lib/fileUtils';
import { copyToClipboard, showInFinder, openInVSCode, openInTerminal } from '@/lib/tauri';
import { useDiffPrefetch } from '@/hooks/useDiffPrefetch';
import { useFileContentPrefetch } from '@/hooks/useFileContentPrefetch';
import { useSessionSnapshot } from '@/hooks/useSessionSnapshot';

// Maximum file size for diff viewing (2MB)
const MAX_DIFF_SIZE = 2 * 1024 * 1024;

// Recursively collect all file paths under a set of nodes
function collectFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (!node.isDir) {
      paths.push(node.path);
    } else if (node.children) {
      paths.push(...collectFilePaths(node.children));
    }
  }
  return paths;
}

export function ChangesPanel() {
  // Use optimized selectors to prevent unnecessary re-renders
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId } = useSelectedIds();
  const { fileTabs, openFileTab, updateFileTab, selectFileTab } = useFileTabState();
  const { agentTodos } = useTodoState(selectedConversationId, selectedSessionId);
  const commentStats = useFileCommentStats(selectedSessionId);
  const reviewComments = useReviewComments(selectedSessionId);
  const { error: showError } = useToast();
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const updateSession = useAppStore((s) => s.updateSession);
  const layoutChanges = useSettingsStore((s) => s.layoutChanges);
  const setLayoutChanges = useSettingsStore((s) => s.setLayoutChanges);
  const sidebarBottomPanelMinimized = useSettingsStore((s) => s.sidebarBottomPanelMinimized);
  const setSidebarBottomPanelMinimized = useSettingsStore((s) => s.setSidebarBottomPanelMinimized);
  const toggleSidebarBottomPanel = useSettingsStore((s) => s.toggleSidebarBottomPanel);
  const [selectedTab, setSelectedTab] = useState('files');
  const [bottomTab, setBottomTab] = useState('todos');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [changesView, setChangesView] = useState<'all' | 'uncommitted'>('all');
  const [containerWidth, setContainerWidth] = useState(400);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const changesContainerRef = useRef<HTMLDivElement>(null);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const checksPanelRef = useRef<ChecksPanelHandle>(null);
  const bottomPanelRef = useRef<PanelImperativeHandle>(null);

  // Consolidated snapshot: replaces separate changes + branch-commits + git-status calls.
  // Handles session-change fetching, polling, file-change debouncing, and stale-while-revalidate.
  const snapshot = useSessionSnapshot(selectedWorkspaceId, selectedSessionId);
  const { changes, allChanges, branchStats, refetch: refetchSnapshot } = snapshot;
  const changesLoading = snapshot.loading;

  // Prefetch diffs and file content for top changed files during idle time
  const prefetchChanges = changesView === 'all' ? allChanges : changes;
  useDiffPrefetch(selectedWorkspaceId, selectedSessionId, prefetchChanges);
  useFileContentPrefetch(selectedWorkspaceId, selectedSessionId, prefetchChanges);

  // Invalidate diff/file-content caches when changes data updates from the snapshot.
  // This ensures stale cached diffs are cleared when files change.
  const prevChangesRef = useRef(changes);
  useEffect(() => {
    if (changes !== prevChangesRef.current && selectedWorkspaceId && selectedSessionId) {
      prevChangesRef.current = changes;
      invalidateDiffCache(selectedWorkspaceId, selectedSessionId);
      invalidateFileContentCache(selectedWorkspaceId, selectedSessionId);
    }
  }, [changes, selectedWorkspaceId, selectedSessionId]);

  // Clear files cache on session switch (files are fetched separately)
  const prevSessionIdRef = useRef(selectedSessionId);
  useEffect(() => {
    if (prevSessionIdRef.current !== selectedSessionId) {
      // Save outgoing session's files to cache
      if (prevSessionIdRef.current && selectedWorkspaceId) {
        setSessionData(selectedWorkspaceId, prevSessionIdRef.current, {
          files, changes, allChanges, branchStats,
          gitStatus: snapshot.gitStatus,
        });
      }
      prevSessionIdRef.current = selectedSessionId;

      // Try to restore cached files for the new session
      if (selectedWorkspaceId && selectedSessionId) {
        const cached = getSessionData(selectedWorkspaceId, selectedSessionId);
        if (cached && cached.files.length > 0) {
          setFiles(cached.files);
          setFilesLoading(false);
          setFilesError(null);
          setPrUrl(null);
          return;
        }
      }

      // No cache — clear and show loading
      setFiles([]);
      setFilesLoading(true);
      setFilesError(null);
      setPrUrl(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only react to session change
  }, [selectedSessionId]);

  // Update session stats from snapshot branch stats (used by session list sidebar)
  useEffect(() => {
    if (!selectedSessionId) return;
    if (branchStats) {
      const { totalAdditions, totalDeletions } = branchStats;
      const currentStats = useAppStore.getState().sessions.find(s => s.id === selectedSessionId)?.stats;
      if (!currentStats || currentStats.additions !== totalAdditions || currentStats.deletions !== totalDeletions) {
        updateSession(selectedSessionId, { stats: { additions: totalAdditions, deletions: totalDeletions } });
      }
    } else {
      const currentStats = useAppStore.getState().sessions.find(s => s.id === selectedSessionId)?.stats;
      if (currentStats !== undefined) {
        updateSession(selectedSessionId, { stats: undefined });
      }
    }
  }, [branchStats, selectedSessionId, updateSession]);

  // Track container width for dynamic truncation
  useEffect(() => {
    const container = changesContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Build a set of changed file paths for context menu conditional items
  const changedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const c of allChanges) paths.add(c.path);
    for (const c of changes) paths.add(c.path);
    return paths;
  }, [changes, allChanges]);

  // File tree filter
  const [filterQuery, setFilterQuery] = useState('');
  const [filterVisible, setFilterVisible] = useState(false);

  // File operation dialog state
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; paths: string[]; name: string; isDir: boolean }>({ open: false, paths: [], name: '', isDir: false });
  const [discardDialog, setDiscardDialog] = useState<{ open: boolean; paths: string[]; name: string; isFolder: boolean }>({ open: false, paths: [], name: '', isFolder: false });
  const [newItemDialog, setNewItemDialog] = useState<{ open: boolean; type: 'file' | 'folder'; parentPath: string }>({ open: false, type: 'file', parentPath: '' });

  // File operations hook
  const fileOps = useFileOperations({
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    onFilesRefresh: setFiles,
  });

  // Handle file selection from file tree (session-scoped tab)
  const openFileAsTab = async (path: string, isPreview: boolean) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const filename = path.split('/').pop() || path;
    // Include sessionId in tab ID to allow same file open in different sessions
    const tabId = `${selectedWorkspaceId}-${selectedSessionId}-${path}`;

    // Check file content cache — avoids HTTP round-trip on re-open
    // Skip cache for binary files (shouldn't be cached, but guard defensively)
    const cached = !isBinaryFile(filename)
      ? getFileContentFromCache(selectedWorkspaceId, selectedSessionId, path)
      : null;
    if (cached) {
      const isEmpty = cached.content === '' || cached.content === undefined;
      openFileTab({
        id: tabId,
        workspaceId: selectedWorkspaceId,
        sessionId: selectedSessionId,
        path,
        name: filename,
        isLoading: false,
        viewMode: 'file',
        content: cached.content ?? '',
        originalContent: cached.content ?? '',
        isEmpty,
        isPreview,
      });
      return;
    }

    // Create tab with loading state (session-scoped for complete isolation)
    const newTab: FileTab = {
      id: tabId,
      workspaceId: selectedWorkspaceId,
      sessionId: selectedSessionId,
      path,
      name: filename,
      isLoading: true,
      viewMode: 'file',
      isPreview,
    };

    openFileTab(newTab);

    // Always set loading state for existing tabs (e.g., restored from persistence without content)
    updateFileTab(tabId, { isLoading: true });

    // Fetch file content from session's worktree (not main repo)
    try {
      const fileData = await getSessionFileContent(selectedWorkspaceId, selectedSessionId, path);
      setFileContentInCache(selectedWorkspaceId, selectedSessionId, path, fileData);
      const isEmpty = fileData.content === '' || fileData.content === undefined;
      updateFileTab(tabId, {
        content: fileData.content ?? '',
        originalContent: fileData.content ?? '', // Store original for dirty detection
        isEmpty,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load file:', error);
      updateFileTab(tabId, {
        loadError: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  };

  // Stabilize callbacks via ref — openFileAsTab has many dependencies but these wrappers
  // must be referentially stable so FileTree's callbacks context doesn't invalidate every render
  const openFileAsTabRef = useRef(openFileAsTab);
  openFileAsTabRef.current = openFileAsTab;
  const handleFileSelect = useCallback((path: string) => openFileAsTabRef.current(path, false), []);
  const handleFilePreview = useCallback((path: string) => openFileAsTabRef.current(path, true), []);

  // Use ref for sessions to avoid recreating handleContextAction on every session status change
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Handle context menu actions from the file tree
  const handleContextAction = useCallback(async (action: ContextAction, node: FileNode | null) => {
    const currentSession = sessionsRef.current.find(s => s.id === selectedSessionId);
    const worktreePath = currentSession?.worktreePath;

    switch (action) {
      // Open actions — delegate to existing handlers
      case 'open':
      case 'open-new-tab':
        if (node && !node.isDir) handleFileSelect(node.path);
        break;
      case 'open-to-side':
        // For now, same as open (side-by-side is a future enhancement)
        if (node && !node.isDir) handleFileSelect(node.path);
        break;

      // View diff
      case 'view-diff':
        if (node && !node.isDir) handleChangedFileSelect(node.path);
        break;

      // Clipboard actions
      case 'copy-path':
        if (node && worktreePath) {
          copyToClipboard(`${worktreePath}/${node.path}`);
        }
        break;
      case 'copy-relative-path':
        if (node) {
          copyToClipboard(node.path);
        }
        break;
      case 'copy-name':
        if (node) {
          copyToClipboard(node.name);
        }
        break;

      // Open In actions
      case 'reveal-in-finder':
        if (node && worktreePath) {
          showInFinder(`${worktreePath}/${node.path}`);
        }
        break;
      case 'open-in-terminal':
        if (node && worktreePath) {
          const terminalPath = node.isDir
            ? `${worktreePath}/${node.path}`
            : `${worktreePath}/${node.path.split('/').slice(0, -1).join('/')}`;
          openInTerminal(terminalPath || worktreePath);
        }
        break;
      case 'open-in-vscode':
        if (node && worktreePath) {
          openInVSCode(`${worktreePath}/${node.path}`);
        }
        break;

      // Background-only actions
      case 'refresh':
        refetchSnapshot();
        if (selectedWorkspaceId && selectedSessionId) {
          invalidateSessionData(selectedWorkspaceId, selectedSessionId);
          invalidateDiffCache(selectedWorkspaceId, selectedSessionId);
          invalidateFileContentCache(selectedWorkspaceId, selectedSessionId);
          // Re-fetch files
          setFilesLoading(true);
          listSessionFiles(selectedWorkspaceId, selectedSessionId).then(fetchedFiles => {
            setFiles(fetchedFiles);
            setFilesLoading(false);
          }).catch(() => setFilesLoading(false));
        }
        break;

      // AI actions — compose into chat input
      case 'ai-add-to-context':
        if (node) {
          dispatchAppEvent('compose-action', { text: `@${node.path} ` });
        }
        break;
      case 'ai-add-all-to-context':
        if (node && node.isDir && node.children) {
          const filePaths = collectFilePaths(node.children);
          const mentions = filePaths.map(p => `@${p}`).join(' ');
          dispatchAppEvent('compose-action', { text: mentions + ' ' });
        }
        break;
      case 'ai-explain':
        if (node) {
          dispatchAppEvent('compose-action', { text: `Explain this file: @${node.path}` });
        }
        break;
      case 'ai-explain-module':
        if (node) {
          dispatchAppEvent('compose-action', { text: `Explain this module/directory: @${node.path}` });
        }
        break;
      case 'ai-generate-tests':
        if (node) {
          dispatchAppEvent('compose-action', { text: `Generate comprehensive tests for: @${node.path}` });
        }
        break;
      case 'ai-review':
        if (node) {
          dispatchAppEvent('compose-action', { text: `Review this file for bugs, performance issues, and improvements: @${node.path}` });
        }
        break;

      // File operations
      case 'new-file':
        setNewItemDialog({ open: true, type: 'file', parentPath: node?.isDir ? node.path : '' });
        break;
      case 'new-folder':
        setNewItemDialog({ open: true, type: 'folder', parentPath: node?.isDir ? node.path : '' });
        break;
      case 'rename':
        // Handled by FileTree inline rename (sets renamingPath internally)
        break;
      case 'duplicate':
        if (node && !node.isDir) fileOps.duplicate(node.path);
        break;
      case 'delete':
        if (node) {
          setDeleteDialog({ open: true, paths: [node.path], name: node.name, isDir: node.isDir });
        }
        break;
      case 'discard-changes':
        if (node) {
          setDiscardDialog({ open: true, paths: [node.path], name: node.name, isFolder: false });
        }
        break;
      case 'discard-folder-changes':
        if (node) {
          setDiscardDialog({ open: true, paths: [node.path], name: node.name, isFolder: true });
        }
        break;
      case 'find-in-folder':
        setFilterVisible(true);
        if (node) setFilterQuery('');
        break;

      // Multi-select actions
      case 'delete-selected': {
        const selected = fileTreeRef.current?.getSelectedPaths();
        if (selected && selected.size > 0) {
          setDeleteDialog({
            open: true,
            paths: [...selected],
            name: `${selected.size} selected item${selected.size > 1 ? 's' : ''}`,
            isDir: false,
          });
        }
        break;
      }
      case 'discard-selected': {
        const selected = fileTreeRef.current?.getSelectedPaths();
        if (selected && selected.size > 0) {
          setDiscardDialog({
            open: true,
            paths: [...selected],
            name: `${selected.size} selected file${selected.size > 1 ? 's' : ''}`,
            isFolder: false,
          });
        }
        break;
      }
      case 'copy-selected-paths': {
        const selected = fileTreeRef.current?.getSelectedPaths();
        if (selected && selected.size > 0 && worktreePath) {
          const paths = [...selected].map(p => `${worktreePath}/${p}`).join('\n');
          copyToClipboard(paths);
        }
        break;
      }
      case 'ai-add-selected-to-context': {
        const selected = fileTreeRef.current?.getSelectedPaths();
        if (selected && selected.size > 0) {
          const mentions = [...selected].map(p => `@${p}`).join(' ');
          dispatchAppEvent('compose-action', { text: mentions + ' ' });
        }
        break;
      }

      default:
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleFileSelect, handleChangedFileSelect, and invalidate* are stable; sessions accessed via ref
  }, [selectedSessionId, selectedWorkspaceId, refetchSnapshot, fileOps]);

  // Shared helper: check cache then fetch diff, applying size check and updating tab state.
  const loadDiffForTab = async (tabId: string, workspaceId: string, sessionId: string, path: string) => {
    // Check frontend diff cache first — avoids HTTP round-trip on re-open
    const cachedDiff = getDiffFromCache(workspaceId, sessionId, path);
    if (cachedDiff) {
      if (cachedDiff.truncated) {
        updateFileTab(tabId, { isLoading: false, isTooLarge: true, unifiedDiff: cachedDiff.unifiedDiff });
        return;
      }
      const totalSize = (cachedDiff.oldContent?.length || 0) + (cachedDiff.newContent?.length || 0);
      if (totalSize > MAX_DIFF_SIZE) {
        updateFileTab(tabId, { isLoading: false, isTooLarge: true });
        return;
      }
      updateFileTab(tabId, {
        diff: {
          oldContent: cachedDiff.oldContent ?? '',
          newContent: cachedDiff.newContent ?? '',
        },
        isLoading: false,
      });
      return;
    }

    updateFileTab(tabId, { isLoading: true });

    try {
      const diffData = await getSessionFileDiff(workspaceId, sessionId, path);

      // Cache the result for fast re-opens
      setDiffInCache(workspaceId, sessionId, path, diffData);

      if (diffData.truncated) {
        updateFileTab(tabId, { isLoading: false, isTooLarge: true, unifiedDiff: diffData.unifiedDiff });
        return;
      }

      const totalSize = (diffData.oldContent?.length || 0) + (diffData.newContent?.length || 0);
      if (totalSize > MAX_DIFF_SIZE) {
        updateFileTab(tabId, { isLoading: false, isTooLarge: true });
        return;
      }

      updateFileTab(tabId, {
        diff: {
          oldContent: diffData.oldContent ?? '',
          newContent: diffData.newContent ?? '',
        },
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load diff:', error);
      updateFileTab(tabId, {
        loadError: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  };

  // Handle changed file selection - shows diff view (session-scoped tab)
  const handleChangedFileSelect = async (path: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const filename = path.split('/').pop() || path;
    // Include sessionId in tab ID to allow same file open in different sessions
    const tabId = `${selectedWorkspaceId}-${selectedSessionId}-diff-${path}`;

    // If this tab is already open, just select it
    const existingTab = fileTabs.find((t) => t.id === tabId);
    if (existingTab) {
      selectFileTab(tabId);
      return;
    }

    // Check if it's a binary file
    if (isBinaryFile(filename)) {
      const newTab: FileTab = {
        id: tabId,
        workspaceId: selectedWorkspaceId,
        sessionId: selectedSessionId, // Session-scoped tab
        path,
        name: filename,
        isLoading: false,
        viewMode: 'diff',
        isBinary: true,
      };
      openFileTab(newTab);
      return;
    }

    // Create tab with loading state for text files (session-scoped)
    const newTab: FileTab = {
      id: tabId,
      workspaceId: selectedWorkspaceId,
      sessionId: selectedSessionId, // Session-scoped tab
      path,
      name: filename,
      isLoading: true,
      viewMode: 'diff',
    };

    openFileTab(newTab);
    await loadDiffForTab(tabId, selectedWorkspaceId, selectedSessionId, path);
  };

  // Handle review comment click - opens diff view scrolled to the comment line
  const handleReviewFileSelect = async (path: string, lineNumber?: number) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const filename = path.split('/').pop() || path;
    const tabId = `${selectedWorkspaceId}-${selectedSessionId}-diff-${path}`;

    // If a diff tab for this file already exists, select it and update cursor position
    const existingTab = fileTabs.find(
      (t) => t.id === tabId
    );
    if (existingTab) {
      selectFileTab(tabId);
      if (lineNumber) {
        updateFileTab(tabId, { cursorPosition: { line: lineNumber, column: 1 } });
      }
      return;
    }

    // Check if it's a binary file
    if (isBinaryFile(filename)) {
      const newTab: FileTab = {
        id: tabId,
        workspaceId: selectedWorkspaceId,
        sessionId: selectedSessionId,
        path,
        name: filename,
        isLoading: false,
        viewMode: 'diff',
        isBinary: true,
      };
      openFileTab(newTab);
      return;
    }

    // Create tab with loading state
    const newTab: FileTab = {
      id: tabId,
      workspaceId: selectedWorkspaceId,
      sessionId: selectedSessionId,
      path,
      name: filename,
      isLoading: true,
      viewMode: 'diff',
      cursorPosition: lineNumber ? { line: lineNumber, column: 1 } : undefined,
    };

    openFileTab(newTab);
    await loadDiffForTab(tabId, selectedWorkspaceId, selectedSessionId, path);
  };

  // Get current session and workspace for status-based styling
  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const currentWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  // Watch for branch sync completion to refresh changes
  const branchSyncCompletedAt = useAppStore((s) => selectedSessionId ? s.branchSyncCompletedAt[selectedSessionId] : undefined);
  // Watch for agent turn completion to refresh changes
  const lastTurnCompletedAt = useAppStore((s) => selectedSessionId ? s.lastTurnCompletedAt[selectedSessionId] : undefined);

  // Track branch for refetching changes when branch is renamed
  const currentBranch = currentSession?.branch;
  // Track target branch for refetching changes when target branch changes
  const currentTargetBranch = currentSession?.targetBranch;

  // Calculate todo counts for badge
  const totalPendingTodos = agentTodos.filter((t) => t.status !== 'completed').length;

  // Calculate running background task count for badge
  const backgroundTasks = useBackgroundTasks(selectedConversationId);
  const runningTaskCount = backgroundTasks.filter((t) => t.status === 'running').length;

  // Callback for GitStatusSection to send messages to the agent
  const handleGitActionMessage = useCallback((content: string) => {
    if (!selectedConversationId) {
      console.warn('No conversation selected, cannot send git action message');
      return;
    }
    sendConversationMessage(selectedConversationId, content).catch(console.error);
  }, [selectedConversationId]);

  // Send unresolved review comments as feedback — opens in composer so user can add context
  const handleSendFeedback = useCallback(() => {
    const feedbackText = formatReviewFeedback(reviewComments);
    if (!feedbackText) return;

    const attachment: Attachment = {
      id: `review-feedback-${Date.now()}`,
      type: 'file',
      name: 'Review Feedback',
      mimeType: 'text/markdown',
      size: new Blob([feedbackText]).size,
      lineCount: feedbackText.split('\n').length,
      base64Data: toBase64(feedbackText),
      preview: feedbackText.slice(0, 200),
      isInstruction: true,
    };

    dispatchAppEvent('compose-action', {
      text: 'Fix the following review feedback',
      attachments: [attachment],
    });
  }, [reviewComments]);

  // Resolve all unresolved review comments
  const updateReviewComment = useAppStore((s) => s.updateReviewComment);
  const handleResolveAll = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    // Read comments from store directly to avoid closing over the array (keeps callback stable)
    const comments = useAppStore.getState().reviewComments[selectedSessionId] ?? [];
    const unresolved = comments.filter((c) => !c.resolved);
    if (unresolved.length === 0) return;

    // Optimistically resolve all as "fixed"
    for (const comment of unresolved) {
      updateReviewComment(selectedSessionId, comment.id, {
        resolved: true,
        resolvedBy: 'user',
        resolutionType: 'fixed',
      });
    }

    // Fire API calls and report failures
    const results = await Promise.allSettled(
      unresolved.map((comment) =>
        apiUpdateReviewComment(selectedWorkspaceId, selectedSessionId, comment.id, {
          resolved: true,
          resolvedBy: 'user',
          resolutionType: 'fixed',
        })
      )
    );

    const failedCount = results.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) {
      showError(`Failed to resolve ${failedCount} comment${failedCount > 1 ? 's' : ''}`);
    }
  }, [selectedWorkspaceId, selectedSessionId, updateReviewComment, showError]);

  // Fetch files from session's worktree when session changes.
  // Decoupled from tab visibility so data is ready when the user switches tabs.
  // Debounced to avoid redundant API calls when rapidly switching sessions.
  // Uses AbortController to suppress stale state updates when session changes mid-flight.
  useEffect(() => {
    if (selectedWorkspaceId && selectedSessionId) {
      const abortController = new AbortController();
      setFilesLoading(true);
      setFilesError(null);
      const timeout = setTimeout(() => {
        listSessionFiles(selectedWorkspaceId, selectedSessionId, 'all')
          .then((data) => {
            if (!abortController.signal.aborted) setFiles(data as FileNode[]);
          })
          .catch((err) => {
            if (!abortController.signal.aborted) {
              if (err instanceof ApiError && err.code === ErrorCode.WORKTREE_NOT_FOUND) {
                setFilesError('worktree_missing');
              } else {
                setFilesError('error');
              }
              console.error(err);
            }
          })
          .finally(() => { if (!abortController.signal.aborted) setFilesLoading(false); });
      }, 150);
      return () => { abortController.abort(); clearTimeout(timeout); };
    }
  }, [selectedWorkspaceId, selectedSessionId]);

  // Refetch snapshot when branch sync completes (rebase/merge) or agent turn completes.
  // The snapshot hook handles polling and file-change debouncing, but these are explicit
  // triggers from other subsystems.
  useEffect(() => {
    if (branchSyncCompletedAt && selectedWorkspaceId && selectedSessionId) {
      refetchSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchSyncCompletedAt]);

  useEffect(() => {
    if (lastTurnCompletedAt && selectedWorkspaceId && selectedSessionId) {
      refetchSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTurnCompletedAt]);

  const unresolvedCount = useMemo(
    () => reviewComments.filter((c) => !c.resolved).length,
    [reviewComments]
  );

  const menuContext = useMemo<TopPanelMenuContext>(() => ({
    onCollapseAllFiles: () => fileTreeRef.current?.collapseAll(),
    onExpandAllFiles: () => fileTreeRef.current?.expandAll(),
    onRefreshFiles: () => {
      if (!selectedWorkspaceId || !selectedSessionId || filesLoading) return;
      // Capture session ID so stale responses after a session switch are ignored.
      // Use the ref (not the closure value) in callbacks since both would be identical.
      const capturedSessionId = selectedSessionId;
      invalidateSessionData(selectedWorkspaceId, selectedSessionId);
      setFilesLoading(true);
      setFilesError(null);
      listSessionFiles(selectedWorkspaceId, selectedSessionId, 'all')
        .then((data) => {
          if (prevSessionIdRef.current === capturedSessionId) setFiles(data as FileNode[]);
        })
        .catch((err) => {
          if (prevSessionIdRef.current === capturedSessionId) {
            if (err instanceof ApiError && err.code === ErrorCode.WORKTREE_NOT_FOUND) {
              setFilesError('worktree_missing');
            } else {
              setFilesError('error');
            }
            console.error(err);
          }
        })
        .finally(() => {
          if (prevSessionIdRef.current === capturedSessionId) setFilesLoading(false);
        });
    },
    onRefreshChanges: () => {
      // Invalidate caches on explicit refresh so stale data isn't re-shown
      if (selectedWorkspaceId && selectedSessionId) {
        invalidateSessionData(selectedWorkspaceId, selectedSessionId);
        invalidateFileContentCache(selectedWorkspaceId, selectedSessionId);
      }
      refetchSnapshot();
    },
    onRefreshChecks: () => checksPanelRef.current?.refreshAll(),
    prUrl,
    onResolveAll: handleResolveAll,
    unresolvedCount,
    showResolved,
    onToggleShowResolved: () => setShowResolved((prev) => !prev),
  }), [refetchSnapshot, handleResolveAll, prUrl, unresolvedCount, showResolved, selectedWorkspaceId, selectedSessionId, filesLoading]);

  // Wrap tab selection to trigger changes refresh when switching to the changes tab
  const handleTabSelect = useCallback((tabId: string) => {
    setSelectedTab(tabId);
    if (tabId === 'changes') {
      refetchSnapshot();
    }
  }, [refetchSnapshot]);

  // Handle bottom tab click when panel is minimized: expand and select the tab
  const handleBottomTabClick = useCallback((tabId: string) => {
    setBottomTab(tabId);
    if (sidebarBottomPanelMinimized) {
      setSidebarBottomPanelMinimized(false);
    }
  }, [sidebarBottomPanelMinimized, setSidebarBottomPanelMinimized]);

  // Listen for programmatic tab switch (e.g. when a background task starts).
  // Only switch if the event targets the currently selected session and the tab is visible.
  const hiddenBottomTabs = useSettingsStore((s) => s.hiddenBottomTabs);
  useAppEventListener('sidebar-switch-bottom-tab', (detail) => {
    if (detail.sessionId !== selectedSessionId) return;
    if (hiddenBottomTabs.includes(detail.tab as BottomPanelTab)) return;
    handleBottomTabClick(detail.tab);
  }, [handleBottomTabClick, selectedSessionId, hiddenBottomTabs]);

  // Sync imperative panel collapse/expand with the persisted minimized state
  useEffect(() => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    if (sidebarBottomPanelMinimized) {
      panel.collapse();
    } else {
      panel.expand();
    }
  }, [sidebarBottomPanelMinimized]);

  // Auto-switch to a tab when requested by other components (e.g., WebSocket comment_added).
  // Debounced so rapid-fire events (many comments in a review) only switch once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab: string }>).detail;
      if (detail?.tab) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => handleTabSelect(detail.tab), 300);
      }
    };
    window.addEventListener('select-sidebar-tab', handler);
    return () => {
      window.removeEventListener('select-sidebar-tab', handler);
      if (timer) clearTimeout(timer);
    };
  }, [handleTabSelect]);

  // Keyboard shortcuts for switching sidebar tabs
  const tabShortcuts = useMemo(() => ({
    sidebarFilesTab: () => handleTabSelect('files'),
    sidebarChangesTab: () => handleTabSelect('changes'),
    sidebarChecksTab: () => handleTabSelect('checks'),
    sidebarReviewTab: () => handleTabSelect('review'),
  }), [handleTabSelect]);
  useShortcuts(tabShortcuts);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Tabs Row */}
      <TopPanelTabs
        selectedTab={selectedTab}
        setSelectedTab={handleTabSelect}
        changesCount={branchStats?.totalFiles || changes?.length || 0}
        reviewCount={unresolvedCount}
        menuContext={menuContext}
      />

      {/* Always-mounted resizable layout — bottom panel uses collapsible API to avoid remounting */}
      <ResizablePanelGroup
        direction="vertical"
        className="flex-1 min-h-0"
        defaultLayout={layoutChanges}
        onLayoutChange={setLayoutChanges}
      >
        {/* Top Panel - Files/Changes/Review/Checks */}
        <ResizablePanel id="file-list" defaultSize="65%" minSize="20%" className="overflow-hidden">
          {/* All panels stay mounted; CSS visibility toggling prevents unmount/remount flash */}
          <div className={cn("h-full", selectedTab !== 'files' && 'hidden')}>
            {filesLoading && files.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filesError === 'worktree_missing' ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FolderX className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Worktree directory not found</p>
                  <p className="text-xs mt-1 opacity-70">The session&apos;s worktree may have been deleted</p>
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No workspace selected</p>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-0 flex flex-col overflow-hidden">
                {filterVisible && (
                  <FileTreeFilter
                    value={filterQuery}
                    onChange={setFilterQuery}
                    onClose={() => { setFilterVisible(false); setFilterQuery(''); }}
                  />
                )}
                <div className="flex-1 min-h-0 p-1">
                  <ErrorBoundary section="FileTree" fallback={<InlineErrorFallback message="Unable to display file tree" />}>
                    <FileTree
                      ref={fileTreeRef}
                      files={files}
                      onFileSelect={handleFileSelect}
                      onFilePreview={handleFilePreview}
                      onContextAction={handleContextAction}
                      onRename={fileOps.rename}
                      filterQuery={filterQuery}
                      changedPaths={changedPaths}
                      onMoveFile={fileOps.move}
                      workspacePath={currentSession?.worktreePath}
                      workspaceName={currentWorkspace?.name}
                    />
                  </ErrorBoundary>
                </div>
              </div>
            )}
          </div>
          <div className={cn("h-full", selectedTab !== 'changes' && 'hidden')}>
            {changesLoading && !changes?.length && !allChanges?.length ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : !changes?.length && !allChanges?.length ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No changes yet</p>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-full [&>div>div]:!block">
                <div ref={changesContainerRef} className="p-1 pr-2 overflow-hidden">
                  <ChangesFileList
                    changes={changes}
                    allChanges={allChanges}
                    branchStats={branchStats}
                    changesView={changesView}
                    onChangesViewChange={setChangesView}
                    onFileSelect={handleFileSelect}
                    onChangedFileSelect={handleChangedFileSelect}
                    containerWidth={containerWidth}
                    commentStats={commentStats}
                  />
                </div>
              </ScrollArea>
            )}
          </div>
          <div className={cn("h-full", selectedTab !== 'review' && 'hidden')}>
            <ErrorBoundary section="ReviewPanel" fallback={<InlineErrorFallback message="Unable to display review" />}>
              <ReviewPanel workspaceId={selectedWorkspaceId} sessionId={selectedSessionId} onFileSelect={handleReviewFileSelect} onSendFeedback={handleSendFeedback} showResolved={showResolved} />
            </ErrorBoundary>
          </div>
          <div className={cn("h-full", selectedTab !== 'checks' && 'hidden')}>
            <ErrorBoundary section="ChecksPanel" fallback={<InlineErrorFallback message="Unable to display checks" />}>
              <ChecksPanel ref={checksPanelRef} onSendMessage={handleGitActionMessage} onPrUrlChange={setPrUrl} active={selectedTab === 'checks'} />
            </ErrorBoundary>
          </div>
        </ResizablePanel>

        <ResizableHandle direction="vertical" onDoubleClick={toggleSidebarBottomPanel} />

        {/* Bottom Panel - Todos/MCP/History — collapsible to avoid remounting */}
        <ResizablePanel
          ref={bottomPanelRef}
          id="terminal"
          defaultSize="35%"
          minSize="15%"
          collapsible
          collapsedSize={0}
          onResize={(size) => {
            // Sync minimized state when user drags the panel to/from collapsed
            const isCollapsed = size.asPercentage === 0;
            if (isCollapsed !== sidebarBottomPanelMinimized) {
              setSidebarBottomPanelMinimized(isCollapsed);
            }
          }}
          className="overflow-hidden"
        >
          <div className="flex flex-col h-full w-full">
            {/* Tabs Row - matching top panel style */}
            <BottomPanelTabs
              bottomTab={bottomTab}
              setBottomTab={handleBottomTabClick}
              totalPendingTodos={totalPendingTodos}
              runningTaskCount={runningTaskCount}
              isMinimized={sidebarBottomPanelMinimized}
              onToggleMinimize={toggleSidebarBottomPanel}
            />
            {/* Tab content — CSS visibility toggling prevents unmount/remount */}
            <div className="flex-1 min-h-0">
              <div className={cn("h-full", bottomTab !== 'todos' && 'hidden')}>
                <ErrorBoundary section="TodoPanel" fallback={<InlineErrorFallback message="Unable to display tasks" />}>
                  <TodoPanel />
                </ErrorBoundary>
              </div>
              <div className={cn("h-full", bottomTab !== 'budget' && 'hidden')}>
                <ErrorBoundary section="BudgetPanel" fallback={<InlineErrorFallback message="Unable to display usage" />}>
                  <BudgetStatusPanel />
                </ErrorBoundary>
              </div>
              <div className={cn("h-full", bottomTab !== 'mcp' && 'hidden')}>
                <ErrorBoundary section="McpPanel" fallback={<InlineErrorFallback message="Unable to display MCP servers" />}>
                  <McpServersPanel />
                </ErrorBoundary>
              </div>
              {/* CSS 'hidden' keeps the component mounted; isVisible gates network fetches */}
              <div className={cn("h-full", bottomTab !== 'file-history' && 'hidden')}>
                <ErrorBoundary section="FileHistory" fallback={<InlineErrorFallback message="Unable to display file history" />}>
                  <FileHistoryPanel isVisible={bottomTab === 'file-history'} />
                </ErrorBoundary>
              </div>
              <div className={cn("h-full", bottomTab !== 'background' && 'hidden')}>
                <ErrorBoundary section="BackgroundTasks" fallback={<InlineErrorFallback message="Unable to display background tasks" />}>
                  <BackgroundTasksPanel conversationId={selectedConversationId} />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* File operation dialogs */}
      <ConfirmDeleteDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog(prev => ({ ...prev, open }))}
        onConfirm={() => {
          if (deleteDialog.paths.length > 1) {
            fileOps.deleteFiles(deleteDialog.paths);
            fileTreeRef.current?.clearSelection();
          } else if (deleteDialog.paths.length === 1) {
            fileOps.deleteFile(deleteDialog.paths[0], deleteDialog.isDir);
          }
          setDeleteDialog(prev => ({ ...prev, open: false }));
        }}
        name={deleteDialog.name}
        isDir={deleteDialog.isDir}
        isLoading={fileOps.loading === 'delete' || fileOps.loading === 'deleteFiles'}
      />
      <ConfirmDiscardDialog
        open={discardDialog.open}
        onOpenChange={(open) => setDiscardDialog(prev => ({ ...prev, open }))}
        onConfirm={() => {
          if (discardDialog.paths.length > 1) {
            fileOps.discardChanges(discardDialog.paths);
            fileTreeRef.current?.clearSelection();
          } else if (discardDialog.paths.length === 1) {
            fileOps.discard(discardDialog.paths[0]);
          }
          setDiscardDialog(prev => ({ ...prev, open: false }));
        }}
        name={discardDialog.name}
        isFolder={discardDialog.isFolder}
        isLoading={fileOps.loading === 'discard' || fileOps.loading === 'discardChanges'}
      />
      <NewItemDialog
        open={newItemDialog.open}
        onOpenChange={(open) => setNewItemDialog(prev => ({ ...prev, open }))}
        onConfirm={(name) => {
          const fullPath = newItemDialog.parentPath ? `${newItemDialog.parentPath}/${name}` : name;
          if (newItemDialog.type === 'file') {
            fileOps.createFile(fullPath);
          } else {
            fileOps.createFolder(fullPath);
          }
          setNewItemDialog(prev => ({ ...prev, open: false }));
        }}
        type={newItemDialog.type}
        parentPath={newItemDialog.parentPath}
        isLoading={fileOps.loading === 'createFile' || fileOps.loading === 'createFolder'}
      />
    </div>
  );
}

// Top panel tabs configuration (all tabs always visible)
const TOP_TABS_CONFIG: Record<AllTopPanelTab, { label: string; shortcutId?: string; icon?: React.ComponentType<{ className?: string }> }> = {
  changes: { label: 'Changes', shortcutId: 'sidebarChangesTab' },
  review: { label: 'Code Review', shortcutId: 'sidebarReviewTab' },
  checks: { label: 'Checks', shortcutId: 'sidebarChecksTab' },
  files: { label: 'Files', shortcutId: 'sidebarFilesTab' },
};

// Bottom panel tabs configuration
const BOTTOM_TABS_CONFIG: Record<AllBottomPanelTab, { label: string; alwaysVisible?: boolean }> = {
  todos: { label: 'Tasks', alwaysVisible: true },
  'file-history': { label: 'File History' },
  budget: { label: 'Usage' },
  mcp: { label: 'MCP' },
  background: { label: 'Background' },
  // TODO: Re-add scripts tab when the feature is reintroduced: scripts: { label: 'Scripts' },
};

// Sortable tab button component
const SortableTabButton = memo(function SortableTabButton({
  id,
  label,
  isActive,
  onClick,
  badge,
  shortcutId,
  icon,
}: {
  id: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
  shortcutId?: string;
  icon?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id });

  // Style for dragging - z-index and transform
  const style: React.CSSProperties | undefined = {
    transform: transform ? `translateX(${transform.x}px)` : undefined,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? 'relative' : undefined,
  };

  // Prevent click from firing after drag ends
  const handleClick = useCallback(() => {
    if (!isDragging) {
      onClick();
    }
  }, [isDragging, onClick]);

  const shortcutDisplay = useMemo(() => {
    if (!shortcutId) return null;
    const shortcut = getShortcutById(shortcutId);
    if (!shortcut) return null;
    return formatShortcutKeys(shortcut).join(' ');
  }, [shortcutId]);

  const button = (
    <Button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      variant="ghost"
      size="sm"
      className={cn(
        "h-6 text-xs px-2 gap-1 rounded-sm shrink-0 transition-none active:!scale-100",
        isActive
          ? "bg-surface-2 dark:bg-surface-2 text-foreground font-medium"
          : "text-muted-foreground",
        isDragging && "bg-surface-2 shadow-md opacity-90"
      )}
      onClick={handleClick}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="bg-muted-foreground/20 text-foreground px-1 rounded text-2xs">
          {badge}
        </span>
      )}
    </Button>
  );

  if (!shortcutDisplay) return button;

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        {button}
      </TooltipTrigger>
      <TooltipContent side="top">
        {label} <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-sm">{shortcutDisplay}</span>
      </TooltipContent>
    </Tooltip>
  );
});

function BottomPanelTabs({
  bottomTab,
  setBottomTab,
  totalPendingTodos,
  runningTaskCount,
  isMinimized,
  onToggleMinimize,
}: {
  bottomTab: string;
  setBottomTab: (tab: string) => void;
  totalPendingTodos: number;
  runningTaskCount: number;
  isMinimized: boolean;
  onToggleMinimize: () => void;
}) {
  // Use individual selectors to prevent unnecessary re-renders
  const hiddenBottomTabs = useSettingsStore((s) => s.hiddenBottomTabs);
  const toggleBottomTab = useSettingsStore((s) => s.toggleBottomTab);
  const bottomTabOrder = useSettingsStore((s) => s.bottomTabOrder);
  const setBottomTabOrder = useSettingsStore((s) => s.setBottomTabOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Memoize visible tab IDs to prevent SortableContext re-renders
  const visibleTabIds = useMemo(() =>
    bottomTabOrder.filter((tabId) => {
      const config = BOTTOM_TABS_CONFIG[tabId];
      return config && (config.alwaysVisible || !hiddenBottomTabs.includes(tabId as BottomPanelTab));
    }),
    [bottomTabOrder, hiddenBottomTabs]
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = bottomTabOrder.indexOf(active.id as AllBottomPanelTab);
      const newIndex = bottomTabOrder.indexOf(over.id as AllBottomPanelTab);
      const newOrder = arrayMove(bottomTabOrder, oldIndex, newIndex);
      setBottomTabOrder(newOrder);
    }
  }, [bottomTabOrder, setBottomTabOrder]);

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 shrink-0 min-w-0 overflow-hidden">
      {/* Scrollable tabs container */}
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleTabIds}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex items-center gap-0.5">
              {visibleTabIds.map((tabId) => (
                <SortableTabButton
                  key={tabId}
                  id={tabId}
                  label={BOTTOM_TABS_CONFIG[tabId].label}
                  isActive={bottomTab === tabId}
                  onClick={() => setBottomTab(tabId)}
                  badge={tabId === 'todos' ? totalPendingTodos : tabId === 'background' ? runningTaskCount : undefined}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Settings dropdown - always visible */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0 ml-1"
          >
            <MoreVertical className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {bottomTabOrder.map((tabId) => {
            const config = BOTTOM_TABS_CONFIG[tabId];
            return (
              <DropdownMenuCheckboxItem
                key={tabId}
                checked={config.alwaysVisible || !hiddenBottomTabs.includes(tabId as BottomPanelTab)}
                disabled={config.alwaysVisible}
                onCheckedChange={() => {
                  if (!config.alwaysVisible) {
                    toggleBottomTab(tabId as BottomPanelTab);
                  }
                }}
              >
                {config.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Minimize/expand toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            onClick={onToggleMinimize}
          >
            {isMinimized ? (
              <ChevronsUpDown className="size-3" />
            ) : (
              <ChevronsDownUp className="size-3" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {isMinimized ? 'Expand Panel' : 'Minimize Panel'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

interface TopPanelMenuContext {
  onCollapseAllFiles?: () => void;
  onExpandAllFiles?: () => void;
  onRefreshFiles?: () => void;
  onRefreshChanges?: () => void;
  onRefreshChecks?: () => void;
  prUrl?: string | null;
  onResolveAll?: () => void;
  unresolvedCount?: number;
  showResolved?: boolean;
  onToggleShowResolved?: () => void;
}

function TopPanelTabs({
  selectedTab,
  setSelectedTab,
  changesCount,
  reviewCount,
  menuContext,
}: {
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
  changesCount: number;
  reviewCount: number;
  menuContext: TopPanelMenuContext;
}) {
  const topTabOrder = useSettingsStore((s) => s.topTabOrder);
  const setTopTabOrder = useSettingsStore((s) => s.setTopTabOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // All tabs are always visible — just filter out any that don't have config
  const visibleTabIds = useMemo(() =>
    topTabOrder.filter((tabId) => TOP_TABS_CONFIG[tabId]),
    [topTabOrder]
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = topTabOrder.indexOf(active.id as AllTopPanelTab);
      const newIndex = topTabOrder.indexOf(over.id as AllTopPanelTab);
      const newOrder = arrayMove(topTabOrder, oldIndex, newIndex);
      setTopTabOrder(newOrder);
    }
  }, [topTabOrder, setTopTabOrder]);

  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1 shrink-0 min-w-0 overflow-hidden">
      {/* Scrollable tabs container */}
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleTabIds}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex items-center gap-0.5">
              {visibleTabIds.map((tabId) => (
                <SortableTabButton
                  key={tabId}
                  id={tabId}
                  label={TOP_TABS_CONFIG[tabId].label}
                  isActive={selectedTab === tabId}
                  onClick={() => setSelectedTab(tabId)}
                  badge={
                    tabId === 'changes' && changesCount > 0 ? changesCount
                    : tabId === 'review' && reviewCount > 0 ? reviewCount
                    : undefined
                  }
                  shortcutId={TOP_TABS_CONFIG[tabId].shortcutId}
                  icon={(() => {
                    const IconComponent = TOP_TABS_CONFIG[tabId].icon;
                    if (!IconComponent) return undefined;
                    return <IconComponent className="size-3" />;
                  })()}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Context-aware dropdown menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0 ml-1"
          >
            <MoreVertical className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Search Files — available on all tabs */}
          <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('open-file-picker'))}>
            <Search className="size-4" />
            Search Files
          </DropdownMenuItem>

          {/* Files tab context menu */}
          {selectedTab === 'files' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={menuContext.onRefreshFiles}>
                <RefreshCw className="size-4" />
                Refresh
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={menuContext.onCollapseAllFiles}>
                <ChevronsDownUp className="size-4" />
                Collapse All
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={menuContext.onExpandAllFiles}>
                <ChevronsUpDown className="size-4" />
                Expand All
              </DropdownMenuItem>
            </>
          )}

          {/* Changes tab context menu */}
          {selectedTab === 'changes' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={menuContext.onRefreshChanges}>
                <RefreshCw className="size-4" />
                Refresh
              </DropdownMenuItem>
            </>
          )}

          {/* Checks tab context menu */}
          {selectedTab === 'checks' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={menuContext.onRefreshChecks}>
                <RefreshCw className="size-4" />
                Refresh
              </DropdownMenuItem>
              {menuContext.prUrl && (
                <DropdownMenuItem onSelect={() => window.open(menuContext.prUrl!, '_blank')}>
                  <ExternalLink className="size-4" />
                  View PR on GitHub
                </DropdownMenuItem>
              )}
            </>
          )}

          {/* Review tab context menu */}
          {selectedTab === 'review' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={menuContext.onResolveAll}
                disabled={!menuContext.unresolvedCount}
              >
                <CheckCheck className="size-4" />
                Resolve All
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={menuContext.onToggleShowResolved}>
                {menuContext.showResolved ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
                {menuContext.showResolved ? 'Hide Resolved' : 'Show Resolved'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FileChangeRow({ change, onSelect, containerWidth, commentStats }: {
  change: FileChangeDTO;
  onSelect: () => void;
  containerWidth: number;
  commentStats?: { total: number; unresolved: number };
}) {
  const parts = change.path.split('/');
  const fileName = parts.pop() || change.path;
  const dirPath = parts.join('/');

  // Dynamic truncation based on container width
  // Wider container = show more path segments
  const smartTruncateDir = useCallback((dir: string) => {
    const parts = dir.split('/');

    // Calculate how many segments we can show based on width
    // ~50px for icon, ~80px for stats+checkbox, rest for path
    const availableWidth = containerWidth - 130;
    // Rough estimate: each path segment is ~60-80px on average
    const maxSegments = Math.max(1, Math.floor(availableWidth / 70));

    if (parts.length <= maxSegments) return dir; // Show full path if it fits

    if (maxSegments <= 1) {
      // Very narrow: just show last segment
      return '…/' + parts[parts.length - 1];
    } else if (maxSegments === 2) {
      // Show first and last
      return parts[0] + '/…/' + parts[parts.length - 1];
    } else if (maxSegments === 3) {
      // Show first, ellipsis, last two
      return parts[0] + '/…/' + parts.slice(-2).join('/');
    } else {
      // Show first two, ellipsis, last segments to fill
      const lastCount = maxSegments - 2;
      return parts.slice(0, 2).join('/') + '/…/' + parts.slice(-lastCount).join('/');
    }
  }, [containerWidth]);

  const hasStats = change.additions > 0 || change.deletions > 0;

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-0.5 hover:bg-surface-2 cursor-pointer w-full max-w-full rounded-sm transition-colors"
      onClick={onSelect}
      title={change.path}
    >
      <FileIcon filename={fileName} className="shrink-0" />
      {/* Path section - truncates to fit available space */}
      <div className="flex items-center min-w-0 flex-1 overflow-hidden">
        {dirPath && (
          <span className="text-xs text-muted-foreground shrink-0">
            {smartTruncateDir(dirPath)}/
          </span>
        )}
        <span className="text-base font-medium truncate">{fileName}</span>
      </div>
      {/* Stats - always visible */}
      {hasStats && (
        <span className="text-xs shrink-0 tabular-nums whitespace-nowrap">
          {change.additions > 0 && (
            <span className="text-text-success">+{change.additions}</span>
          )}
          {change.deletions > 0 && (
            <span className="text-text-error ml-1">-{change.deletions}</span>
          )}
        </span>
      )}
      {/* Comment badge - show unresolved count */}
      {commentStats && commentStats.unresolved > 0 && (
        <span className="flex items-center gap-0.5 text-text-warning shrink-0" title={`${commentStats.unresolved} unresolved comment${commentStats.unresolved > 1 ? 's' : ''}`}>
          <MessageSquare className="h-3 w-3" />
          <span className="text-2xs font-medium">{commentStats.unresolved}</span>
        </span>
      )}
          </div>
  );
}

const KNOWN_STATUSES = ['added', 'modified', 'deleted', 'untracked'] as const;
const CHANGES_GROUP_ORDER = ['untracked', 'added', 'modified', 'deleted'] as const;
const CHANGES_GROUP_LABELS: Record<string, string> = {
  added: 'ADDED',
  modified: 'MODIFIED',
  deleted: 'DELETED',
  untracked: 'UNTRACKED',
};

export function ChangesFileList({
  changes,
  allChanges,
  branchStats,
  changesView,
  onChangesViewChange,
  onFileSelect,
  onChangedFileSelect,
  containerWidth,
  commentStats,
}: {
  changes: FileChangeDTO[];
  allChanges: FileChangeDTO[];
  branchStats: BranchStatsDTO | null;
  changesView: 'all' | 'uncommitted';
  onChangesViewChange: (view: 'all' | 'uncommitted') => void;
  onFileSelect: (path: string) => void;
  onChangedFileSelect: (path: string) => void;
  containerWidth: number;
  commentStats: Map<string, { total: number; unresolved: number }>;
}) {
  const displayFiles = changesView === 'all' ? allChanges : changes;

  const displayStats = useMemo(() => {
    if (changesView === 'all') {
      return branchStats ?? { totalFiles: 0, totalAdditions: 0, totalDeletions: 0 };
    }
    // Compute stats from uncommitted changes
    let totalAdditions = 0;
    let totalDeletions = 0;
    for (const c of changes) {
      totalAdditions += c.additions;
      totalDeletions += c.deletions;
    }
    return { totalFiles: changes.length, totalAdditions, totalDeletions };
  }, [changesView, branchStats, changes]);

  const grouped = useMemo(() => {
    const groups: Record<string, FileChangeDTO[]> = {};
    const sortByPath = (a: FileChangeDTO, b: FileChangeDTO) => a.path.localeCompare(b.path);

    for (const file of displayFiles) {
      // Map unknown statuses to 'modified' so they still appear
      const key = (KNOWN_STATUSES as readonly string[]).includes(file.status) ? file.status : 'modified';
      if (!groups[key]) groups[key] = [];
      groups[key].push(file);
    }

    for (const key of Object.keys(groups)) {
      groups[key].sort(sortByPath);
    }

    return groups;
  }, [displayFiles]);

  const groupOrder = CHANGES_GROUP_ORDER;

  return (
    <>
      {/* Stats + Toggle Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
        {displayStats.totalFiles > 0 && (
          <>
            <span className="font-mono tabular-nums">
              <span className="text-green-500">+{displayStats.totalAdditions}</span>
              <span className="text-red-500 ml-1">-{displayStats.totalDeletions}</span>
            </span>
            <span>across {displayStats.totalFiles} file{displayStats.totalFiles !== 1 ? 's' : ''}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5 bg-surface-2 dark:bg-surface-1 rounded-md p-0.5 shadow-inner">
          <button
            onClick={() => onChangesViewChange('all')}
            className={cn(
              "px-1.5 py-0.5 rounded-sm text-2xs transition-all duration-150",
              changesView === 'all' ? "bg-white dark:bg-surface-3 text-foreground font-medium shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]" : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            All
          </button>
          <button
            onClick={() => onChangesViewChange('uncommitted')}
            className={cn(
              "px-1.5 py-0.5 rounded-sm text-2xs transition-all duration-150",
              changesView === 'uncommitted' ? "bg-white dark:bg-surface-3 text-foreground font-medium shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]" : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            Uncommitted
          </button>
        </div>
      </div>

      {/* Grouped file list */}
      {displayFiles.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <CheckCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No uncommitted changes</p>
          </div>
        </div>
      ) : (
        groupOrder.map(status => {
          const files = grouped[status];
          if (!files?.length) return null;
          return (
            <div key={status}>
              <div className="px-2 py-1 text-2xs font-medium text-foreground/60 uppercase tracking-wider">
                {CHANGES_GROUP_LABELS[status]}
              </div>
              {files.map(file => (
                <FileChangeRow
                  key={file.path}
                  change={file}
                  onSelect={() => onChangedFileSelect(file.path)}
                  containerWidth={containerWidth}
                  commentStats={commentStats.get(file.path)}
                />
              ))}
            </div>
          );
        })
      )}
    </>
  );
}

export function CollapsibleSection({ title, count, open, onToggle, children }: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 px-2 py-1 w-full hover:bg-surface-2 rounded-sm transition-colors"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-xs font-medium text-foreground/60 uppercase tracking-wider">
          {title}
        </span>
        <span className="text-2xs text-muted-foreground ml-auto tabular-nums">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

