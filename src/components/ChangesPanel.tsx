'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds, useFileTabState, useTodoState } from '@/stores/selectors';
import { listSessionFiles, getSessionFileContent, getSessionChanges, getSessionFileDiff, sendConversationMessage, type FileNodeDTO, type FileChangeDTO } from '@/lib/api';
import { listenForFileChanges, type FileChangedEvent } from '@/lib/tauri';
import { FileTree, FileIcon, type FileNode } from '@/components/FileTree';
import { TodoPanel } from '@/components/TodoPanel';
import { CheckpointTimeline } from '@/components/CheckpointTimeline';
import { BudgetStatusPanel } from '@/components/BudgetStatusPanel';
import { GitStatusSection } from '@/components/GitStatusSection';

import { McpServersPanel } from '@/components/McpServersPanel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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

export function ChangesPanel() {
  // Use optimized selectors to prevent unnecessary re-renders
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId } = useSelectedIds();
  const { openFileTab, updateFileTab } = useFileTabState();
  const { agentTodos } = useTodoState(selectedConversationId, selectedSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const [selectedTab, setSelectedTab] = useState('changes');
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
    } catch (error) {
      console.error('Failed to fetch changes:', error);
    }
  }, [selectedWorkspaceId, selectedSessionId]);

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
      updateFileTab(tabId, {
        content: fileData.content,
        originalContent: fileData.content, // Store original for dirty detection
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to load file:', error);
      updateFileTab(tabId, {
        content: `// Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        content: `// Error loading diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isLoading: false,
      });
    }
  };

  // Get current session and workspace for status-based styling
  const currentSession = sessions.find((s) => s.id === selectedSessionId);
  const currentWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

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

  // Fetch changes when session changes or tab switches to changes
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
  }, [selectedTab, selectedWorkspaceId, selectedSessionId]);

  // Listen for file change events and auto-refresh changes
  useEffect(() => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const cleanupRef = { current: null as (() => void) | null };
    let isMounted = true;

    const handleFileChange = (event: FileChangedEvent) => {
      // Only refetch if the file change is for this workspace
      if (event.workspaceId === selectedWorkspaceId) {
        debouncedFetchChanges();
      }
    };

    listenForFileChanges(handleFileChange).then((unlisten) => {
      if (isMounted) {
        cleanupRef.current = unlisten;
      } else {
        unlisten();
      }
    });

    return () => {
      isMounted = false;
      cleanupRef.current?.();
      // Clear any pending debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [selectedWorkspaceId, selectedSessionId, debouncedFetchChanges]);

  return (
    <div className="flex flex-col h-full border-l">
      {/* Top Bar - changes based on session state */}
      <div
        className={cn(
          'h-11 flex items-center gap-2 px-3 border-b shrink-0',
          hasActivePR && 'bg-green-500/15 border-green-500/30',
          hasConflictOrFailure && 'bg-red-500/15 border-red-500/30',
          !hasActivePR && !hasConflictOrFailure && 'bg-muted/30'
        )}
      >
        {hasActivePR ? (
          <>
            <GitPullRequest className="h-4 w-4 text-green-500 shrink-0" />
            <span className="text-sm font-medium text-green-600 dark:text-green-400 truncate">
              PR #{currentSession?.prNumber}
            </span>
            {currentSession?.prUrl && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-green-600 dark:text-green-400 hover:bg-green-500/20"
                onClick={() => window.open(currentSession.prUrl, '_blank')}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </>
        ) : hasConflictOrFailure ? (
          <>
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-sm font-medium text-red-600 dark:text-red-400 truncate">
              {currentSession?.hasMergeConflict ? 'Merge Conflict' : 'Check Failures'}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-muted-foreground truncate">
              {currentSession?.status === 'active' ? 'Working...' :
               currentSession?.status === 'done' ? 'Completed' :
               currentSession?.status === 'error' ? 'Error' : 'Ready'}
            </span>
          </>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 text-xs gap-1.5 border border-transparent transition-colors',
            hasActivePR && 'text-green-600 dark:text-green-400 hover:border-green-500/50 hover:bg-green-500/10',
            hasConflictOrFailure && 'text-red-600 dark:text-red-400 hover:border-red-500/50 hover:bg-red-500/10',
            !hasActivePR && !hasConflictOrFailure && 'text-primary hover:border-primary/50 hover:bg-primary/10'
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Review
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 text-xs gap-1.5 border border-transparent transition-colors',
            hasActivePR && 'text-green-600 dark:text-green-400 hover:border-green-500/50 hover:bg-green-500/10',
            hasConflictOrFailure && 'text-red-600 dark:text-red-400 hover:border-red-500/50 hover:bg-red-500/10',
            !hasActivePR && !hasConflictOrFailure && 'text-primary hover:border-primary/50 hover:bg-primary/10'
          )}
        >
          <GitPullRequest className="h-3.5 w-3.5" />
          Create PR
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b shrink-0 overflow-hidden min-w-0">
        <Button
          variant={selectedTab === 'changes' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2 gap-1 shrink-0"
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
          variant={selectedTab === 'checks' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2 shrink-0"
          onClick={() => setSelectedTab('checks')}
        >
          Checks
        </Button>
        <Button
          variant={selectedTab === 'files' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2 shrink-0"
          onClick={() => setSelectedTab('files')}
        >
          All files
        </Button>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center shrink-0">
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <SplitSquareHorizontal className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Search className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Resizable content area */}
      <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
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
              <FileTree
                files={files}
                onFileSelect={handleFileSelect}
                workspacePath={currentSession?.worktreePath}
                workspaceName={currentWorkspace?.name}
              />
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
                <div ref={changesContainerRef} className="py-1 overflow-hidden">
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
                            <div className="px-2 py-1 text-[11px] font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wide">
                              Untracked
                            </div>
                            {untracked.map((change) => (
                              <FileChangeRow
                                key={change.path}
                                change={change}
                                onSelect={() => handleFileSelect(change.path)}
                                containerWidth={containerWidth}
                              />
                            ))}
                          </>
                        )}
                        {tracked.length > 0 && (
                          <>
                            <div className={cn(
                              "px-2 py-1 text-[11px] font-medium text-purple-700 dark:text-purple-400 uppercase tracking-wide",
                              untracked.length > 0 && "mt-2"
                            )}>
                              Changed
                            </div>
                            {tracked.map((change) => (
                              <FileChangeRow
                                key={change.path}
                                change={change}
                                onSelect={() => handleChangedFileSelect(change.path)}
                                containerWidth={containerWidth}
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

        <ResizableHandle />

        {/* Bottom Panel - Todos/MCP/History */}
        <ResizablePanel id="terminal" defaultSize="35%" minSize="15%">
          <Tabs defaultValue="todos" className="flex flex-col h-full">
            <div className="px-2 py-1.5 border-t shrink-0">
              <TabsList className="h-7">
                <TabsTrigger value="todos" className="text-xs px-2 h-6 gap-1">
                  Todos
                  {totalPendingTodos > 0 && (
                    <span className="bg-muted-foreground/20 text-foreground px-1 rounded text-[11px]">
                      {totalPendingTodos}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="mcp" className="text-xs px-2 h-6">
                  MCP
                </TabsTrigger>
                <TabsTrigger value="history" className="text-xs px-2 h-6">
                  History
                </TabsTrigger>
              </TabsList>
            </div>
            <BudgetStatusPanel />
            <TabsContent value="todos" className="flex-1 min-h-0 mt-0">
              <TodoPanel />
            </TabsContent>
            <TabsContent value="mcp" className="flex-1 min-h-0 mt-0">
              <McpServersPanel />
            </TabsContent>
            <TabsContent value="history" className="flex-1 min-h-0 mt-0">
              <CheckpointTimeline />
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function FileChangeRow({ change, onSelect, containerWidth }: { change: FileChangeDTO; onSelect: () => void; containerWidth: number }) {
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
      className="group flex items-center gap-1.5 px-2 py-0.5 hover:bg-accent/50 cursor-pointer w-full max-w-full"
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
        <span className="text-xs font-medium truncate">{fileName}</span>
      </div>
      {/* Stats - always visible */}
      {hasStats && (
        <span className="text-[11px] shrink-0 tabular-nums whitespace-nowrap">
          {change.additions > 0 && (
            <span className="text-green-500">+{change.additions}</span>
          )}
          {change.deletions > 0 && (
            <span className="text-red-500 ml-1">-{change.deletions}</span>
          )}
        </span>
      )}
      <Checkbox className="h-3.5 w-3.5 shrink-0" />
    </div>
  );
}
