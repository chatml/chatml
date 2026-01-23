'use client';

import { useWorkspaceSelection, useTotalCost } from '@/stores/selectors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  ChevronDown,
  ExternalLink,
  Terminal,
  FolderOpen,
  Code,
  PanelLeft,
  PanelRight,
  Folder,
  Calendar,
  Layers,
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
  // Use optimized selectors to prevent unnecessary re-renders
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();
  const totalCost = useTotalCost();

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const workspaceSessionCount = sessions.filter((s) => s.workspaceId === selectedWorkspaceId && !s.archived).length;

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  if (!selectedWorkspace || !selectedSession) {
    return (
      <div data-tauri-drag-region className={`h-11 flex items-center border-b bg-muted/30 shrink-0 ${!showLeftSidebar ? 'pl-20' : ''}`}>
        {/* Toggle Left Sidebar Button - only shown when sidebar is hidden */}
        {!showLeftSidebar && onToggleLeftSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 ml-1"
            onClick={onToggleLeftSidebar}
            title="Show sidebar (⌘B)"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        )}
        {/* Navigation buttons - tight together */}
        <div className={`flex items-center ${!showLeftSidebar ? 'ml-1' : 'ml-0.5'}`}>
          <Button variant="ghost" size="icon" className="h-6 w-6 p-0" disabled>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 p-0" disabled>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm text-muted-foreground ml-2">
          Select a session to get started
        </span>
      </div>
    );
  }

  return (
    <div data-tauri-drag-region className={`h-11 flex items-center border-b bg-muted/30 shrink-0 ${!showLeftSidebar ? 'pl-20' : ''}`}>
      {/* Toggle Left Sidebar Button - only shown when sidebar is hidden */}
      {!showLeftSidebar && onToggleLeftSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-1"
          onClick={onToggleLeftSidebar}
          title="Show sidebar (⌘B)"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Navigation buttons - tight together, close to divider */}
      <div className={`flex items-center ${!showLeftSidebar ? 'ml-1' : 'ml-0.5'}`}>
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 ml-2 text-sm">
        <HoverCard>
          <HoverCardTrigger asChild>
            <span className="text-purple-400 font-medium cursor-default hover:text-purple-300 transition-colors">
              {selectedWorkspace.name}
            </span>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-80">
            <div className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold">{selectedWorkspace.name}</h4>
                <p className="text-xs text-muted-foreground">Workspace</p>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-start gap-2">
                  <Folder className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <span className="text-muted-foreground break-all">{selectedWorkspace.path}</span>
                </div>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Default branch: <span className="text-foreground">{selectedWorkspace.defaultBranch}</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">{workspaceSessionCount} active session{workspaceSessionCount !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Added {new Date(selectedWorkspace.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
              <GitBranch className="h-3 w-3" />
              <span className="text-xs">{selectedSession.branch}</span>
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
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
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Cost */}
      <div className="text-xs text-muted-foreground font-mono px-2">
        {formatCost(totalCost)}
      </div>

      {/* Toggle Right Sidebar Button - only shown when sidebar is hidden */}
      {!showRightSidebar && onToggleRightSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 mr-1"
          onClick={onToggleRightSidebar}
          title="Show sidebar (⌘⌥B)"
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
