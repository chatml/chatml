'use client';

import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  ChevronDown,
  ExternalLink,
  GitPullRequest,
  Terminal,
  FolderOpen,
  Code,
  PanelLeft,
  PanelRight,
} from 'lucide-react';

interface TopBarProps {
  showLeftSidebar?: boolean;
  showRightSidebar?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
}

export function TopBar({
  showLeftSidebar = true,
  showRightSidebar = true,
  onToggleLeftSidebar,
  onToggleRightSidebar
}: TopBarProps) {
  const {
    workspaces,
    sessions,
    selectedWorkspaceId,
    selectedSessionId,
    totalCost,
  } = useAppStore();

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  if (!selectedWorkspace || !selectedSession) {
    return (
      <div data-tauri-drag-region className={`h-11 flex items-center gap-2 px-3 border-b bg-muted/30 shrink-0 ${!showLeftSidebar ? 'pl-20' : ''}`}>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground ml-2">
          Select a session to get started
        </span>
      </div>
    );
  }

  return (
    <div data-tauri-drag-region className={`h-11 flex items-center gap-2 px-3 border-b bg-muted/30 shrink-0 ${!showLeftSidebar ? 'pl-20' : ''}`}>
      {/* Toggle Left Sidebar Button - only shown when sidebar is hidden */}
      {!showLeftSidebar && onToggleLeftSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleLeftSidebar}
          title="Show sidebar (⌘B)"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Navigation */}
      <Button variant="ghost" size="icon" className="h-7 w-7">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7">
        <ChevronRight className="h-4 w-4" />
      </Button>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 ml-2 text-sm">
        <span className="text-muted-foreground">{selectedWorkspace.name}</span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          <span className="font-medium">{selectedSession.branch}</span>
        </div>
      </div>

      {/* Open Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 ml-2 text-xs">
            Open
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem>
            <Code className="h-4 w-4 mr-2" />
            VS Code
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FolderOpen className="h-4 w-4 mr-2" />
            Finder
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Terminal className="h-4 w-4 mr-2" />
            Terminal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <ExternalLink className="h-4 w-4 mr-2" />
            GitHub
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Cost */}
      <div className="text-xs text-muted-foreground font-mono px-2">
        {formatCost(totalCost)}
      </div>

      {/* Create PR Button */}
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-primary border border-transparent hover:border-primary/50 hover:bg-primary/10 transition-colors">
        <GitPullRequest className="h-3.5 w-3.5" />
        Create PR
      </Button>

      {/* Toggle Right Sidebar Button - only shown when sidebar is hidden */}
      {!showRightSidebar && onToggleRightSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleRightSidebar}
          title="Show sidebar (⌘⌥B)"
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
