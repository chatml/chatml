'use client';

import { memo, useState } from 'react';
import { X, Pin, PinOff, Pencil, AlertCircle, ScrollText, Loader2, CheckCircle2 } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { TabItemProps } from './tab.types';
import { TAB_MIN_WIDTH, TAB_MAX_WIDTH, ANIMATION_DURATION } from './tab.types';

/**
 * Individual tab item with VS Code-style interactions
 *
 * Features:
 * - Close button always visible on active tab, hover-reveal for inactive
 * - Dirty indicator (dot) when file is modified
 * - Pin indicator for pinned tabs
 * - Smooth hover transitions
 * - Context menu for additional actions
 */
export const TabItem = memo(function TabItem({
  tab,
  isActive,
  isClosing,
  onSelect,
  onClose,
  onPin,
  onRename,
  onGenerateSummary,
  onViewSummary,
  summaryStatus,
  statusIndicator,
}: TabItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  const handleCloseKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  // Show close button: always on active, on hover for inactive, or when dirty
  const showCloseButton = isActive || isHovered || tab.isDirty;
  // Show dirty dot: when dirty AND not hovered (VS Code behavior)
  const showDirtyDot = tab.isDirty && !isHovered && !isActive;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          tabIndex={0}
          aria-selected={isActive}
          data-tab-id={tab.id}
          className={cn(
            // Base styles - full height, no vertical padding
            'group relative flex items-center gap-1.5 px-3 h-[33px] cursor-pointer select-none',
            'text-xs font-medium shrink-0',
            // Minimal transition - colors only, no layout shifts
            'transition-[background-color,color] duration-150',
            isClosing && 'tab-closing',
            // Active state - subtle highlight with muted top indicator
            isActive && [
              'bg-surface-2 text-foreground',
            ],
            // Inactive state
            !isActive && [
              'text-muted-foreground',
              'hover:text-foreground hover:bg-surface-1',
            ],
            // Session tab subtle distinction
            tab.group === 'session' && !isActive && 'opacity-90'
          )}
          style={{
            minWidth: TAB_MIN_WIDTH,
            maxWidth: TAB_MAX_WIDTH,
            transitionDuration: `${ANIMATION_DURATION}ms`,
          }}
          onClick={onSelect}
          onKeyDown={handleKeyDown}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Top indicator line - subtle */}
          {isActive && (
            <div className="absolute top-0 left-0 right-0 h-px bg-brand/50" />
          )}

          {/* Pin indicator */}
          {tab.isPinned && (
            <Pin className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
          )}

          {/* Save error indicator */}
          {tab.fileTab?.saveError && (
            <span title={`Save failed: ${tab.fileTab.saveError}`}>
              <AlertCircle
                className="w-3 h-3 text-destructive shrink-0"
                aria-label="Save failed"
              />
            </span>
          )}

          {/* Status indicator (for conversation tabs) or icon (for file tabs) */}
          {!tab.fileTab?.saveError && (statusIndicator || tab.icon)}

          {/* Tab label */}
          <span className="truncate flex-1">{tab.label}</span>

          {/* Fixed-size container for dot/close button - prevents layout shift */}
          <div className="w-4 h-4 flex items-center justify-center shrink-0">
            {showDirtyDot ? (
              <span className="w-2 h-2 rounded-full bg-brand" />
            ) : (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Close ${tab.label}`}
                className={cn(
                  'flex items-center justify-center w-4 h-4 rounded-sm',
                  'hover:bg-surface-2 hover:text-destructive',
                  showCloseButton ? 'opacity-100' : 'opacity-0 pointer-events-none'
                )}
                onClick={handleClose}
                onKeyDown={handleCloseKeyDown}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {/* Rename - only for conversations */}
        {tab.type === 'conversation' && onRename && (
          <>
            <ContextMenuItem onClick={onRename}>
              <Pencil className="size-4" />
              Rename
            </ContextMenuItem>
          </>
        )}

        {/* Summary actions - only for conversation tabs */}
        {tab.type === 'conversation' && (
          <>
            {summaryStatus === 'completed' && onViewSummary ? (
              <ContextMenuItem onClick={onViewSummary}>
                <CheckCircle2 className="size-4 text-green-500" />
                View Summary
              </ContextMenuItem>
            ) : summaryStatus === 'generating' ? (
              <ContextMenuItem disabled>
                <Loader2 className="size-4 animate-spin" />
                Generating Summary...
              </ContextMenuItem>
            ) : onGenerateSummary ? (
              <ContextMenuItem onClick={onGenerateSummary}>
                <ScrollText className="size-4" />
                Generate Summary
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem onClick={() => onClose()}>
          <X className="size-4" />
          Close
        </ContextMenuItem>

        {/* Pin/Unpin - only for file tabs */}
        {tab.type === 'file' && onPin && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onPin(!tab.isPinned)}>
              {tab.isPinned ? (
                <>
                  <PinOff className="size-4" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="size-4" />
                  Pin
                </>
              )}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
