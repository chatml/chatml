'use client';

import { useWorkspaceSelection } from '@/stores/selectors';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
import { AppSettingsMenu } from '@/components/AppSettingsMenu';

interface TopBarProps {
  showLeftSidebar?: boolean;
  showRightSidebar?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  onOpenWorkspaces?: () => void;
}

export function TopBar({
  showLeftSidebar = true,
  showRightSidebar = true,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onOpenSettings,
  onOpenShortcuts,
  onOpenWorkspaces,
}: TopBarProps) {
  // Use optimized selectors to prevent unnecessary re-renders
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();
  const centerToolbarBg = useUIStore((state) => state.toolbarBackgrounds.center);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const workspaceSessionCount = sessions.filter((s) => s.workspaceId === selectedWorkspaceId && !s.archived).length;

  if (!selectedWorkspace || !selectedSession) {
    return (
      <div data-tauri-drag-region className={cn("h-10 flex items-center border-b shrink-0", centerToolbarBg, !showLeftSidebar && 'pl-20')}>
        {/* Toggle Left Sidebar Button - only shown when sidebar is hidden */}
        {!showLeftSidebar && onToggleLeftSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-1"
            onClick={onToggleLeftSidebar}
            title="Show sidebar (⌘B)"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </Button>
        )}
        {/* Navigation buttons - tight together */}
        <div className={`flex items-center ${!showLeftSidebar ? 'ml-1' : 'ml-0.5'}`}>
          <Button variant="ghost" size="icon" className="h-6 w-6 p-0" disabled>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 p-0" disabled>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <span className="text-[12px] text-muted-foreground ml-2">
          Select a session to get started
        </span>
      </div>
    );
  }

  return (
    <div data-tauri-drag-region className={cn("h-10 flex items-center border-b shrink-0", centerToolbarBg, !showLeftSidebar && 'pl-20')}>
      {/* Toggle Left Sidebar Button - only shown when sidebar is hidden */}
      {!showLeftSidebar && onToggleLeftSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 ml-1"
          onClick={onToggleLeftSidebar}
          title="Show sidebar (⌘B)"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* Navigation buttons - tight together, close to divider */}
      <div className={`flex items-center ${!showLeftSidebar ? 'ml-1' : 'ml-0.5'}`}>
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 ml-2 text-[12px]">
        <HoverCard>
          <HoverCardTrigger asChild>
            <span className="text-primary font-medium cursor-default hover:text-primary/80 transition-colors">
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
              <Code className="size-4" />
              VS Code
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FolderOpen className="size-4" />
              Finder
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Terminal className="size-4" />
              Terminal
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <ExternalLink className="size-4" />
              GitHub
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Session Status */}
      <div className="text-[11px] text-muted-foreground px-2">
        {selectedSession?.status === 'active' ? 'Working...' :
         selectedSession?.status === 'done' ? 'Completed' :
         selectedSession?.status === 'error' ? 'Error' : 'Ready'}
      </div>

      {/* Toggle Right Sidebar Button - only shown when sidebar is hidden */}
      {!showRightSidebar && onToggleRightSidebar && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onToggleRightSidebar}
          title="Show sidebar (⌘⌥B)"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      )}

      {/* App Settings Menu - shown when right sidebar is hidden */}
      {!showRightSidebar && onOpenSettings && onOpenShortcuts && onOpenWorkspaces && (
        <AppSettingsMenu
          onOpenSettings={onOpenSettings}
          onOpenShortcuts={onOpenShortcuts}
          onOpenWorkspaces={onOpenWorkspaces}
          className="mr-1"
        />
      )}
    </div>
  );
}
