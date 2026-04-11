'use client';

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import {
  File,
  FolderPlus,
  Pencil,
  Copy,
  Trash2,
  GitCompareArrows,
  Undo2,
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  ExternalLink,
  Terminal,
  FolderOpen,
  RefreshCw,
  FilePlus,
  ClipboardCopy,
  FileText,
  Link,
  Columns2,
  Bot,
  MessageSquarePlus,
  FileSearch,
  TestTube2,
  FileCode,
  Sparkles,
  SplitSquareHorizontal,
} from 'lucide-react';
import type { FileNode } from './FileTree';

export type ContextAction =
  // Open actions
  | 'open'
  | 'open-new-tab'
  | 'open-to-side'
  // Edit actions
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'duplicate'
  | 'delete'
  // Clipboard actions
  | 'copy-path'
  | 'copy-relative-path'
  | 'copy-name'
  // Git actions
  | 'view-diff'
  | 'discard-changes'
  | 'view-history'
  | 'discard-folder-changes'
  // Navigation actions
  | 'expand-all'
  | 'collapse-all'
  | 'find-in-folder'
  | 'refresh'
  // Open In actions
  | 'reveal-in-finder'
  | 'open-in-terminal'
  | 'open-in-vscode'
  // AI actions
  | 'ai-add-to-context'
  | 'ai-explain'
  | 'ai-generate-tests'
  | 'ai-review'
  | 'ai-add-all-to-context'
  | 'ai-explain-module'
  // Multi-select actions
  | 'delete-selected'
  | 'discard-selected'
  | 'copy-selected-paths'
  | 'ai-add-selected-to-context';

interface FileContextMenuProps {
  node: FileNode;
  isChanged: boolean;
  onAction: (action: ContextAction, node: FileNode) => void;
}

export function FileContextMenu({ node, isChanged, onAction }: FileContextMenuProps) {
  return (
    <ContextMenuContent className="w-56">
      {/* Open actions */}
      <ContextMenuItem onClick={() => onAction('open', node)}>
        <File className="size-4" />
        Open
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('open-new-tab', node)}>
        <FilePlus className="size-4" />
        Open in New Tab
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('open-to-side', node)}>
        <SplitSquareHorizontal className="size-4" />
        Open to the Side
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Edit actions */}
      <ContextMenuItem onClick={() => onAction('rename', node)}>
        <Pencil className="size-4" />
        Rename…
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('duplicate', node)}>
        <Copy className="size-4" />
        Duplicate
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={() => onAction('delete', node)}>
        <Trash2 className="size-4" />
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Clipboard actions */}
      <ContextMenuItem onClick={() => onAction('copy-path', node)}>
        <ClipboardCopy className="size-4" />
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('copy-relative-path', node)}>
        <Link className="size-4" />
        Copy Relative Path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('copy-name', node)}>
        <FileText className="size-4" />
        Copy Name
      </ContextMenuItem>

      {/* Git actions (conditional) */}
      {isChanged && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onAction('view-diff', node)}>
            <GitCompareArrows className="size-4" />
            View Diff
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onClick={() => onAction('discard-changes', node)}>
            <Undo2 className="size-4" />
            Discard Changes
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />

      {/* Open In submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ExternalLink className="size-4" />
          Open In
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-48">
          <ContextMenuItem onClick={() => onAction('reveal-in-finder', node)}>
            <FolderOpen className="size-4" />
            Reveal in Finder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('open-in-terminal', node)}>
            <Terminal className="size-4" />
            Open in Terminal
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('open-in-vscode', node)}>
            <FileCode className="size-4" />
            Open in VS Code
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      {/* AI Actions submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Sparkles className="size-4" />
          AI Actions
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-52">
          <ContextMenuItem onClick={() => onAction('ai-add-to-context', node)}>
            <MessageSquarePlus className="size-4" />
            Add to Context
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('ai-explain', node)}>
            <Bot className="size-4" />
            Explain File
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('ai-generate-tests', node)}>
            <TestTube2 className="size-4" />
            Generate Tests
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('ai-review', node)}>
            <FileSearch className="size-4" />
            Review File
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  );
}

interface FolderContextMenuProps {
  node: FileNode;
  hasChanges: boolean;
  onAction: (action: ContextAction, node: FileNode) => void;
}

export function FolderContextMenu({ node, hasChanges, onAction }: FolderContextMenuProps) {
  return (
    <ContextMenuContent className="w-56">
      {/* Create actions */}
      <ContextMenuItem onClick={() => onAction('new-file', node)}>
        <FilePlus className="size-4" />
        New File…
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('new-folder', node)}>
        <FolderPlus className="size-4" />
        New Folder…
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Edit actions */}
      <ContextMenuItem onClick={() => onAction('rename', node)}>
        <Pencil className="size-4" />
        Rename…
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={() => onAction('delete', node)}>
        <Trash2 className="size-4" />
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Navigation actions */}
      <ContextMenuItem onClick={() => onAction('expand-all', node)}>
        <ChevronsUpDown className="size-4" />
        Expand All
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('collapse-all', node)}>
        <ChevronsDownUp className="size-4" />
        Collapse All
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('find-in-folder', node)}>
        <Search className="size-4" />
        Find in Folder…
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Clipboard actions */}
      <ContextMenuItem onClick={() => onAction('copy-path', node)}>
        <ClipboardCopy className="size-4" />
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('copy-relative-path', node)}>
        <Link className="size-4" />
        Copy Relative Path
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('copy-name', node)}>
        <FileText className="size-4" />
        Copy Name
      </ContextMenuItem>

      {/* Git actions (conditional) */}
      {hasChanges && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => onAction('discard-folder-changes', node)}>
            <Undo2 className="size-4" />
            Discard All Changes
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />

      {/* Open In submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ExternalLink className="size-4" />
          Open In
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-48">
          <ContextMenuItem onClick={() => onAction('reveal-in-finder', node)}>
            <FolderOpen className="size-4" />
            Reveal in Finder
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('open-in-terminal', node)}>
            <Terminal className="size-4" />
            Open in Terminal
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('open-in-vscode', node)}>
            <FileCode className="size-4" />
            Open in VS Code
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      {/* AI Actions submenu */}
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Sparkles className="size-4" />
          AI Actions
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-52">
          <ContextMenuItem onClick={() => onAction('ai-add-all-to-context', node)}>
            <MessageSquarePlus className="size-4" />
            Add All Files to Context
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onAction('ai-explain-module', node)}>
            <Bot className="size-4" />
            Explain Module
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  );
}

