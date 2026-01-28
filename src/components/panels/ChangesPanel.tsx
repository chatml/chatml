'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds, useFileTabState, useTodoState, useFileCommentStats } from '@/stores/selectors';
import { listSessionFiles, getSessionFileContent, getSessionChanges, getSessionFileDiff, sendConversationMessage, type FileChangeDTO } from '@/lib/api';
import { watchWorkspace, unwatchWorkspace, listenForFileChanges, type FileChangedEvent } from '@/lib/tauri';
import { FileTree, FileIcon, type FileNode } from '@/components/files/FileTree';
import { TodoPanel } from '@/components/panels/TodoPanel';
import { CheckpointTimeline } from '@/components/panels/CheckpointTimeline';
import { BudgetStatusPanel } from '@/components/panels/BudgetStatusPanel';
import { GitStatusSection } from '@/components/panels/GitStatusSection';
import { PrimaryActionButton } from '@/components/shared/PrimaryActionButton';
import { AppSettingsMenu } from '@/components/settings/AppSettingsMenu';
import { useGitStatus } from '@/hooks/useGitStatus';
import { usePRStatus } from '@/hooks/usePRStatus';

import { McpServersPanel } from '@/components/panels/McpServersPanel';
import { PlansPanel } from '@/components/panels/PlansPanel';
import { ReviewPanel } from '@/components/panels/ReviewPanel';
import { FileHistoryPanel } from '@/components/panels/FileHistoryPanel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { useSettingsStore, type BottomPanelTab, type AllBottomPanelTab, DEFAULT_BOTTOM_TAB_ORDER } from '@/stores/settingsStore';
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import {
  Eye,
  MoreVertical,
  FileText,
  Search,
  SplitSquareHorizontal,
  Loader2,
  GitPullRequest,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileTab } from '@/lib/types';

// Common binary file extensions
const BINARY_EXTENSIONS = new Set([
  // Images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'tiff', 'tif', 'avif',
  // Videos
  'mp4', 'webm', 'avi', 'mov', 'mkv', 'flv', 'wmv',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a',
  // Archives
  'zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // Executables/Binaries
  'exe', 'dll', 'so', 'dylib', 'bin', 'app', 'dmg', 'pkg', 'deb', 'rpm',
  // Fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Other
  'sqlite', 'db', 'dat', 'class', 'pyc', 'pyo', 'o', 'a',
]);

function isBinaryFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXTENSIONS.has(ext);
}

// Maximum file size for diff viewing (2MB)
const MAX_DIFF_SIZE = 2 * 1024 * 1024;

interface ChangesPanelProps {
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
}

