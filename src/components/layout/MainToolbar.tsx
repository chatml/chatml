'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PanelLeft, PanelRight, PanelBottom, Plus } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore, type ToolbarSlots } from '@/stores/uiStore';
import { useTabStore } from '@/stores/tabStore';
import { BrowserTabStrip, createAndSwitchToNewTab } from '@/components/navigation/BrowserTabBar';
import { AppSettingsMenu } from '@/components/settings/AppSettingsMenu';

/** Renders the shared leading | title | spacer | actions slot layout */
function ToolbarRow({
  slots,
  trailing,
  className,
  tabStripOverride,
}: {
  slots: ToolbarSlots;
  trailing?: ReactNode;
  className?: string;
  /** When provided, replaces the title area with the tab strip */
  tabStripOverride?: ReactNode;
}) {
  const titlePosition = slots.titlePosition ?? 'left';

  return (
    <div data-tauri-drag-region className={cn('flex items-center relative', className)}>
      {/* Leading */}
      {slots.leading && (
        <div className="flex items-center shrink-0">
          {slots.leading}
        </div>
      )}

      {tabStripOverride ? (
        /* Multi-tab mode: tab strip replaces the title */
        tabStripOverride
      ) : (
        <>
          {/* Title — left-aligned */}
          {titlePosition === 'left' && slots.title && (
            <div className="flex items-center min-w-0 ml-2">
              {slots.title}
            </div>
          )}

          {/* Spacer (draggable) */}
          <div data-tauri-drag-region className="flex-1 h-full" />

          {/* Title — centered */}
          {titlePosition === 'center' && slots.title && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center pointer-events-none">
              <div className="pointer-events-auto">
                {slots.title}
              </div>
            </div>
          )}
        </>
      )}

      {/* Actions */}
      {slots.actions && (
        <div className="flex items-center gap-1">
          {slots.actions}
        </div>
      )}

      {/* Trailing — extra content after actions (e.g. panel toggles) */}
      {trailing}
    </div>
  );
}

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
  const toolbarConfig = useUIStore((s) => s.toolbarConfig);
  const setTabTitle = useUIStore((s) => s.setTabTitle);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabCount = useTabStore((s) => s.tabOrder.length);
  const hasMultipleTabs = tabCount > 1;

  // Cache the active tab's rich toolbar title whenever it changes
  const toolbarTitle = toolbarConfig?.title;
  useEffect(() => {
    if (toolbarTitle && activeTabId) {
      setTabTitle(activeTabId, toolbarTitle);
    }
  }, [toolbarTitle, activeTabId, setTabTitle]);

  return (
    <div className="shrink-0">
      {/* Main toolbar row */}
      <div
        data-tauri-drag-region
        className={cn(
          'h-11 pl-2 pr-3'
        )}
      >
        <ToolbarRow
          slots={toolbarConfig ?? {}}
          className="h-full"
          tabStripOverride={hasMultipleTabs ? <BrowserTabStrip /> : undefined}
          trailing={
            <>
              {/* Spacer before panel toggles */}
              <div className="mx-1.5" />

              {/* New Tab + Toggle Sidebar */}
              <div className="flex items-center gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={createAndSwitchToNewTab}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    New Tab <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">⌘ T</span>
                  </TooltipContent>
                </Tooltip>

                {/* Spacer */}
                <div className="mx-1" />

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

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'h-6 w-6',
                        hasSecondaryPanels && showBottomPanel && 'bg-surface-2',
                        !hasSecondaryPanels && 'opacity-30 pointer-events-none',
                      )}
                      disabled={!hasSecondaryPanels}
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
                      className={cn(
                        'h-6 w-6',
                        hasSecondaryPanels && showRightSidebar && 'bg-surface-2',
                        !hasSecondaryPanels && 'opacity-30 pointer-events-none',
                      )}
                      disabled={!hasSecondaryPanels}
                      onClick={onToggleRightSidebar}
                    >
                      <PanelRight className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Toggle Sidebar <span className="ml-2 px-1.5 py-0.5 bg-background/20 rounded text-[13px]">⌘⌥ B</span>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Spacer between toggles and settings */}
              <div className="mx-1.5" />

              {/* Settings Menu */}
              <AppSettingsMenu
                onOpenSettings={onOpenSettings}
                onOpenShortcuts={onOpenShortcuts}
              />
            </>
          }
        />
      </div>

    </div>
  );
}

/** Context-aware action bar rendered at the top of the main content area */
export function ContentActionBar() {
  const bottom = useUIStore((s) => s.toolbarConfig?.bottom);
  if (!bottom) return null;

  return (
    <div className="shrink-0 bg-content-background border-b px-3 py-1.5">
      <ToolbarRow slots={bottom} />
    </div>
  );
}
