'use client';

import { ChevronRight } from 'lucide-react';
import { TableRow, TableCell } from '@/components/ui/table';
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
  groupKey: _groupKey,
  label,
  count,
  isCollapsed,
  onToggle,
  onCollapseAll,
  colSpan,
  selectable,
  onSelectAll,
}: DataTableGroupProps) {
  const rowContent = (
    <TableRow
      className="bg-surface-1 hover:bg-surface-2 border-y border-border/30 cursor-pointer select-none"
      onClick={onToggle}
    >
      <TableCell
        colSpan={colSpan}
        className="py-2 px-2"
      >
        <div className="flex items-center gap-1.5">
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
        </div>
      </TableCell>
    </TableRow>
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

// A simpler inline group header variant (not using table row)
export function DataTableGroupHeader({
  groupKey: _groupKey,
  label,
  count,
  isCollapsed,
  onToggle,
}: Omit<DataTableGroupProps, 'colSpan' | 'selectable' | 'allSelected' | 'someSelected' | 'onSelectAll' | 'onCollapseAll'>) {
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
