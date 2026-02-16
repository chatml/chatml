'use client';

import { ChevronRight } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { DataTableGroupProps } from './types';

export function DataTableGroup({
  label,
  icon,
  count,
  isCollapsed,
  onToggle,
  onCollapseAll,
  gridTemplateColumns,
  selectable,
  onSelectAll,
}: DataTableGroupProps) {
  const rowContent = (
    <div
      role="row"
      className="grid bg-surface-1 hover:bg-surface-2 border-y border-border/30 cursor-pointer select-none"
      style={{ gridTemplateColumns }}
      onClick={onToggle}
    >
      <div
        role="gridcell"
        className="py-2 px-2"
        style={{ gridColumn: '1 / -1' }}
      >
        <div className="flex items-center gap-1.5">
          {/* Expand/collapse icon */}
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-150',
              !isCollapsed && 'rotate-90'
            )}
          />

          {/* Group icon (optional) */}
          {icon}

          {/* Group label */}
          <span className="text-sm font-medium text-foreground">
            {label}
          </span>

          {/* Count */}
          <span className="text-sm font-medium text-foreground/50 tabular-nums">
            {count}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onToggle}>
          {isCollapsed ? 'Expand' : 'Collapse'}
        </ContextMenuItem>
        {onCollapseAll && (
          <ContextMenuItem onClick={onCollapseAll}>
            Collapse all
          </ContextMenuItem>
        )}
        {selectable && onSelectAll && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onSelectAll}>
              Select all in group
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// A simpler inline group header variant (not using grid row)
export function DataTableGroupHeader({
  label,
  count,
  isCollapsed,
  onToggle,
}: Omit<DataTableGroupProps, 'gridTemplateColumns' | 'selectable' | 'allSelected' | 'someSelected' | 'onSelectAll' | 'onCollapseAll'>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1.5 w-full px-2 py-2 text-left',
        'bg-surface-1 hover:bg-surface-2 border-y border-border/30 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      {/* Expand/collapse icon */}
      <ChevronRight
        className={cn(
          'h-3.5 w-3.5 text-muted-foreground transition-transform duration-150',
          !isCollapsed && 'rotate-90'
        )}
      />

      {/* Group label */}
      <span className="text-sm font-medium text-foreground">
        {label}
      </span>

      {/* Count */}
      <span className="text-sm font-medium text-foreground/50 tabular-nums">
        {count}
      </span>
    </button>
  );
}
