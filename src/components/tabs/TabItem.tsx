'use client';

import { memo, useState } from 'react';
import { X, Pin, PinOff, Pencil } from 'lucide-react';
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
  onCloseOthers,
  onCloseToRight,
  onRename,
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
            'group relative flex items-center gap-1.5 px-2 h-[33px] cursor-pointer select-none',
            'text-xs font-medium shrink-0',
            // Animation styles
            'transition-colors duration-150',
            isClosing && 'tab-closing',
            // Active state - VS Code style with top indicator
            isActive && [
              'bg-background text-foreground',
            ],
            // Inactive state
            !isActive && [
              'text-muted-foreground',
              'hover:text-foreground hover:bg-muted/50',
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
          {/* Top indicator line - VS Code style */}
          {isActive && (
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-primary" />
          )}

          {/* Pin indicator */}
          {tab.isPinned && (
            <Pin className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
          )}

          {/* Status indicator (for conversation tabs) or icon (for file tabs) */}
          {statusIndicator || tab.icon}

          {/* Tab label */}
          <span className="truncate flex-1">{tab.label}</span>

          {/* Dirty indicator (dot) - shown when dirty and not hovered */}
          {showDirtyDot && (
            <span
              className="w-2 h-2 rounded-full bg-primary shrink-0 transition-opacity"
              style={{ transitionDuration: `${ANIMATION_DURATION}ms` }}
            />
          )}

          {/* Close button */}
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Close ${tab.label}`}
            className={cn(
              'flex items-center justify-center w-4 h-4 rounded-sm shrink-0',
              'transition-all',
              'hover:bg-muted-foreground/20 hover:text-destructive',
              // Visibility based on state
              showCloseButton && !showDirtyDot
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            )}
            style={{ transitionDuration: `${ANIMATION_DURATION}ms` }}
            onClick={handleClose}
            onKeyDown={handleCloseKeyDown}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {/* Rename - only for conversations */}
        {tab.type === 'conversation' && onRename && (
          <>
            <ContextMenuItem onClick={onRename}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem onClick={() => onClose()}>
          <X className="mr-2 h-4 w-4" />
          Close
        </ContextMenuItem>

        {onCloseOthers && (
          <ContextMenuItem onClick={onCloseOthers}>
            Close Others
          </ContextMenuItem>
        )}

        {onCloseToRight && (
          <ContextMenuItem onClick={onCloseToRight}>
            Close to the Right
          </ContextMenuItem>
        )}

        {/* Pin/Unpin - only for file tabs */}
        {tab.type === 'file' && onPin && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onPin(!tab.isPinned)}>
              {tab.isPinned ? (
                <>
                  <PinOff className="mr-2 h-4 w-4" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="mr-2 h-4 w-4" />
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
