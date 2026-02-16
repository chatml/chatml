'use client';

import { useState } from 'react';
import { X, Filter, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { FilterCondition, FilterOption } from './types';

interface DataTableFilterBarProps {
  /** Active filter conditions */
  filters: FilterCondition[];
  /** Filter change handler */
  onFilterChange: (filters: FilterCondition[]) => void;
  /** Available filter options */
  filterOptions: FilterOption[];
  /** Handler to open the filter menu to add more filters */
  onAddFilter?: () => void;
}

// Operator display labels
const OPERATOR_LABELS: Record<string, string> = {
  equals: 'is',
  contains: 'contains',
  startsWith: 'starts with',
  endsWith: 'ends with',
  greaterThan: '>',
  lessThan: '<',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty',
};

// Get available operators for a filter type
function getOperatorsForType(type: FilterOption['type']): { value: string; label: string }[] {
  switch (type) {
    case 'select':
    case 'boolean':
      return [
        { value: 'equals', label: 'is' },
      ];
    case 'text':
    default:
      return [
        { value: 'equals', label: 'is' },
        { value: 'contains', label: 'contains' },
        { value: 'startsWith', label: 'starts with' },
        { value: 'endsWith', label: 'ends with' },
      ];
  }
}

export function DataTableFilterBar({
  filters,
  onFilterChange,
  filterOptions,
  onAddFilter,
}: DataTableFilterBarProps) {
  if (filters.length === 0) return null;

  // Group filters by column for display
  const groupedFilters = filters.reduce((acc, filter) => {
    if (!acc[filter.column]) {
      acc[filter.column] = [];
    }
    acc[filter.column].push(filter);
    return acc;
  }, {} as Record<string, FilterCondition[]>);

  // Remove a specific filter
  const removeFilter = (column: string, value: string) => {
    onFilterChange(
      filters.filter((f) => !(f.column === column && String(f.value) === value))
    );
  };

  // Remove all filters for a column
  const removeColumnFilters = (column: string) => {
    onFilterChange(filters.filter((f) => f.column !== column));
  };

  // Toggle a filter value (for multi-select)
  const toggleFilterValue = (column: string, value: string) => {
    const existingFilter = filters.find(
      (f) => f.column === column && String(f.value) === value
    );

    if (existingFilter) {
      removeFilter(column, value);
    } else {
      onFilterChange([
        ...filters,
        { column, operator: 'equals', value },
      ]);
    }
  };

  // Update filter operator
  const updateFilterOperator = (column: string, operator: FilterCondition['operator']) => {
    onFilterChange(
      filters.map((f) =>
        f.column === column ? { ...f, operator } : f
      )
    );
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {Object.entries(groupedFilters).map(([column, columnFilters]) => {
        const filterOption = filterOptions.find((o) => o.column === column);
        if (!filterOption) return null;

        const operator = columnFilters[0]?.operator ?? 'equals';
        const values = columnFilters.map((f) => String(f.value));
        const operators = getOperatorsForType(filterOption.type);

        return (
          <FilterPill
            key={column}
            column={column}
            label={filterOption.label}
            operator={operator}
            operatorLabel={OPERATOR_LABELS[operator] ?? operator}
            values={values}
            options={filterOption.options}
            operators={operators}
            onRemove={() => removeColumnFilters(column)}
            onRemoveValue={(value) => removeFilter(column, value)}
            onToggleValue={(value) => toggleFilterValue(column, value)}
            onOperatorChange={(op) => updateFilterOperator(column, op as FilterCondition['operator'])}
          />
        );
      })}

      {/* Add filter button */}
      {onAddFilter && (
        <button
          type="button"
          onClick={onAddFilter}
          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          title="Add filter"
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

interface FilterPillProps {
  column: string;
  label: string;
  operator: string;
  operatorLabel: string;
  values: string[];
  options?: { value: string; label: string }[];
  operators: { value: string; label: string }[];
  onRemove: () => void;
  onRemoveValue: (value: string) => void;
  onToggleValue: (value: string) => void;
  onOperatorChange: (operator: string) => void;
}

function FilterPill({
  label,
  operator,
  operatorLabel,
  values,
  options,
  operators,
  onRemove,
  onToggleValue,
  onOperatorChange,
}: FilterPillProps) {
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);

  // Get display label for a value
  const getValueLabel = (value: string) => {
    if (options) {
      return options.find((o) => o.value === value)?.label ?? value;
    }
    return value;
  };

  // Display value(s)
  const displayValue = values.length === 1
    ? getValueLabel(values[0])
    : `${values.length} selected`;

  return (
    <div className="flex items-center h-7 rounded-md border border-border/50 bg-surface-1 text-sm overflow-hidden">
      {/* Field label - static */}
      <span className="px-2 py-1 text-muted-foreground border-r border-border/50">
        {label}
      </span>

      {/* Operator dropdown */}
      <DropdownMenu open={operatorOpen} onOpenChange={setOperatorOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors border-r border-border/50"
          >
            {operatorLabel}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[120px]">
          {operators.map((op) => (
            <DropdownMenuItem
              key={op.value}
              className="text-sm"
              onSelect={() => {
                onOperatorChange(op.value);
                setOperatorOpen(false);
              }}
            >
              <div
                className={cn(
                  'h-4 w-4 rounded border flex items-center justify-center mr-2',
                  operator === op.value
                    ? 'bg-primary border-primary'
                    : 'border-border'
                )}
              >
                {operator === op.value && (
                  <Check className="h-3 w-3 text-primary-foreground" />
                )}
              </div>
              {op.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Value dropdown */}
      <DropdownMenu open={valueOpen} onOpenChange={setValueOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="px-2 py-1 text-foreground hover:bg-surface-2 transition-colors"
          >
            {displayValue}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px] max-h-[300px] overflow-y-auto">
          {/* Header */}
          <div className="px-3 py-2 text-sm text-muted-foreground border-b border-border/50">
            {label}
          </div>

          {/* Options */}
          {options ? (
            <div className="py-1">
              {options.map((opt) => {
                const isSelected = values.includes(opt.value);
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    className="px-3 py-2 text-sm"
                    onSelect={(e) => {
                      e.preventDefault();
                      onToggleValue(opt.value);
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
                  </DropdownMenuItem>
                );
              })}
            </div>
          ) : (
            // Text input for text-type filters
            <div className="p-2">
              <input
                type="text"
                defaultValue={values[0] ?? ''}
                placeholder={`Filter by ${label.toLowerCase()}...`}
                className="w-full h-8 px-2 text-sm bg-surface-2 border border-border/50 rounded outline-none placeholder:text-muted-foreground text-foreground focus:border-border"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const newValue = (e.target as HTMLInputElement).value.trim();
                    if (newValue && values[0] !== newValue) {
                      if (values[0]) {
                        onToggleValue(values[0]); // Remove old
                      }
                      onToggleValue(newValue); // Add new
                    }
                    setValueOpen(false);
                  }
                }}
                autoFocus
              />
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="px-1.5 py-1 text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
        title="Remove filter"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
