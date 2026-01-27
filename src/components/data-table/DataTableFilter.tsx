'use client';

import { useState, useCallback } from 'react';
import { Filter, Plus, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { FilterCondition, FilterOption } from './types';

interface DataTableFilterProps {
  /** Current filter conditions */
  filters: FilterCondition[];
  /** Filter change handler */
  onFilterChange: (filters: FilterCondition[]) => void;
  /** Available filter options */
  filterOptions: FilterOption[];
  /** Whether the filter menu is open */
  open?: boolean;
  /** Open change handler */
  onOpenChange?: (open: boolean) => void;
}

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'equals' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'isEmpty', label: 'is empty' },
  { value: 'isNotEmpty', label: 'is not empty' },
] as const;

export function DataTableFilter({
  filters,
  onFilterChange,
  filterOptions,
  open,
  onOpenChange,
}: DataTableFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const controlledOpen = open ?? isOpen;
  const setOpen = onOpenChange ?? setIsOpen;

  // Add a new filter condition
  const addFilter = useCallback(
    (column: string) => {
      const option = filterOptions.find((o) => o.column === column);
      if (!option) return;

      const newFilter: FilterCondition = {
        column,
        operator: 'contains',
        value: '',
      };

      onFilterChange([...filters, newFilter]);
    },
    [filters, filterOptions, onFilterChange]
  );

  // Update a filter condition
  const updateFilter = useCallback(
    (index: number, updates: Partial<FilterCondition>) => {
      const newFilters = [...filters];
      newFilters[index] = { ...newFilters[index], ...updates };
      onFilterChange(newFilters);
    },
    [filters, onFilterChange]
  );

  // Remove a filter condition
  const removeFilter = useCallback(
    (index: number) => {
      const newFilters = filters.filter((_, i) => i !== index);
      onFilterChange(newFilters);
    },
    [filters, onFilterChange]
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    onFilterChange([]);
  }, [onFilterChange]);

  // Get filter option by column
  const getFilterOption = (column: string) =>
    filterOptions.find((o) => o.column === column);

  // Count active filters (excluding empty values)
  const activeFilterCount = filters.filter(
    (f) => f.value !== '' || f.operator === 'isEmpty' || f.operator === 'isNotEmpty'
  ).length;

  return (
    <Popover open={controlledOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'h-8 gap-1.5',
            activeFilterCount > 0 && 'text-primary'
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[380px] p-3"
      >
        {/* Filter conditions */}
        <div className="space-y-2">
          {filters.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              No filters applied
            </p>
          ) : (
            filters.map((filter, index) => {
              const option = getFilterOption(filter.column);
              const needsValue =
                filter.operator !== 'isEmpty' && filter.operator !== 'isNotEmpty';

              return (
                <div
                  key={`${filter.column}-${index}`}
                  className="flex items-center gap-2"
                >
                  {/* Column selector */}
                  <Select
                    value={filter.column}
                    onValueChange={(value) => updateFilter(index, { column: value })}
                  >
                    <SelectTrigger className="h-8 w-[100px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {filterOptions.map((opt) => (
                        <SelectItem key={opt.column} value={opt.column}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Operator selector */}
                  <Select
                    value={filter.operator}
                    onValueChange={(value) =>
                      updateFilter(index, {
                        operator: value as FilterCondition['operator'],
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-[100px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Value input */}
                  {needsValue && (
                    option?.type === 'select' && option.options ? (
                      <Select
                        value={String(filter.value)}
                        onValueChange={(value) => updateFilter(index, { value })}
                      >
                        <SelectTrigger className="h-8 flex-1 text-xs">
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          {option.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type="text"
                        value={String(filter.value)}
                        onChange={(e) => updateFilter(index, { value: e.target.value })}
                        className="h-8 flex-1 text-xs"
                        placeholder="Value..."
                      />
                    )
                  )}

                  {/* Remove button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => removeFilter(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <Separator className="my-2" />

        {/* Add filter dropdown */}
        <div className="flex items-center justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                <Plus className="h-3 w-3" />
                Add filter
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {filterOptions.map((option) => (
                <DropdownMenuItem
                  key={option.column}
                  onClick={() => addFilter(option.column)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {filters.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Compact filter button for showing in toolbar
export function DataTableFilterButton({
  filterCount,
  onClick,
}: {
  filterCount: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('h-8 gap-1.5', filterCount > 0 && 'text-primary')}
      onClick={onClick}
    >
      <Filter className="h-3.5 w-3.5" />
      Filter
      {filterCount > 0 && (
        <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
          {filterCount}
        </span>
      )}
    </Button>
  );
}