interface BackgroundContextMenuProps {
  onAction: (action: ContextAction) => void;
}

export function BackgroundContextMenu({ onAction }: BackgroundContextMenuProps) {
  return (
    <ContextMenuContent className="w-56">
      {/* Create actions */}
      <ContextMenuItem onClick={() => onAction('new-file')}>
        <FilePlus className="size-4" />
        New File…
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('new-folder')}>
        <FolderPlus className="size-4" />
        New Folder…
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Navigation actions */}
      <ContextMenuItem onClick={() => onAction('expand-all')}>
        <ChevronsUpDown className="size-4" />
        Expand All
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onAction('collapse-all')}>
        <ChevronsDownUp className="size-4" />
        Collapse All
      </ContextMenuItem>

      <ContextMenuSeparator />

      {/* Refresh */}
      <ContextMenuItem onClick={() => onAction('refresh')}>
        <RefreshCw className="size-4" />
        Refresh
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

interface MultiSelectContextMenuProps {
  selectedCount: number;
  hasChangedFiles: boolean;
  onAction: (action: ContextAction) => void;
}

export function MultiSelectContextMenu({ selectedCount, hasChangedFiles, onAction }: MultiSelectContextMenuProps) {
  return (
    <ContextMenuContent className="w-56">
      <ContextMenuItem onClick={() => onAction('copy-selected-paths')}>
        <ClipboardCopy className="size-4" />
        Copy Paths ({selectedCount})
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={() => onAction('ai-add-selected-to-context')}>
        <MessageSquarePlus className="size-4" />
        Add All to Context ({selectedCount})
      </ContextMenuItem>

      <ContextMenuSeparator />

      {hasChangedFiles && (
        <>
          <ContextMenuItem variant="destructive" onClick={() => onAction('discard-selected')}>
            <Undo2 className="size-4" />
            Discard Changes ({selectedCount})
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}

      <ContextMenuItem variant="destructive" onClick={() => onAction('delete-selected')}>
        <Trash2 className="size-4" />
        Delete Selected ({selectedCount})
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
