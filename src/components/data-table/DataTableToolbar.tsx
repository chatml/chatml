'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTableFilter } from './DataTableFilter';
import { DataTableFilterBar } from './DataTableFilterBar';
import { DataTableDisplay } from './DataTableDisplay';
import type { DataTableToolbarProps } from './types';

export function DataTableToolbar({
  filters,
  onFilterChange,
  filterOptions,
  displayOptionsConfig,
  displayOptions,
  onDisplayChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  selectedCount,
  bulkActions,
  selectedIds,
  onClearSelection,
}: DataTableToolbarProps) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const hasFilters = filterOptions.length > 0;
  const hasDisplayOptions = !!displayOptionsConfig;
  const hasSelection = selectedCount > 0;
  const hasActiveFilters = filters.length > 0;

  const hasSearch = !!searchPlaceholder;

  return (
    <div className="space-y-2 pb-2 px-2">
      {/* Main toolbar row */}
      <div className="flex items-center justify-between gap-4">
        {/* Left side: Filter and search */}
        <div className="flex items-center gap-3">
          {hasFilters && (
            <DataTableFilter
              filters={filters}
              onFilterChange={onFilterChange}
              filterOptions={filterOptions}
              open={filterMenuOpen}
              onOpenChange={setFilterMenuOpen}
            />
          )}

          {/* Inline search */}
          {hasSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-8 w-[200px] rounded-md border border-border/50 bg-transparent pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {searchValue && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

      {/* Right side: Display options */}
      <div className="flex items-center gap-2">
        {/* Bulk actions (shown when rows are selected) */}
        {hasSelection && (
          <div className="flex items-center gap-2 mr-2 pr-2 border-r border-border/50">
            <span className="text-sm text-muted-foreground">
              {selectedCount} selected
            </span>

            {bulkActions?.map((action) => (
              <Button
                key={action.label}
                variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => action.onClick(selectedIds)}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}

            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onClearSelection}
            >
              Clear
            </Button>
          </div>
        )}

        {/* Display options button */}
        {hasDisplayOptions && displayOptionsConfig && (
          <DataTableDisplay
            config={displayOptionsConfig}
            options={displayOptions}
            onChange={onDisplayChange}
          />
        )}
      </div>
      </div>

      {/* Filter bar - shows active filters */}
      {hasActiveFilters && hasFilters && (
        <DataTableFilterBar
          filters={filters}
          onFilterChange={onFilterChange}
          filterOptions={filterOptions}
          onAddFilter={() => setFilterMenuOpen(true)}
        />
      )}
    </div>
  );
}

// Simplified toolbar for cases where you want minimal controls
export function DataTableSearchBar({
  searchValue,
  onSearchChange,
  placeholder = 'Search...',
  rightContent,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  rightContent?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder={placeholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 pr-8 h-8"
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {rightContent}
    </div>
  );
}

// Selection indicator for showing selected count
export function DataTableSelectionIndicator({
  count,
  onClear,
  actions,
}: {
  count: number;
  onClear: () => void;
  actions?: Array<{
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'destructive';
  }>;
}) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-surface-1 rounded-md">
      <span className="text-sm text-muted-foreground">
        {count} selected
      </span>

      {actions?.map((action) => (
        <Button
          key={action.label}
          variant={action.variant === 'destructive' ? 'destructive' : 'outline'}
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={action.onClick}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}

      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-xs"
        onClick={onClear}
      >
        Clear
      </Button>
    </div>
  );
}
