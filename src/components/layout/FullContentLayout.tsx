'use client';

import { ReactNode } from 'react';
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
  Settings,
  Keyboard,
  MoreVertical,
  BookOpen,
  MessageCircle,
  ExternalLink,
} from 'lucide-react';

interface FullContentLayoutProps {
  title: ReactNode;
  children: ReactNode;
  headerActions?: ReactNode;
  onOpenSettings?: () => void;
  onOpenShortcuts?: () => void;
  showLeftSidebar?: boolean;
  onToggleLeftSidebar?: () => void;
}

export function FullContentLayout({
  title,
  children,
  headerActions,
  onOpenSettings,
  onOpenShortcuts,
  showLeftSidebar = true,
}: FullContentLayoutProps) {
  const centerToolbarBg = useUIStore((state) => state.toolbarBackgrounds.center);

  return (
    <div className="flex flex-col h-full bg-content-background">
      {/* Header */}
      <div
        data-tauri-drag-region
        className={cn(
          'h-10 flex items-center border-b shrink-0 pr-1',
          centerToolbarBg,
          !showLeftSidebar && 'pl-20'
        )}
      >
        {/* Title */}
        <h1 className="text-base font-semibold ml-3">{title}</h1>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View-specific header actions */}
        {headerActions && (
          <div className="flex items-center gap-1 mr-2">{headerActions}</div>
        )}

        {/* Common actions */}
        <div className="flex items-center gap-0.5">
          {/* More Menu with Settings, Shortcuts, etc. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="More options"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenSettings}>
                <Settings className="size-4" />
                Settings
                <span className="ml-auto text-xs text-muted-foreground">⌘,</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenShortcuts}>
                <Keyboard className="size-4" />
                Keyboard Shortcuts
                <span className="ml-auto text-xs text-muted-foreground">⌘/</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.open('https://docs.chatml.dev', '_blank')}>
                <BookOpen className="size-4" />
                Documentation
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.open('https://github.com/chatml/chatml/issues', '_blank')}>
                <MessageCircle className="size-4" />
                Send Feedback
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
