'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/stores/appStore';
import { useSelectedIds, useFileTabState, useTodoState } from '@/stores/selectors';
import { listSessionFiles, getSessionFileContent, getSessionChanges, getSessionFileDiff, sendConversationMessage, type FileNodeDTO, type FileChangeDTO } from '@/lib/api';
import { FileTree, FileIcon, type FileNode } from '@/components/FileTree';
import { TodoPanel } from '@/components/TodoPanel';
import { CheckpointTimeline } from '@/components/CheckpointTimeline';
import { BudgetStatusPanel } from '@/components/BudgetStatusPanel';
import { GitStatusSection } from '@/components/GitStatusSection';

// Dynamic import for TerminalOutput (browser-only)
const TerminalOutput = dynamic(() => import('@/components/TerminalOutput').then(mod => mod.TerminalOutput), {
  ssr: false,
  loading: () => <div className="h-full bg-black/90 flex items-center justify-center"><span className="text-xs text-muted-foreground">Loading...</span></div>,
});
import { McpServersPanel } from '@/components/McpServersPanel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  const { agentTodos, customTodos } = useTodoState(selectedConversationId, selectedSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const workspaces = useAppStore((s) => s.workspaces);
  const [selectedTab, setSelectedTab] = useState('changes');
  const [outputTab, setOutputTab] = useState<'setup' | 'run' | 'mcp' | 'checkpoints'>('setup');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [changes, setChanges] = useState<FileChangeDTO[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState(400);
  const changesContainerRef = useRef<HTMLDivElement>(null);

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
  // useTodoState already returns arrays scoped to the selected conversation/session
  const pendingAgentTodos = agentTodos.filter((t) => t.status !== 'completed').length;
  const pendingCustomTodos = customTodos.filter((t) => !t.completed).length;
  const totalPendingTodos = pendingAgentTodos + pendingCustomTodos;

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
            <span className="bg-muted-foreground/20 text-foreground px-1 rounded text-[10px]">
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
          variant={selectedTab === 'todos' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 text-xs px-2 gap-1 shrink-0"
          onClick={() => setSelectedTab('todos')}
        >
          Todos
          {totalPendingTodos > 0 && (
            <span className="bg-muted-foreground/20 text-foreground px-1 rounded text-[10px]">
              {totalPendingTodos}
            </span>
          )}
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
                  {[...changes]
                    .sort((a, b) => {
                      const aIsRoot = !a.path.includes('/');
                      const bIsRoot = !b.path.includes('/');
                      // Root files come first
                      if (aIsRoot && !bIsRoot) return -1;
                      if (!aIsRoot && bIsRoot) return 1;
                      // Then sort alphabetically
                      return a.path.localeCompare(b.path);
                    })
                    .map((change) => (
                      <FileChangeRow
                        key={change.path}
                        change={change}
                        onSelect={() => handleChangedFileSelect(change.path)}
                        containerWidth={containerWidth}
                      />
                    ))}
                </div>
              </ScrollArea>
            )
          ) : selectedTab === 'todos' ? (
            <TodoPanel />
          ) : selectedTab === 'checks' ? (
            <GitStatusSection onSendMessage={handleGitActionMessage} />
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

        {/* Setup/Run Output Section */}
        <ResizablePanel id="terminal" defaultSize="35%" minSize="15%">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 px-2 py-1 border-t bg-muted/30 shrink-0">
              <Button
                variant={outputTab === 'setup' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setOutputTab('setup')}
              >
                Setup
              </Button>
              <Button
                variant={outputTab === 'run' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setOutputTab('run')}
              >
                Run
              </Button>
              <Button
                variant={outputTab === 'mcp' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setOutputTab('mcp')}
              >
                MCP
              </Button>
              <Button
                variant={outputTab === 'checkpoints' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setOutputTab('checkpoints')}
              >
                History
              </Button>
            </div>
            <BudgetStatusPanel />
            <div className="flex-1 min-h-0">
              {outputTab === 'setup' && selectedSessionId && (
                <TerminalOutput sessionId={selectedSessionId} type="setup" />
              )}
              {outputTab === 'run' && selectedSessionId && (
                <TerminalOutput sessionId={selectedSessionId} type="run" />
              )}
              {outputTab === 'mcp' && (
                <McpServersPanel />
              )}
              {outputTab === 'checkpoints' && (
                <CheckpointTimeline />
              )}
            </div>
          </div>
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
        <span className="text-[10px] shrink-0 tabular-nums whitespace-nowrap">
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
