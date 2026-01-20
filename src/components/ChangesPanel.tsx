'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/stores/appStore';
import { listRepoFiles, getRepoFileContent, getSessionChanges, getSessionFileDiff, type FileNodeDTO, type FileChangeDTO } from '@/lib/api';
import { FileTree, FileIcon, type FileNode } from '@/components/FileTree';
import { TodoPanel } from '@/components/TodoPanel';

// Dynamic import for TerminalOutput (browser-only)
const TerminalOutput = dynamic(() => import('@/components/TerminalOutput').then(mod => mod.TerminalOutput), {
  ssr: false,
  loading: () => <div className="h-full bg-black/90 flex items-center justify-center"><span className="text-xs text-muted-foreground">Loading...</span></div>,
});
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
  const { selectedWorkspaceId, selectedSessionId, selectedConversationId, sessions, workspaces, openFileTab, updateFileTab, agentTodos, customTodos } = useAppStore();
  const [selectedTab, setSelectedTab] = useState('changes');
  const [outputTab, setOutputTab] = useState<'setup' | 'run'>('setup');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [changes, setChanges] = useState<FileChangeDTO[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);

  // Handle file selection from file tree
  const handleFileSelect = async (path: string) => {
    if (!selectedWorkspaceId) return;

    const filename = path.split('/').pop() || path;
    const tabId = `${selectedWorkspaceId}-${path}`;

    // Create tab with loading state
    const newTab: FileTab = {
      id: tabId,
      workspaceId: selectedWorkspaceId,
      path,
      name: filename,
      isLoading: true,
      viewMode: 'file',
    };

    openFileTab(newTab);

    // Fetch file content
    try {
      const fileData = await getRepoFileContent(selectedWorkspaceId, path);
      updateFileTab(tabId, {
        content: fileData.content,
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

  // Handle changed file selection - shows diff view
  const handleChangedFileSelect = async (path: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const filename = path.split('/').pop() || path;
    const tabId = `${selectedWorkspaceId}-diff-${path}`;

    // Check if it's a binary file
    if (isBinaryFile(filename)) {
      const newTab: FileTab = {
        id: tabId,
        workspaceId: selectedWorkspaceId,
        path,
        name: filename,
        isLoading: false,
        viewMode: 'diff',
        isBinary: true,
      };
      openFileTab(newTab);
      return;
    }

    // Create tab with loading state for text files
    const newTab: FileTab = {
      id: tabId,
      workspaceId: selectedWorkspaceId,
      path,
      name: filename,
      isLoading: true,
      viewMode: 'diff',
    };

    openFileTab(newTab);

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
  const currentAgentTodos = selectedConversationId ? agentTodos[selectedConversationId] || [] : [];
  const currentCustomTodos = selectedSessionId ? customTodos[selectedSessionId] || [] : [];
  const pendingAgentTodos = currentAgentTodos.filter((t) => t.status !== 'completed').length;
  const pendingCustomTodos = currentCustomTodos.filter((t) => !t.completed).length;
  const totalPendingTodos = pendingAgentTodos + pendingCustomTodos;

  // Fetch files when workspace changes or tab switches to files
  useEffect(() => {
    if (selectedTab === 'files' && selectedWorkspaceId) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setFilesLoading(true);
      });
      listRepoFiles(selectedWorkspaceId, 'all')
        .then((data) => {
          // Convert FileNodeDTO to FileNode (they're the same shape)
          if (!cancelled) setFiles(data as FileNode[]);
        })
        .catch(console.error)
        .finally(() => { if (!cancelled) setFilesLoading(false); });
      return () => { cancelled = true; };
    }
  }, [selectedTab, selectedWorkspaceId]);

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
                workspacePath={currentWorkspace?.path}
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
              <ScrollArea className="h-full">
                <div className="py-1">
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
                      />
                    ))}
                </div>
              </ScrollArea>
            )
          ) : selectedTab === 'todos' ? (
            <TodoPanel />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No checks configured</p>
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
            </div>
            <div className="flex-1 min-h-0">
              {outputTab === 'setup' && selectedSessionId && (
                <TerminalOutput sessionId={selectedSessionId} type="setup" />
              )}
              {outputTab === 'run' && selectedSessionId && (
                <TerminalOutput sessionId={selectedSessionId} type="run" />
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function FileChangeRow({ change, onSelect }: { change: FileChangeDTO; onSelect: () => void }) {
  const parts = change.path.split('/');
  const fileName = parts.pop() || change.path;
  const dirPath = parts.join('/');

  // Truncate directory path from the left if too long
  const truncateDir = (dir: string, maxLen: number = 25) => {
    if (dir.length <= maxLen) return dir;
    return '...' + dir.slice(-(maxLen - 3));
  };

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-0.5 hover:bg-accent/50 cursor-pointer"
      onClick={onSelect}
    >
      <FileIcon filename={fileName} />
      {dirPath && (
        <span className="text-xs text-muted-foreground truncate shrink-0 max-w-[120px]">
          {truncateDir(dirPath)}
        </span>
      )}
      <span className="flex-1 text-xs font-medium truncate">{fileName}</span>
      <span className="text-[10px] shrink-0">
        {change.additions > 0 && (
          <span className="text-green-500">+{change.additions}</span>
        )}
        {change.deletions > 0 && (
          <span className="text-red-500 ml-1">-{change.deletions}</span>
        )}
      </span>
      <Checkbox className="h-3.5 w-3.5 shrink-0" />
    </div>
  );
}