export function ChangesPanel({
  onOpenSettings,
  onOpenShortcuts,
}: ChangesPanelProps = {}) {
  // Use optimized selectors to prevent unnecessary re-renders
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId } = useSelectedIds();
  const { openFileTab, updateFileTab } = useFileTabState();
  const { agentTodos } = useTodoState(selectedConversationId, selectedSessionId);
  const commentStats = useFileCommentStats(selectedSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const updateSession = useAppStore((s) => s.updateSession);
  const layoutChanges = useSettingsStore((s) => s.layoutChanges);
  const setLayoutChanges = useSettingsStore((s) => s.setLayoutChanges);
  const [selectedTab, setSelectedTab] = useState('files');
  const [bottomTab, setBottomTab] = useState('todos');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [changes, setChanges] = useState<FileChangeDTO[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState(400);
  const changesContainerRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch changes function (extracted for reuse)
  const fetchChanges = useCallback(async () => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    try {
      const data = await getSessionChanges(selectedWorkspaceId, selectedSessionId);
      setChanges(data || []);

      // Update session stats in the store
      if (data && data.length > 0) {
        const stats = data.reduce(
          (acc, change) => ({
            additions: acc.additions + change.additions,
            deletions: acc.deletions + change.deletions,
          }),
          { additions: 0, deletions: 0 }
        );
        updateSession(selectedSessionId, { stats });
      } else {
        // Clear stats if no changes
        updateSession(selectedSessionId, { stats: undefined });
      }
    } catch (error) {
      console.error('Failed to fetch changes:', error);
    }
  }, [selectedWorkspaceId, selectedSessionId, updateSession]);

  // Debounced refetch for file change events
  const debouncedFetchChanges = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    debounceTimeoutRef.current = setTimeout(() => {
      fetchChanges();
    }, 500); // 500ms debounce for rapid file changes
  }, [fetchChanges]);

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

  // Handle file selection from file tree (session-scoped tab)
  const handleFileSelect = async (path: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const filename = path.split('/').pop() || path;
    // Include sessionId in tab ID to allow same file open in different sessions
    const tabId = `${selectedWorkspaceId}-${selectedSessionId}-${path}`;

    // Create tab with loading state (session-scoped for complete isolation)
    const newTab: FileTab = {
      id: tabId,
      workspaceId: selectedWorkspaceId,
      sessionId: selectedSessionId,
      path,
      name: filename,
      isLoading: true,
      viewMode: 'file',
    };

    openFileTab(newTab);

    // Always set loading state for existing tabs (e.g., restored from persistence without content)
    updateFileTab(tabId, { isLoading: true });

    // Fetch file content from session's worktree (not main repo)
    try {
      const fileData = await getSessionFileContent(selectedWorkspaceId, selectedSessionId, path);
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

  // Handle changed file selection - shows diff view (session-scoped tab)
  const handleChangedFileSelect = async (path: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const filename = path.split('/').pop() || path;
    // Include sessionId in tab ID to allow same file open in different sessions
    const tabId = `${selectedWorkspaceId}-${selectedSessionId}-diff-${path}`;

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

    // Always set loading state for existing tabs (e.g., restored from persistence without content)
    updateFileTab(tabId, { isLoading: true });

    // Fetch diff
    try {
      const diffData = await getSessionFileDiff(selectedWorkspaceId, selectedSessionId, path);

      // Check if file is too large
      const totalSize = (diffData.oldContent?.length || 0) + (diffData.newContent?.length || 0);
      if (totalSize > MAX_DIFF_SIZE) {
        updateFileTab(tabId, {
          isLoading: false,
          isTooLarge: true,
        });
        return;
      }

      updateFileTab(tabId, {
        diff: {
          // Ensure strings even if API returns undefined
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

  // Get current session and workspace for status-based styling
  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const currentWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  // Track branch for refetching changes when branch is renamed
  const currentBranch = currentSession?.branch;

  // Determine top bar state
  const hasActivePR = currentSession?.prStatus === 'open';
  const hasConflictOrFailure = currentSession?.hasMergeConflict || currentSession?.hasCheckFailures;

  // Calculate todo counts for badge
  const totalPendingTodos = agentTodos.filter((t) => t.status !== 'completed').length;

  // Callback for GitStatusSection to send messages to the agent
  const handleGitActionMessage = useCallback((content: string) => {
    if (!selectedConversationId) {
      console.warn('No conversation selected, cannot send git action message');
      return;
    }
    sendConversationMessage(selectedConversationId, content).catch(console.error);
  }, [selectedConversationId]);

  // Fetch git status for the primary action button
  const { status: gitStatus } = useGitStatus(selectedWorkspaceId, selectedSessionId);

  // Fetch PR details for the primary action button
  const { prDetails } = usePRStatus(
    selectedWorkspaceId,
    selectedSessionId,
    currentSession?.prStatus
  );

  // Fetch files from session's worktree when session changes or tab switches to files
  useEffect(() => {
    if (selectedTab === 'files' && selectedWorkspaceId && selectedSessionId) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setFilesLoading(true);
      });
      listSessionFiles(selectedWorkspaceId, selectedSessionId, 'all')
        .then((data) => {
          // Convert FileNodeDTO to FileNode (they're the same shape)
          if (!cancelled) setFiles(data as FileNode[]);
        })
        .catch(console.error)
        .finally(() => { if (!cancelled) setFilesLoading(false); });
      return () => { cancelled = true; };
    }
  }, [selectedTab, selectedWorkspaceId, selectedSessionId]);

  // Fetch changes when session changes, tab switches to changes, or branch is renamed
  useEffect(() => {
    if (selectedTab === 'changes' && selectedWorkspaceId && selectedSessionId) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setChangesLoading(true);
      });
      getSessionChanges(selectedWorkspaceId, selectedSessionId)
        .then((data) => {
          if (!cancelled) setChanges(data || []);
        })
        .catch(console.error)
        .finally(() => { if (!cancelled) setChangesLoading(false); });
      return () => { cancelled = true; };
    }
  }, [selectedTab, selectedWorkspaceId, selectedSessionId, currentBranch]);

  // Watch session worktree for file changes and auto-refresh
  useEffect(() => {
    if (!selectedSessionId || !currentSession?.worktreePath) return;

    const cleanupRef = { current: null as (() => void) | null };
    let isMounted = true;

    // Start watching the session's worktree directory (using session ID as the key)
    watchWorkspace(selectedSessionId, currentSession.worktreePath);

    const handleFileChange = (event: FileChangedEvent) => {
      // Only refetch if the file change is for this session's worktree
      if (event.workspaceId === selectedSessionId) {
        debouncedFetchChanges();
      }
    };

    listenForFileChanges(handleFileChange).then((unlisten) => {
      if (isMounted) {
        cleanupRef.current = unlisten;
      } else {
        // Component unmounted before listener was ready - clean up safely
        try {
          unlisten();
        } catch {
          // Ignore errors if listener wasn't fully registered
        }
      }
    });

    return () => {
      isMounted = false;
      try {
        cleanupRef.current?.();
      } catch {
        // Ignore errors if listener cleanup fails
      }
      // Stop watching this session's worktree
      unwatchWorkspace(selectedSessionId);
      // Clear any pending debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [selectedSessionId, currentSession?.worktreePath, debouncedFetchChanges]);

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar - changes based on session state */}
      <div
        data-tauri-drag-region
        className={cn(
          'h-10 flex items-center gap-2 px-3 border-b shrink-0 overflow-hidden @container',
          hasActivePR && 'bg-text-success/15 border-text-success/30',
          hasConflictOrFailure && 'bg-text-error/15 border-text-error/30'
        )}
      >
        {/* Review Button - icon only with tooltip when narrow, label when wide */}
        {/* Narrow: icon + tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2 gap-1.5 transition-colors shrink-0 @[280px]:hidden',
                hasActivePR && 'text-text-success hover:bg-text-success/10',
                hasConflictOrFailure && 'text-text-error hover:bg-text-error/10',
                !hasActivePR && !hasConflictOrFailure && 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Eye className="h-3.5 w-3.5 shrink-0" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Review Changes</TooltipContent>
        </Tooltip>
        {/* Wide: icon + label, no tooltip needed */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 px-2 gap-1.5 transition-colors shrink-0 hidden @[280px]:flex',
            hasActivePR && 'text-text-success hover:bg-text-success/10',
            hasConflictOrFailure && 'text-text-error hover:bg-text-error/10',
            !hasActivePR && !hasConflictOrFailure && 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Eye className="h-3.5 w-3.5 shrink-0" />
          Review
        </Button>

        {/* PR Status or Conflict indicator - truncates in middle */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {hasActivePR ? (
            <>
              <GitPullRequest className="h-3.5 w-3.5 text-text-success shrink-0" />
              <span className="text-[12px] font-medium text-text-success truncate">
                PR #{currentSession?.prNumber}
              </span>
              {currentSession?.prUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-text-success hover:bg-text-success/20 shrink-0"
                  onClick={() => window.open(currentSession.prUrl, '_blank')}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </>
          ) : hasConflictOrFailure && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-text-error shrink-0" />
              <span className="text-[12px] font-medium text-text-error truncate">
                {currentSession?.hasMergeConflict ? 'Merge Conflict' : 'Check Failures'}
              </span>
            </>
          )}
        </div>

        {/* Right side - always visible, pinned to right */}
        <div className="flex items-center gap-1 shrink-0">
          <PrimaryActionButton
            workspaceId={selectedWorkspaceId}
            session={currentSession}
            onSendMessage={handleGitActionMessage}
            gitStatus={gitStatus}
            prDetails={prDetails}
          />
          {onOpenSettings && onOpenShortcuts && (
            <AppSettingsMenu
              onOpenSettings={onOpenSettings}
              onOpenShortcuts={onOpenShortcuts}
            />
          )}
        </div>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b shrink-0 overflow-hidden min-w-0">
        <Button
          variant={selectedTab === 'changes' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn("h-6 text-xs px-2 gap-1 shrink-0", selectedTab !== 'changes' && "text-muted-foreground")}
          onClick={() => setSelectedTab('changes')}
        >
          Changes
          {changes?.length > 0 && (
            <span className="bg-muted-foreground/20 text-foreground px-1 rounded text-[11px]">
              {changes.length}
            </span>
          )}
        </Button>
        <Button
          variant={selectedTab === 'review' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn("h-6 text-xs px-2 shrink-0", selectedTab !== 'review' && "text-muted-foreground")}
          onClick={() => setSelectedTab('review')}
        >
          Review
        </Button>
        <Button
          variant={selectedTab === 'checks' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn("h-6 text-xs px-2 shrink-0", selectedTab !== 'checks' && "text-muted-foreground")}
          onClick={() => setSelectedTab('checks')}
        >
          Checks
        </Button>
        <Button
          variant={selectedTab === 'files' ? 'secondary' : 'ghost'}
          size="sm"
          className={cn("h-6 text-xs px-2 shrink-0", selectedTab !== 'files' && "text-muted-foreground")}
          onClick={() => setSelectedTab('files')}
        >
          Files
        </Button>
        <div className="flex-1 min-w-0" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <SplitSquareHorizontal className="size-4" />
              Split View
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.dispatchEvent(new CustomEvent('open-file-picker'))}>
              <Search className="size-4" />
              Search Files
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Resizable content area */}
      <ResizablePanelGroup
        direction="vertical"
        className="flex-1 min-h-0"
        defaultLayout={layoutChanges}
        onLayoutChange={setLayoutChanges}
      >
        {/* File List */}
        <ResizablePanel id="file-list" defaultSize="65%" minSize="20%">
          {selectedTab === 'files' ? (
            filesLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : files.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No workspace selected</p>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-0 p-1 overflow-hidden">
                <FileTree
                  files={files}
                  onFileSelect={handleFileSelect}
                  workspacePath={currentSession?.worktreePath}
                  workspaceName={currentWorkspace?.name}
                />
              </div>
            )
          ) : selectedTab === 'changes' ? (
            changesLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : !changes?.length ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No changes yet</p>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-full [&>div>div]:!block">
                <div ref={changesContainerRef} className="p-1 pr-2 overflow-hidden">
                  {(() => {
                    const sortByPath = (a: FileChangeDTO, b: FileChangeDTO) => {
                      const aIsRoot = !a.path.includes('/');
                      const bIsRoot = !b.path.includes('/');
                      if (aIsRoot && !bIsRoot) return -1;
                      if (!aIsRoot && bIsRoot) return 1;
                      return a.path.localeCompare(b.path);
                    };
                    const untracked = changes.filter(c => c.status === 'untracked').sort(sortByPath);
                    const tracked = changes.filter(c => c.status !== 'untracked').sort(sortByPath);

                    return (
                      <>
                        {untracked.length > 0 && (
                          <>
                            <div className="px-2 py-1 text-[10px] font-medium text-foreground/60 uppercase tracking-wider">
                              UNTRACKED
                            </div>
                            {untracked.map((change) => (
                              <FileChangeRow
                                key={change.path}
                                change={change}
                                onSelect={() => handleFileSelect(change.path)}
                                containerWidth={containerWidth}
                                commentStats={commentStats.get(change.path)}
                              />
                            ))}
                          </>
                        )}
                        {tracked.length > 0 && (
                          <>
                            {untracked.length > 0 && (
                              <div className="px-2 py-1 mt-2 text-[10px] font-medium text-foreground/60 uppercase tracking-wider">
                                CHANGED
                              </div>
                            )}
                            {tracked.map((change) => (
                              <FileChangeRow
                                key={change.path}
                                change={change}
                                onSelect={() => handleChangedFileSelect(change.path)}
                                containerWidth={containerWidth}
                                commentStats={commentStats.get(change.path)}
                              />
                            ))}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              </ScrollArea>
            )
          ) : selectedTab === 'review' ? (
            <ReviewPanel onFileSelect={handleFileSelect} />
          ) : selectedTab === 'checks' ? (
            <div className="h-full px-1.5">
              <GitStatusSection onSendMessage={handleGitActionMessage} />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No content</p>
              </div>
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle direction="vertical" />

        {/* Bottom Panel - Todos/MCP/History */}
        <ResizablePanel id="terminal" defaultSize="35%" minSize="15%">
          <div className="flex flex-col h-full">
            {/* Tabs Row - matching top panel style */}
            <BottomPanelTabs
              bottomTab={bottomTab}
              setBottomTab={setBottomTab}
              totalPendingTodos={totalPendingTodos}
            />
            {/* Tab content */}
            <div className="flex-1 min-h-0">
              {bottomTab === 'todos' && <TodoPanel />}
              {bottomTab === 'plans' && <PlansPanel />}
              {bottomTab === 'budget' && <BudgetStatusPanel />}
              {bottomTab === 'mcp' && <McpServersPanel />}
              {bottomTab === 'history' && <CheckpointTimeline />}
              {bottomTab === 'file-history' && <FileHistoryPanel />}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// Bottom panel tabs configuration
const BOTTOM_TABS_CONFIG: Record<AllBottomPanelTab, { label: string; alwaysVisible?: boolean }> = {
  todos: { label: 'Tasks', alwaysVisible: true },
  plans: { label: 'Plans' },
  history: { label: 'Checkpoints' },
  'file-history': { label: 'File History' },
  budget: { label: 'Budget' },
  mcp: { label: 'MCP' },
};

// Sortable tab button component
const SortableTabButton = memo(function SortableTabButton({
  id,
  label,
  isActive,
  onClick,
  badge,
}: {
  id: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
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

  return (
    <Button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      variant={isActive ? 'secondary' : 'ghost'}
      size="sm"
      className={cn(
        "h-6 text-[11px] px-2 gap-1 shrink-0 transition-none active:!scale-100",
        !isActive && "text-muted-foreground",
        isDragging && "bg-surface-2 shadow-md opacity-90"
      )}
      onClick={handleClick}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="bg-muted-foreground/20 text-foreground px-1 rounded text-[10px]">
          {badge}
        </span>
      )}
    </Button>
  );
});

function BottomPanelTabs({
  bottomTab,
  setBottomTab,
  totalPendingTodos,
}: {
  bottomTab: string;
  setBottomTab: (tab: string) => void;
  totalPendingTodos: number;
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
    <div className="flex items-center gap-0.5 px-1.5 py-1 shrink-0">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleTabIds}
          strategy={horizontalListSortingStrategy}
        >
          {visibleTabIds.map((tabId) => (
            <SortableTabButton
              key={tabId}
              id={tabId}
              label={BOTTOM_TABS_CONFIG[tabId].label}
              isActive={bottomTab === tabId}
              onClick={() => setBottomTab(tabId)}
              badge={tabId === 'todos' ? totalPendingTodos : undefined}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
          >
            <MoreVertical className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {DEFAULT_BOTTOM_TAB_ORDER.map((tabId) => {
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
        <span className="text-sm font-medium truncate">{fileName}</span>
      </div>
      {/* Stats - always visible */}
      {hasStats && (
        <span className="text-[11px] shrink-0 tabular-nums whitespace-nowrap">
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
          <span className="text-[10px] font-medium">{commentStats.unresolved}</span>
        </span>
      )}
          </div>
  );
}
