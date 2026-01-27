'use client';

import { useState, useMemo } from 'react';
import {
  Filter,
  Check,
  User,
  GitBranch,
  Activity,
  FolderTree,
  MapPin,
  Search,
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
import type { FilterCondition, FilterOption } from './types';

interface DataTableFilterProps {
  /** Current filter conditions */
  filters: FilterCondition[];
  /** Filter change handler */
  onFilterChange: (filters: FilterCondition[]) => void;
  /** Available filter options */
  filterOptions: FilterOption[];
}

// Icon mapping for filter categories
const FILTER_ICONS: Record<string, React.ReactNode> = {
  status: <Activity className="h-4 w-4" />,
  sessionStatus: <Activity className="h-4 w-4" />,
  author: <User className="h-4 w-4" />,
  lastAuthor: <User className="h-4 w-4" />,
  location: <MapPin className="h-4 w-4" />,
  prefix: <FolderTree className="h-4 w-4" />,
  hasSession: <GitBranch className="h-4 w-4" />,
  name: <GitBranch className="h-4 w-4" />,
};

export function DataTableFilter({
  filters,
  onFilterChange,
  filterOptions,
}: DataTableFilterProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Get selected values for a column
  const getSelectedValues = (column: string): string[] => {
    return filters
      .filter((f) => f.column === column)
      .map((f) => String(f.value));
  };

  // Toggle a filter value
  const toggleFilterValue = (column: string, value: string) => {
    const existingFilter = filters.find(
      (f) => f.column === column && String(f.value) === value
    );

    if (existingFilter) {
      // Remove the filter
      onFilterChange(
        filters.filter((f) => !(f.column === column && String(f.value) === value))
      );
    } else {
      // Add the filter
      onFilterChange([
        ...filters,
        { column, operator: 'equals', value },
      ]);
    }
  };

  // Clear filters for a column
  const clearColumnFilters = (column: string) => {
    onFilterChange(filters.filter((f) => f.column !== column));
  };

  // Count active filters
  const activeFilterCount = filters.length;

  // Filter options by search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return filterOptions;
    const query = searchQuery.toLowerCase();
    return filterOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        opt.options?.some((o) => o.label.toLowerCase().includes(query))
    );
  }, [filterOptions, searchQuery]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px] p-0">
        {/* Search input */}
        <div className="p-2 border-b border-border/70">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Add Filter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-8 text-[13px] bg-transparent border-none outline-none placeholder:text-muted-foreground text-foreground"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground bg-surface-2 px-1.5 py-0.5 rounded">
              F
            </span>
          </div>
        </div>

        {/* Filter options */}
        <div className="p-1">
          {filteredOptions.map((option) => {
            const selectedValues = getSelectedValues(option.column);
            const hasSelections = selectedValues.length > 0;
            const icon = FILTER_ICONS[option.column] || <Filter className="h-4 w-4" />;

            // For select-type filters with predefined options
            if (option.type === 'select' && option.options) {
              return (
                <DropdownMenuSub key={option.column}>
                  <DropdownMenuSubTrigger
                    className={cn(
                      'px-3 py-2 text-[13px]',
                      hasSelections && 'text-primary'
                    )}
                  >
                    <span className="text-muted-foreground">{icon}</span>
                    <span className="flex-1">{option.label}</span>
                    {hasSelections && (
                      <span className="text-[11px] text-primary mr-1">
                        {selectedValues.length}
                      </span>
                    )}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={-4} className="w-[180px] p-0">
                    <div className="py-1">
                      {option.options.map((opt) => {
                        const isSelected = selectedValues.includes(opt.value);
                        return (
                          <DropdownMenuItem
                            key={opt.value}
                            className="px-3 py-2 text-[13px]"
                            onSelect={(e) => {
                              e.preventDefault();
                              toggleFilterValue(option.column, opt.value);
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
                    </div>
                    {hasSelections && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="px-3 py-2 text-[13px] text-muted-foreground"
                          onSelect={() => clearColumnFilters(option.column)}
                        >
                          Clear filter
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            }

            // For text-type filters (shows input in submenu)
            return (
              <DropdownMenuSub key={option.column}>
                <DropdownMenuSubTrigger
                  className={cn(
                    'px-3 py-2 text-[13px]',
                    hasSelections && 'text-primary'
                  )}
                >
                  <span className="text-muted-foreground">{icon}</span>
                  <span className="flex-1">{option.label}</span>
                  {hasSelections && (
                    <span className="text-[11px] text-primary mr-1">
                      {selectedValues.length}
                    </span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={-4} className="w-[200px] p-2">
                  <TextFilterInput
                    column={option.column}
                    filters={filters}
                    onFilterChange={onFilterChange}
                    placeholder={`Filter by ${option.label.toLowerCase()}...`}
                  />
                  {hasSelections && (
                    <button
                      type="button"
                      className="w-full mt-2 px-2 py-1.5 text-[12px] text-muted-foreground hover:text-foreground text-left"
                      onClick={() => clearColumnFilters(option.column)}
                    >
                      Clear filter
                    </button>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })}
        </div>

        {/* Clear all filters */}
        {activeFilterCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="p-1">
              <DropdownMenuItem
                className="px-3 py-2 text-[13px] text-muted-foreground"
                onSelect={() => onFilterChange([])}
              >
                Clear all filters
              </DropdownMenuItem>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Text filter input component
function TextFilterInput({
  column,
  filters,
  onFilterChange,
  placeholder,
}: {
  column: string;
  filters: FilterCondition[];
  onFilterChange: (filters: FilterCondition[]) => void;
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const existingFilter = filters.find((f) => f.column === column);
  const currentValue = existingFilter ? String(existingFilter.value) : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    // Update or add filter
    if (existingFilter) {
      onFilterChange(
        filters.map((f) =>
          f.column === column ? { ...f, value: inputValue.trim() } : f
        )
      );
    } else {
      onFilterChange([
        ...filters,
        { column, operator: 'contains', value: inputValue.trim() },
      ]);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={inputValue || currentValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder}
        className="w-full h-8 px-2 text-[13px] bg-surface-2 border border-border/50 rounded outline-none placeholder:text-muted-foreground text-foreground focus:border-border"
        autoFocus
      />
    </form>
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
