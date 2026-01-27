'use client';

import { useState } from 'react';
import { SlidersHorizontal, ArrowUpDown, Layers, Eye, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { DisplayOptions, DisplayOptionsConfig } from './types';

interface DataTableDisplayProps {
  /** Display options configuration */
  config: DisplayOptionsConfig;
  /** Current display options */
  options: DisplayOptions;
  /** Change handler */
  onChange: (options: DisplayOptions) => void;
  /** Whether the menu is open */
  open?: boolean;
  /** Open change handler */
  onOpenChange?: (open: boolean) => void;
}

export function DataTableDisplay({
  config,
  options,
  onChange,
  open,
  onOpenChange,
}: DataTableDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const controlledOpen = open ?? isOpen;
  const setOpen = onOpenChange ?? setIsOpen;

  // Toggle grouping
  const setGroupBy = (value: string | null) => {
    onChange({ ...options, groupBy: value });
  };

  // Toggle sorting
  const setSortBy = (column: string) => {
    if (options.sortBy?.column === column) {
      // Toggle direction or remove sort
      if (options.sortBy.direction === 'asc') {
        onChange({
          ...options,
          sortBy: { column, direction: 'desc' },
        });
      } else {
        onChange({ ...options, sortBy: null });
      }
    } else {
      onChange({
        ...options,
        sortBy: { column, direction: 'asc' },
      });
    }
  };

  // Toggle column visibility
  const toggleColumn = (columnId: string) => {
    const newVisibleColumns = new Set(options.visibleColumns);
    if (newVisibleColumns.has(columnId)) {
      newVisibleColumns.delete(columnId);
    } else {
      newVisibleColumns.add(columnId);
    }
    onChange({ ...options, visibleColumns: newVisibleColumns });
  };

  // Toggle show empty groups
  const toggleShowEmptyGroups = () => {
    onChange({ ...options, showEmptyGroups: !options.showEmptyGroups });
  };

  // Get sort direction indicator
  const getSortIndicator = (column: string) => {
    if (options.sortBy?.column !== column) return null;
    return options.sortBy.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <Popover open={controlledOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Display
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[240px] p-3"
      >
        {/* Grouping */}
        {config.groupingOptions.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium">
              <Layers className="h-3 w-3" />
              Group by
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setGroupBy(null)}
                className={cn(
                  'flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md',
                  'hover:bg-surface-1 transition-colors',
                  options.groupBy === null && 'bg-surface-1'
                )}
              >
                None
                {options.groupBy === null && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
              {config.groupingOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGroupBy(opt.value)}
                  className={cn(
                    'flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md',
                    'hover:bg-surface-1 transition-colors',
                    options.groupBy === opt.value && 'bg-surface-1'
                  )}
                >
                  {opt.label}
                  {options.groupBy === opt.value && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))}
            </div>
            <Separator className="my-3" />
          </>
        )}

        {/* Sorting */}
        {config.sortingOptions.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium">
              <ArrowUpDown className="h-3 w-3" />
              Sort by
            </div>
            <div className="space-y-1">
              {config.sortingOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSortBy(opt.value)}
                  className={cn(
                    'flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md',
                    'hover:bg-surface-1 transition-colors',
                    options.sortBy?.column === opt.value && 'bg-surface-1'
                  )}
                >
                  {opt.label}
                  {options.sortBy?.column === opt.value && (
                    <span className="text-xs text-primary font-medium">
                      {getSortIndicator(opt.value)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Separator className="my-3" />
          </>
        )}

        {/* Column visibility */}
        {config.toggleableColumns.length > 0 && (
          <>
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground font-medium">
              <Eye className="h-3 w-3" />
              Columns
            </div>
            <div className="space-y-1">
              {config.toggleableColumns.map((col) => (
                <label
                  key={col.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer',
                    'hover:bg-surface-1 transition-colors'
                  )}
                >
                  <Checkbox
                    checked={options.visibleColumns.has(col.id)}
                    onCheckedChange={() => toggleColumn(col.id)}
                    className="h-3.5 w-3.5"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </>
        )}

        {/* Show empty groups option (only when grouping is active) */}
        {options.groupBy && (
          <>
            <Separator className="my-3" />
            <label
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer',
                'hover:bg-surface-1 transition-colors'
              )}
            >
              <Checkbox
                checked={options.showEmptyGroups}
                onCheckedChange={toggleShowEmptyGroups}
                className="h-3.5 w-3.5"
              />
              Show empty groups
            </label>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Simple display button that opens full options
export function DataTableDisplayButton({
  onClick,
  hasCustomizations,
}: {
  onClick: () => void;
  hasCustomizations?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('h-8 gap-1.5', hasCustomizations && 'text-primary')}
      onClick={onClick}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      Display
    </Button>
  );
}
