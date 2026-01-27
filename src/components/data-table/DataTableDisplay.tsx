'use client';

import { useState } from 'react';
import { SlidersHorizontal, Layers, ArrowUpDown, ArrowDownWideNarrow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

  // Set grouping
  const setGroupBy = (value: string) => {
    // Use '__none__' to explicitly mean "no grouping" (distinct from null which means "use default")
    onChange({ ...options, groupBy: value === 'none' ? '__none__' : value });
  };

  // Set sort column
  const setSortColumn = (column: string) => {
    if (column === 'none') {
      onChange({ ...options, sortBy: null });
    } else {
      onChange({
        ...options,
        sortBy: { column, direction: options.sortBy?.direction ?? 'desc' },
      });
    }
  };

  // Toggle sort direction
  const toggleSortDirection = () => {
    if (!options.sortBy) return;
    onChange({
      ...options,
      sortBy: {
        ...options.sortBy,
        direction: options.sortBy.direction === 'asc' ? 'desc' : 'asc',
      },
    });
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
        sideOffset={4}
        className="w-[340px] p-0 bg-[#141419] border-[#2a2a3c] rounded-lg shadow-xl"
      >
        {/* Grouping & Ordering section */}
        <div className="px-4 py-3 space-y-3">
          {/* Grouping */}
          {config.groupingOptions.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[13px] text-[#8b8b9e]">
                <Layers className="h-4 w-4" />
                <span>Grouping</span>
              </div>
              <Select
                value={options.groupBy === '__none__' ? 'none' : (options.groupBy ?? 'none')}
                onValueChange={setGroupBy}
              >
                <SelectTrigger className="w-[160px] h-8 text-[13px] bg-[#1e1e28] border-[#2a2a3c] rounded-md hover:bg-[#252530]">
                  <SelectValue placeholder="No grouping" />
                </SelectTrigger>
                <SelectContent className="bg-[#1e1e28] border-[#2a2a3c]">
                  <SelectItem value="none">No grouping</SelectItem>
                  {config.groupingOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Ordering */}
          {config.sortingOptions.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[13px] text-[#8b8b9e]">
                <ArrowUpDown className="h-4 w-4" />
                <span>Ordering</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  value={options.sortBy?.column ?? 'none'}
                  onValueChange={setSortColumn}
                >
                  <SelectTrigger className="w-[120px] h-8 text-[13px] bg-[#1e1e28] border-[#2a2a3c] rounded-md hover:bg-[#252530]">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1e1e28] border-[#2a2a3c]">
                    <SelectItem value="none">Default</SelectItem>
                    {config.sortingOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={toggleSortDirection}
                  disabled={!options.sortBy}
                  className={cn(
                    'flex items-center justify-center h-8 w-8 rounded-md border transition-colors',
                    options.sortBy
                      ? 'bg-[#1e1e28] border-[#2a2a3c] text-[#e0e0e8] hover:bg-[#252530]'
                      : 'bg-[#1e1e28]/50 border-[#2a2a3c]/50 text-[#8b8b9e]/50 cursor-not-allowed'
                  )}
                  title={options.sortBy?.direction === 'asc' ? 'Ascending' : 'Descending'}
                >
                  <ArrowDownWideNarrow
                    className={cn(
                      'h-4 w-4 transition-transform',
                      options.sortBy?.direction === 'asc' && 'rotate-180'
                    )}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="h-px bg-[#2a2a3c]" />

        {/* List options section */}
        <div className="px-4 py-3 space-y-3">
          <div className="text-[11px] font-medium text-[#6b6b7b] uppercase tracking-wide">
            List options
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[#e0e0e8]">Show empty groups</span>
            <Switch
              checked={options.showEmptyGroups}
              onCheckedChange={toggleShowEmptyGroups}
              disabled={options.groupBy === '__none__'}
              className="data-[state=checked]:bg-[#5e5ce6] data-[state=unchecked]:bg-[#2a2a3c]"
            />
          </div>
        </div>

        {/* Display properties (columns) */}
        {config.toggleableColumns.length > 0 && (
          <>
            {/* Separator */}
            <div className="h-px bg-[#2a2a3c]" />

            <div className="px-4 py-3 space-y-3">
              <div className="text-[11px] font-medium text-[#6b6b7b] uppercase tracking-wide">
                Display properties
              </div>
              <div className="flex flex-wrap gap-2">
                {config.toggleableColumns.map((col) => {
                  const isActive = options.visibleColumns.has(col.id);
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleColumn(col.id)}
                      className={cn(
                        'px-2.5 py-1 text-[13px] rounded-md border transition-all',
                        isActive
                          ? 'bg-[#252530] border-[#3a3a4c] text-[#e0e0e8]'
                          : 'bg-transparent border-[#2a2a3c] text-[#6b6b7b] hover:border-[#3a3a4c] hover:text-[#8b8b9e]'
                      )}
                    >
                      {col.label}
                    </button>
                  );
                })}
              </div>
            </div>
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
