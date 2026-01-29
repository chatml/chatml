'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';

export function SidebarToolbar() {
  const leftToolbarBg = useUIStore((state) => state.toolbarBackgrounds.left);

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
        {/* Navigation Arrows */}
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        {/* History */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <History className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">History</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
