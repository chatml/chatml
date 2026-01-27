'use client';

import { ChevronDown } from 'lucide-react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { DataTableGroupProps } from './types';

export function DataTableGroup({
  groupKey,
  label,
  count,
  isCollapsed,
  onToggle,
  colSpan,
  selectable,
  allSelected,
  someSelected,
  onSelectAll,
}: DataTableGroupProps) {
  return (
    <TableRow
      className="bg-surface-1 hover:bg-surface-2 border-y border-border/50 cursor-pointer select-none"
      onClick={onToggle}
    >
      <TableCell
        colSpan={colSpan}
        className="py-1.5 px-2"
      >
        <div className="flex items-center gap-2">
          {/* Checkbox for group selection */}
          {selectable && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onSelectAll?.();
              }}
              className="flex items-center"
            >
              <Checkbox
                checked={allSelected}
                className={cn(
                  'h-3.5 w-3.5',
                  someSelected && !allSelected && 'data-[state=checked]:bg-primary/50'
                )}
                aria-label={`Select all in ${label}`}
              />
            </div>
          )}

          {/* Expand/collapse icon */}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              isCollapsed && '-rotate-90'
            )}
          />

          {/* Group label */}
          <span className="text-sm font-medium text-foreground">
            {label}
            {groupKey !== label && (
              <span className="text-muted-foreground">/</span>
            )}
          </span>

          {/* Count badge */}
          <span className="text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// A simpler inline group header variant (not using table row)
export function DataTableGroupHeader({
  groupKey,
  label,
  count,
  isCollapsed,
  onToggle,
  selectable,
  allSelected,
  someSelected,
  onSelectAll,
}: Omit<DataTableGroupProps, 'colSpan'>) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-2 w-full px-2 py-1.5 text-left',
        'bg-surface-1 hover:bg-surface-2 transition-colors',
        'border-y border-border/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      )}
    >
      {/* Checkbox for group selection */}
      {selectable && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelectAll?.();
          }}
          className="flex items-center"
        >
          <Checkbox
            checked={allSelected}
            className={cn(
              'h-3.5 w-3.5',
              someSelected && !allSelected && 'opacity-50'
            )}
            aria-label={`Select all in ${label}`}
          />
        </div>
      )}

      {/* Expand/collapse icon */}
      <ChevronDown
        className={cn(
          'h-4 w-4 text-muted-foreground transition-transform duration-200',
          isCollapsed && '-rotate-90'
        )}
      />

      {/* Group label */}
      <span className="text-sm font-medium text-foreground">
        {label}
        {groupKey !== label && (
          <span className="text-muted-foreground">/</span>
        )}
      </span>

      {/* Count badge */}
      <span className="text-xs text-muted-foreground tabular-nums ml-auto">
        {count}
      </span>
    </button>
  );
}
