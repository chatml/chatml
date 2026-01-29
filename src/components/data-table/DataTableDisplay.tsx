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
    // 'default' = null (use prop-based grouping)
    // 'none' = '__none__' (no grouping)
    // other = use that field as grouping key
    if (value === 'default') {
      onChange({ ...options, groupBy: null });
    } else if (value === 'none') {
      onChange({ ...options, groupBy: '__none__' });
    } else {
      onChange({ ...options, groupBy: value });
    }
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

  // Toggle custom list option
  const toggleCustomOption = (id: string) => {
    onChange({
      ...options,
      customToggles: {
        ...options.customToggles,
        [id]: !options.customToggles[id],
      },
    });
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
        className="w-[340px] p-0"
      >
        {/* Grouping & Ordering section */}
        <div className="px-4 py-3 space-y-3">
          {/* Grouping */}
          {config.groupingOptions.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                <Layers className="h-4 w-4" />
                <span>Grouping</span>
              </div>
              <Select
                value={options.groupBy === '__none__' ? 'none' : (options.groupBy ?? 'default')}
                onValueChange={setGroupBy}
              >
                <SelectTrigger className="w-[160px] h-8 text-[13px] bg-surface-2 border-border/50 rounded-md hover:bg-surface-2/80">
                  <SelectValue placeholder="No grouping" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
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
              <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                <ArrowUpDown className="h-4 w-4" />
                <span>Ordering</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Select
                  value={options.sortBy?.column ?? 'none'}
                  onValueChange={setSortColumn}
                >
                  <SelectTrigger className="w-[120px] h-8 text-[13px] bg-surface-2 border-border/50 rounded-md hover:bg-surface-2/80">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
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
                      ? 'bg-surface-2 border-border/50 text-foreground hover:bg-surface-2/80'
                      : 'bg-surface-2/50 border-border/30 text-muted-foreground/50 cursor-not-allowed'
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
        <div className="h-px bg-border/50" />

        {/* List options section */}
        <div className="px-4 py-3 space-y-3">
          <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
            List options
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-foreground">Show separators</span>
            <Switch
              checked={options.showSeparators}
              onCheckedChange={() => onChange({ ...options, showSeparators: !options.showSeparators })}
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-foreground">Show empty groups</span>
            <Switch
              checked={options.showEmptyGroups}
              onCheckedChange={toggleShowEmptyGroups}
              disabled={options.groupBy === '__none__'}
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2"
            />
          </div>
          {config.listOptions?.map((opt) => (
            <div key={opt.id} className="flex items-center justify-between">
              <span className="text-[13px] text-foreground">{opt.label}</span>
              <Switch
                checked={options.customToggles[opt.id] ?? opt.defaultValue}
                onCheckedChange={() => toggleCustomOption(opt.id)}
                className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2"
              />
            </div>
          ))}
        </div>

        {/* Display properties (columns) */}
        {config.toggleableColumns.length > 0 && (
          <>
            {/* Separator */}
            <div className="h-px bg-border/50" />

            <div className="px-4 py-3 space-y-3">
              <div className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wide">
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
                          ? 'bg-surface-2 border-border/70 text-foreground'
                          : 'bg-transparent border-border/50 text-muted-foreground hover:border-border/70 hover:text-foreground/80'
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
