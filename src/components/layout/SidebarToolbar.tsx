'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { goBack, goForward } from '@/lib/navigation';
import { useShortcut } from '@/hooks/useShortcut';
import { NavigationHistoryPopover } from '@/components/navigation/NavigationHistoryPopover';

export function SidebarToolbar() {
  const leftToolbarBg = useUIStore((state) => state.toolbarBackgrounds.left);
  const canGoBack = useNavigationStore(
    (s) => (s.tabs[s.activeTabId]?.backStack.length ?? 0) > 0
  );
  const canGoForward = useNavigationStore(
    (s) => (s.tabs[s.activeTabId]?.forwardStack.length ?? 0) > 0
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleBack = useCallback(() => goBack(), []);
  const handleForward = useCallback(() => goForward(), []);

  useShortcut('navigateBack', handleBack);
  useShortcut('navigateForward', handleForward);

  return (
    <div
      data-tauri-drag-region
      className={cn(
        'h-11 pl-20 pr-2 flex items-center justify-between shrink-0',
        leftToolbarBg
      )}
    >
      <span
        className="text-[20px] font-extrabold select-none truncate min-w-0"
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        }}
      >
        <span className="text-muted-foreground">chat</span>
        <span className="text-purple-600">ml</span>
      </span>
      <div className="flex items-center gap-0.5 shrink-0">
        {/* Navigation Back */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0"
              disabled={!canGoBack}
              onClick={handleBack}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back (⌘[)</TooltipContent>
        </Tooltip>
        {/* Navigation Forward */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 p-0"
              disabled={!canGoForward}
              onClick={handleForward}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Forward (⌘])</TooltipContent>
        </Tooltip>
        {/* History */}
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <History className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">History</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-72 p-0">
            <NavigationHistoryPopover onClose={() => setHistoryOpen(false)} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
