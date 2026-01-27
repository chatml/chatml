'use client';

import { useState } from 'react';
import {
  SlidersHorizontal,
  Layers,
  ArrowUpDown,
  ArrowDownWideNarrow,
  Check,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
    onChange({ ...options, groupBy: value === 'none' ? '__none__' : value });
  };

  // Set sort column
  const setSortBy = (column: string, direction?: 'asc' | 'desc') => {
    if (column === 'none') {
      onChange({ ...options, sortBy: null });
    } else {
      onChange({
        ...options,
        sortBy: { column, direction: direction ?? options.sortBy?.direction ?? 'desc' },
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

  // Get current grouping label
  const currentGroupLabel = options.groupBy === '__none__' || !options.groupBy
    ? null
    : config.groupingOptions.find(o => o.value === options.groupBy)?.label;

  // Get current sort label
  const currentSortLabel = options.sortBy
    ? config.sortingOptions.find(o => o.value === options.sortBy?.column)?.label
    : null;

  // Count active display customizations
  const customizationCount = [
    options.groupBy && options.groupBy !== '__none__',
    options.sortBy,
  ].filter(Boolean).length;

  return (
    <DropdownMenu open={controlledOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 gap-1.5',
            customizationCount > 0 && 'text-primary'
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Display
          {customizationCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
              {customizationCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px] p-1">
        {/* Grouping submenu */}
        {config.groupingOptions.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={cn(
                'px-3 py-2 text-[13px]',
                currentGroupLabel && 'text-primary'
              )}
            >
              <span className="text-muted-foreground">
                <Layers className="h-4 w-4" />
              </span>
              <span className="flex-1">Grouping</span>
              {currentGroupLabel && (
                <span className="text-[11px] text-primary mr-1">
                  {currentGroupLabel}
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={-4} className="w-[180px] p-1">
              <DropdownMenuItem
                className="px-3 py-2 text-[13px]"
                onSelect={(e) => {
                  e.preventDefault();
                  setGroupBy('none');
                }}
              >
                <div
                  className={cn(
                    'h-4 w-4 rounded border flex items-center justify-center',
                    (!options.groupBy || options.groupBy === '__none__')
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}
                >
                  {(!options.groupBy || options.groupBy === '__none__') && (
                    <Check className="h-3 w-3 text-primary-foreground" />
                  )}
                </div>
                <span>No grouping</span>
              </DropdownMenuItem>
              {config.groupingOptions.map((opt) => {
                const isSelected = options.groupBy === opt.value;
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    className="px-3 py-2 text-[13px]"
                    onSelect={(e) => {
                      e.preventDefault();
                      setGroupBy(opt.value);
                    }}
                  >
                    <div
                      className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center',
                        isSelected
                          ? 'bg-primary border-primary'
                          : 'border-border'
                      )}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <span>{opt.label}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Ordering submenu */}
        {config.sortingOptions.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={cn(
                'px-3 py-2 text-[13px]',
                currentSortLabel && 'text-primary'
              )}
            >
              <span className="text-muted-foreground">
                <ArrowUpDown className="h-4 w-4" />
              </span>
              <span className="flex-1">Ordering</span>
              {currentSortLabel && (
                <span className="text-[11px] text-primary mr-1 flex items-center gap-1">
                  {currentSortLabel}
                  <ArrowDownWideNarrow
                    className={cn(
                      'h-3 w-3',
                      options.sortBy?.direction === 'asc' && 'rotate-180'
                    )}
                  />
                </span>
              )}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={-4} className="w-[180px] p-1">
              <DropdownMenuItem
                className="px-3 py-2 text-[13px]"
                onSelect={(e) => {
                  e.preventDefault();
                  setSortBy('none');
                }}
              >
                <div
                  className={cn(
                    'h-4 w-4 rounded border flex items-center justify-center',
                    !options.sortBy
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}
                >
                  {!options.sortBy && (
                    <Check className="h-3 w-3 text-primary-foreground" />
                  )}
                </div>
                <span>Default</span>
              </DropdownMenuItem>
              {config.sortingOptions.map((opt) => {
                const isSelected = options.sortBy?.column === opt.value;
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    className="px-3 py-2 text-[13px]"
                    onSelect={(e) => {
                      e.preventDefault();
                      if (isSelected) {
                        // Toggle direction if already selected
                        setSortBy(opt.value, options.sortBy?.direction === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortBy(opt.value, 'desc');
                      }
                    }}
                  >
                    <div
                      className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center',
                        isSelected
                          ? 'bg-primary border-primary'
                          : 'border-border'
                      )}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </div>
                    <span className="flex-1">{opt.label}</span>
                    {isSelected && (
                      <ArrowDownWideNarrow
                        className={cn(
                          'h-3.5 w-3.5 text-muted-foreground',
                          options.sortBy?.direction === 'asc' && 'rotate-180'
                        )}
                      />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Columns submenu */}
        {config.toggleableColumns.length > 0 && (
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="px-3 py-2 text-[13px]">
                <span className="text-muted-foreground">
                  <Eye className="h-4 w-4" />
                </span>
                <span className="flex-1">Columns</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent sideOffset={-4} className="w-[180px] p-1">
                {config.toggleableColumns.map((col) => {
                  const isVisible = options.visibleColumns.has(col.id);
                  return (
                    <DropdownMenuItem
                      key={col.id}
                      className="px-3 py-2 text-[13px]"
                      onSelect={(e) => {
                        e.preventDefault();
                        toggleColumn(col.id);
                      }}
                    >
                      <div
                        className={cn(
                          'h-4 w-4 rounded border flex items-center justify-center',
                          isVisible
                            ? 'bg-primary border-primary'
                            : 'border-border'
                        )}
                      >
                        {isVisible && (
                          <Check className="h-3 w-3 text-primary-foreground" />
                        )}
                      </div>
                      <span>{col.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {/* Reset option */}
        {customizationCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="px-3 py-2 text-[13px] text-muted-foreground"
              onSelect={() => {
                onChange({
                  ...options,
                  groupBy: '__none__',
                  sortBy: null,
                });
              }}
            >
              Reset display options
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
