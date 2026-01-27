'use client';

import { forwardRef, useCallback } from 'react';
import { TableRow, TableCell } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import type { DataTableRowProps, Column } from './types';

// Helper to get cell value
function getCellValue<T>(row: T, column: Column<T>): unknown {
  if (column.cell) {
    return column.cell(row);
  }
  if (column.accessorKey) {
    if (typeof column.accessorKey === 'function') {
      return column.accessorKey(row);
    }
    return row[column.accessorKey];
  }
  return null;
}

// Helper to render cell alignment
function getCellAlignment(align: Column<unknown>['align']): string {
  switch (align) {
    case 'center':
      return 'text-center';
    case 'right':
      return 'text-right';
    default:
      return 'text-left';
  }
}

interface DataTableRowComponentProps<T> extends Omit<DataTableRowProps<T>, 'index'> {
  /** Visible columns */
  visibleColumns?: Set<string>;
}

function DataTableRowComponent<T>(
  {
    row,
    rowId,
    columns,
    isSelected,
    isFocused,
    onToggleSelect,
    onClick,
    onDoubleClick,
    contextMenuItems,
    selectable,
    visibleColumns,
  }: DataTableRowComponentProps<T>,
  ref: React.ForwardedRef<HTMLTableRowElement>
) {
  // Filter visible columns
  const displayColumns = visibleColumns
    ? columns.filter((col) => visibleColumns.has(col.id) || !col.hidden)
    : columns.filter((col) => !col.hidden);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Check for meta/ctrl click for selection
      if (e.metaKey || e.ctrlKey) {
        onToggleSelect();
        return;
      }
      onClick?.();
    },
    [onClick, onToggleSelect]
  );

  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.();
  }, [onDoubleClick]);

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect();
    },
    [onToggleSelect]
  );

  const rowContent = (
    <TableRow
      ref={ref}
      data-state={isSelected ? 'selected' : undefined}
      data-focused={isFocused || undefined}
      className={cn(
        'cursor-pointer transition-colors border-b border-border/20',
        'hover:bg-white/[0.02]',
        isSelected && 'bg-primary/5 hover:bg-primary/8',
        isFocused && 'bg-white/[0.02]'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      tabIndex={isFocused ? 0 : -1}
    >
      {/* Selection checkbox column */}
      {selectable && (
        <TableCell
          className="w-[40px] px-2 py-1.5"
          onClick={handleCheckboxClick}
        >
          <Checkbox
            checked={isSelected}
            className="h-3.5 w-3.5"
            aria-label={`Select row ${rowId}`}
          />
        </TableCell>
      )}

      {/* Data columns */}
      {displayColumns.map((column) => (
        <TableCell
          key={column.id}
          className={cn(
            'py-1.5 px-2',
            getCellAlignment(column.align),
            column.width && `w-[${column.width}]`
          )}
          style={{
            width: column.width,
            minWidth: column.minWidth,
          }}
        >
          {getCellValue(row, column) as React.ReactNode}
        </TableCell>
      ))}
    </TableRow>
  );

  // Wrap in context menu if items are provided
  if (contextMenuItems && contextMenuItems.length > 0) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent>
          {contextMenuItems.map((item, idx) =>
            item.separator ? (
              <ContextMenuSeparator key={`sep-${idx}`} />
            ) : (
              <ContextMenuItem
                key={item.label}
                onClick={item.onClick}
                disabled={item.disabled}
                variant={item.variant}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.shortcut && (
                  <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
                )}
              </ContextMenuItem>
            )
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return rowContent;
}

// Type-safe forwardRef wrapper
export const DataTableRow = forwardRef(DataTableRowComponent) as <T>(
  props: DataTableRowComponentProps<T> & { ref?: React.ForwardedRef<HTMLTableRowElement> }
) => React.ReactElement;

// Simple row renderer without context menu (for performance)
export function DataTableSimpleRow<T>({
  row,
  rowId,
  columns,
  isSelected,
  isFocused,
  onToggleSelect,
  onClick,
  selectable,
  visibleColumns,
}: Omit<DataTableRowComponentProps<T>, 'contextMenuItems' | 'onDoubleClick' | 'index'>) {
  const displayColumns = visibleColumns
    ? columns.filter((col) => visibleColumns.has(col.id) || !col.hidden)
    : columns.filter((col) => !col.hidden);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        onToggleSelect();
        return;
      }
      onClick?.();
    },
    [onClick, onToggleSelect]
  );

  return (
    <TableRow
      data-state={isSelected ? 'selected' : undefined}
      data-focused={isFocused || undefined}
      className={cn(
        'cursor-pointer transition-colors border-b border-border/20',
        'hover:bg-white/[0.02]',
        isSelected && 'bg-primary/5 hover:bg-primary/8',
        isFocused && 'bg-white/[0.02]'
      )}
      onClick={handleClick}
      tabIndex={isFocused ? 0 : -1}
    >
      {selectable && (
        <TableCell
          className="w-[40px] px-2 py-1.5"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
        >
          <Checkbox
            checked={isSelected}
            className="h-3.5 w-3.5"
            aria-label={`Select row ${rowId}`}
          />
        </TableCell>
      )}
      {displayColumns.map((column) => (
        <TableCell
          key={column.id}
          className={cn('py-1.5 px-2', getCellAlignment(column.align))}
          style={{
            width: column.width,
            minWidth: column.minWidth,
          }}
        >
          {getCellValue(row, column) as React.ReactNode}
        </TableCell>
      ))}
    </TableRow>
  );
}
