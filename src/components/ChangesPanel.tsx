'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { listRepoFiles, type FileNodeDTO } from '@/lib/api';
import { FileTree, type FileNode } from '@/components/FileTree';
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
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Search,
  SplitSquareHorizontal,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileChange } from '@/lib/types';

export function ChangesPanel() {
  const { fileChanges, selectedWorkspaceId } = useAppStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedTab, setSelectedTab] = useState('files');
  const [terminalTab, setTerminalTab] = useState('terminal');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Fetch files when workspace changes or tab switches to files
  useEffect(() => {
    if (selectedTab === 'files' && selectedWorkspaceId) {
      setFilesLoading(true);
      listRepoFiles(selectedWorkspaceId, 'all')
        .then((data) => {
          // Convert FileNodeDTO to FileNode (they're the same shape)
          setFiles(data as FileNode[]);
        })
        .catch(console.error)
        .finally(() => setFilesLoading(false));
    }
  }, [selectedTab, selectedWorkspaceId]);

  // Group files by directory
  const groupedChanges = fileChanges.reduce((acc, change) => {
    const parts = change.path.split('/');
    const dir = parts.slice(0, -1).join('/') || '.';
    if (!acc[dir]) acc[dir] = [];
    acc[dir].push(change);
    return acc;
  }, {} as Record<string, FileChange[]>);

  const toggleDir = (dir: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(dir)) {
      newExpanded.delete(dir);
    } else {
      newExpanded.add(dir);
    }
    setExpandedDirs(newExpanded);
  };

  const totalAdditions = fileChanges.reduce((sum, c) => sum + c.additions, 0);
  const totalDeletions = fileChanges.reduce((sum, c) => sum + c.deletions, 0);

  return (
    <div className="flex flex-col h-full border-l">
      {/* Top Bar - matches main TopBar */}
      <div className="h-11 flex items-center gap-2 px-3 border-b bg-muted/30 shrink-0">
        <span className="text-sm font-medium text-muted-foreground">Working...</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b shrink-0">
        <Button
          variant={selectedTab === 'files' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setSelectedTab('files')}
        >
          All files
        </Button>
        <Button
          variant={selectedTab === 'changes' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => setSelectedTab('changes')}
        >
          Changes
          {fileChanges.length > 0 && (
            <span className="bg-muted-foreground/20 text-foreground px-1.5 rounded text-[10px] ml-1">
              {fileChanges.length}
            </span>
          )}
        </Button>
        <Button
          variant={selectedTab === 'checks' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => setSelectedTab('checks')}
        >
          Checks
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground">
          <Eye className="h-3 w-3" />
          Review
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Search className="h-3.5 w-3.5" />
        </Button>
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
              <FileTree files={files} onFileSelect={(path) => console.log('Selected:', path)} />
            )
          ) : selectedTab === 'changes' ? (
            <ScrollArea className="h-full">
              <div className="py-1">
                {fileChanges.length === 0 ? (
                  <div className="px-3 py-8 text-center text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No changes yet</p>
                  </div>
                ) : (
                  Object.entries(groupedChanges).map(([dir, changedFiles]) => (
                    <div key={dir}>
                      {dir !== '.' && (
                        <div
                          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground cursor-pointer hover:bg-accent/50"
                          onClick={() => toggleDir(dir)}
                        >
                          {expandedDirs.has(dir) ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                          <span className="truncate">{dir}</span>
                        </div>
                      )}
                      {(dir === '.' || expandedDirs.has(dir)) &&
                        changedFiles.map((file) => (
                          <FileChangeRow key={file.path} change={file} />
                        ))}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
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

        {/* Terminal Section */}
        <ResizablePanel id="terminal" defaultSize="35%" minSize="15%">
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-1 px-2 py-1 border-t bg-muted/30 shrink-0">
              <Button
                variant={terminalTab === 'setup' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setTerminalTab('setup')}
              >
                Setup
              </Button>
              <Button
                variant={terminalTab === 'run' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setTerminalTab('run')}
              >
                Run
              </Button>
              <Button
                variant={terminalTab === 'terminal' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 text-xs px-2"
                onClick={() => setTerminalTab('terminal')}
              >
                Terminal
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex-1 bg-black/90 p-2 font-mono text-xs text-green-400 overflow-auto">
              <div className="flex items-center gap-2">
                <span className="text-blue-400">~/dev/chatml</span>
                <span className="text-purple-400">dakar-v2</span>
                <span className="text-muted-foreground">$</span>
                <span className="animate-pulse">_</span>
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function FileChangeRow({ change }: { change: FileChange }) {
  const fileName = change.path.split('/').pop() || change.path;
  const fileIcon = change.path.includes('package.json')
    ? '📦'
    : change.path.includes('tsconfig')
    ? '⚙️'
    : '📄';

  return (
    <div className="group flex items-center gap-2 px-2 py-1 hover:bg-accent/50 cursor-pointer">
      <Checkbox className="h-3.5 w-3.5" />
      <span className="text-sm">{fileIcon}</span>
      <span className="flex-1 text-sm truncate">{fileName}</span>
      <span className="text-xs">
        {change.additions > 0 && (
          <span className="text-green-500">+{change.additions}</span>
        )}
        {change.deletions > 0 && (
          <span className="text-red-500 ml-1">-{change.deletions}</span>
        )}
      </span>
      <Checkbox className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
    </div>
  );
}
