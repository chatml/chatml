'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PanelLeft, PanelRight, PanelBottom } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppSettingsMenu } from '@/components/settings/AppSettingsMenu';

interface MainToolbarProps {
  showLeftSidebar?: boolean;
  showRightSidebar?: boolean;
  showBottomPanel?: boolean;
  hasSecondaryPanels?: boolean;
  onToggleLeftSidebar?: () => void;
  onToggleRightSidebar?: () => void;
  onToggleBottomPanel?: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
}

export function MainToolbar({
  showLeftSidebar = true,
  showRightSidebar = true,
  showBottomPanel = false,
  hasSecondaryPanels = true,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onToggleBottomPanel,
  onOpenSettings,
  onOpenShortcuts,
}: MainToolbarProps) {
  return (
    <div
      data-tauri-drag-region
      className={cn(
        'h-11 flex items-center border-b shrink-0 pl-2 pr-3',
        !showLeftSidebar && 'pl-20'
      )}
    >
      {/* Spacer */}
      <div className="flex-1" />

      {/* Panel Toggle Buttons */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-6 w-6', showLeftSidebar && 'bg-surface-2')}
              onClick={onToggleLeftSidebar}
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Toggle Sidebar <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">⌘ B</span>
          </TooltipContent>
        </Tooltip>

        {hasSecondaryPanels && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-6 w-6', showBottomPanel && 'bg-surface-2')}
                  onClick={onToggleBottomPanel}
                >
                  <PanelBottom className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Toggle Terminal <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">⌘ J</span>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-6 w-6', showRightSidebar && 'bg-surface-2')}
                  onClick={onToggleRightSidebar}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Toggle Sidebar <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">⌘⌥ B</span>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>

      {/* Spacer between toggles and settings */}
      <div className="w-px h-4 bg-border mx-1.5" />

      {/* Settings Menu */}
      <AppSettingsMenu
        onOpenSettings={onOpenSettings}
        onOpenShortcuts={onOpenShortcuts}
      />
    </div>
  );
}
