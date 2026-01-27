'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DataTableRow } from './DataTableRow';
import { DataTableGroup } from './DataTableGroup';
import { DataTableToolbar } from './DataTableToolbar';
import { useDataTableSelection } from './hooks/useDataTableSelection';
import { useDataTableKeyboard } from './hooks/useDataTableKeyboard';
import type {
  DataTableProps,
  Column,
  GroupConfig,
  GroupData,
  FilterCondition,
  SortConfig,
  DisplayOptions,
} from './types';

// Helper to get value for sorting/filtering
function getValue<T>(row: T, key: keyof T | ((row: T) => unknown)): unknown {
  if (typeof key === 'function') {
    return key(row);
  }
  return row[key];
}

// Helper to group rows
function groupRows<T>(
  rows: T[],
  groupConfig: GroupConfig<T>
): GroupData<T>[] {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = String(getValue(row, groupConfig.key));
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }

  // Sort groups by custom order or alphabetically
  const sortedKeys = Array.from(groups.keys());
  if (groupConfig.sortOrder) {
    sortedKeys.sort((a, b) => {
      const aIndex = groupConfig.sortOrder!.indexOf(a);
      const bIndex = groupConfig.sortOrder!.indexOf(b);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.localeCompare(b);
    });
  } else {
    sortedKeys.sort((a, b) => a.localeCompare(b));
  }

  return sortedKeys.map((key) => ({
    key,
    label: groupConfig.getLabel
      ? groupConfig.getLabel(key)
      : groupConfig.label
        ? `${groupConfig.label}: ${key}`
        : key,
    icon: groupConfig.getIcon?.(key),
    rows: groups.get(key)!,
    collapsed: groupConfig.defaultCollapsed?.includes(key) ?? false,
  }));
}

// Helper to filter rows
function filterRows<T>(
  rows: T[],
  filters: FilterCondition[],
  columns: Column<T>[]
): T[] {
  if (filters.length === 0) return rows;

  return rows.filter((row) => {
    return filters.every((filter) => {
      const column = columns.find((c) => c.id === filter.column);
      if (!column?.accessorKey) return true;

      const value = getValue(row, column.accessorKey);
      const stringValue = String(value ?? '').toLowerCase();
      const filterValue = String(filter.value).toLowerCase();

      switch (filter.operator) {
        case 'equals':
          return stringValue === filterValue;
        case 'contains':
          return stringValue.includes(filterValue);
        case 'startsWith':
          return stringValue.startsWith(filterValue);
        case 'endsWith':
          return stringValue.endsWith(filterValue);
        case 'isEmpty':
          return !value || stringValue === '';
        case 'isNotEmpty':
          return !!value && stringValue !== '';
        case 'greaterThan':
          return Number(value) > Number(filter.value);
        case 'lessThan':
          return Number(value) < Number(filter.value);
        default:
          return true;
      }
    });
  });
}

// Helper to sort rows
function sortRows<T>(
  rows: T[],
  sortConfig: SortConfig | null,
  columns: Column<T>[]
): T[] {
  if (!sortConfig) return rows;

  const column = columns.find((c) => c.id === sortConfig.column);
  if (!column?.accessorKey) return rows;

  return [...rows].sort((a, b) => {
    const aValue = getValue(a, column.accessorKey!);
    const bValue = getValue(b, column.accessorKey!);

    let comparison = 0;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue);
    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
      comparison = aValue - bValue;
    } else {
      comparison = String(aValue ?? '').localeCompare(String(bValue ?? ''));
    }

    return sortConfig.direction === 'desc' ? -comparison : comparison;
  });
}

// Helper to search rows
function searchRows<T>(
  rows: T[],
  searchTerm: string,
  columns: Column<T>[]
): T[] {
  if (!searchTerm) return rows;

  const lowerSearch = searchTerm.toLowerCase();

  return rows.filter((row) => {
    return columns.some((column) => {
      if (!column.accessorKey) return false;
      const value = getValue(row, column.accessorKey);
      return String(value ?? '').toLowerCase().includes(lowerSearch);
    });
  });
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  groupBy,
  sortBy: initialSortBy,
  filters: initialFilters = [],
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  loading = false,
  emptyState,
  selectable = false,
  bulkActions,
  filterOptions = [],
  displayOptionsConfig,
  searchPlaceholder,
  searchValue: controlledSearchValue,
  onSearchChange,
  className,
}: DataTableProps<T>) {
  // Internal state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(groupBy?.defaultCollapsed ?? [])
  );
  const [internalFilters, setInternalFilters] = useState<FilterCondition[]>(initialFilters);
  const [internalSortBy, setInternalSortBy] = useState<SortConfig | null>(initialSortBy ?? null);
  const [internalSearchValue, setInternalSearchValue] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    // '__none__' means no grouping (flat list), null means use prop-based grouping
    // Use null (prop-based) when a groupBy prop is provided, otherwise no grouping
    groupBy: groupBy ? null : '__none__',
    sortBy: initialSortBy ?? null,
    visibleColumns: new Set(columns.filter((c) => !c.hidden).map((c) => c.id)),
    showEmptyGroups: groupBy?.showEmpty ?? false,
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // Use controlled or internal values
  const searchValue = controlledSearchValue ?? internalSearchValue;
  const setSearchValue = onSearchChange ?? setInternalSearchValue;
  const filters = internalFilters;
  const setFilters = setInternalFilters;
  const sortConfig = displayOptions.sortBy ?? internalSortBy;

  // Process data: search -> filter -> sort
  const processedData = useMemo(() => {
    let result = data;
    result = searchRows(result, searchValue, columns);
    result = filterRows(result, filters, columns);
    result = sortRows(result, sortConfig, columns);
    return result;
  }, [data, searchValue, filters, sortConfig, columns]);

  // Get all row IDs
  const allRowIds = useMemo(
    () => processedData.map(getRowId),
    [processedData, getRowId]
  );

  // Determine effective grouping based on displayOptions or prop
  const effectiveGroupBy = useMemo<GroupConfig<T> | null>(() => {
    // User explicitly selected "No grouping"
    if (displayOptions.groupBy === '__none__') {
      return null;
    }
    // User selected a specific grouping field
    if (displayOptions.groupBy) {
      return {
        key: displayOptions.groupBy as keyof T,
        sortOrder: groupBy?.sortOrder,
        defaultCollapsed: groupBy?.defaultCollapsed,
        getLabel: groupBy?.getLabel,
        getIcon: groupBy?.getIcon,
        showEmpty: displayOptions.showEmptyGroups,
      };
    }
    // Fall back to prop-based grouping if no display option set (null/undefined)
    return groupBy ?? null;
  }, [displayOptions.groupBy, displayOptions.showEmptyGroups, groupBy]);

  // Group data if grouping is configured
  const groupedData = useMemo<GroupData<T>[]>(() => {
    if (!effectiveGroupBy) {
      return [{ key: '__all__', label: '', rows: processedData, collapsed: false }];
    }
    const groups = groupRows(processedData, effectiveGroupBy);
    // Apply collapsed state
    return groups.map((g) => ({
      ...g,
      collapsed: collapsedGroups.has(g.key),
    }));
  }, [processedData, effectiveGroupBy, collapsedGroups]);

  // Get grouped row IDs for selection
  const groupedRowIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of groupedData) {
      map.set(group.key, group.rows.map(getRowId));
    }
    return map;
  }, [groupedData, getRowId]);

  // Flat list of visible rows for keyboard navigation
  const visibleRows = useMemo(() => {
    const rows: { row: T; groupKey: string }[] = [];
    for (const group of groupedData) {
      if (!group.collapsed) {
        for (const row of group.rows) {
          rows.push({ row, groupKey: group.key });
        }
      }
    }
    return rows;
  }, [groupedData]);

  // Selection hook
  const selection = useDataTableSelection({
    allRowIds,
    groupedRowIds,
    controlledSelectedIds,
    onSelectionChange,
  });

  // Keyboard navigation - hook sets up event listeners internally
  useDataTableKeyboard({
    enabled: true,
    rowCount: visibleRows.length,
    focusedIndex,
    onFocusChange: setFocusedIndex,
    onToggleSelection: () => {
      if (focusedIndex >= 0 && focusedIndex < visibleRows.length) {
        const rowId = getRowId(visibleRows[focusedIndex].row);
        selection.toggleSelection(rowId);
      }
    },
    onToggleHoveredSelection: () => {
      if (hoveredRowId) {
        selection.toggleSelection(hoveredRowId);
      }
    },
    hasHoveredRow: !!hoveredRowId,
    onSelectAll: selection.selectAll,
    onClearSelection: selection.clearSelection,
    onAction: () => {
      if (focusedIndex >= 0 && focusedIndex < visibleRows.length) {
        onRowClick?.(visibleRows[focusedIndex].row);
      }
    },
    containerRef: containerRef as React.RefObject<HTMLElement | null>,
  });

  // Toggle group collapse
  const toggleGroupCollapse = useCallback((groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  // Collapse all groups
  const collapseAllGroups = useCallback(() => {
    setCollapsedGroups(new Set(groupedData.map((g) => g.key)));
  }, [groupedData]);

  // Handle display options change
  const handleDisplayChange = useCallback((newOptions: DisplayOptions) => {
    setDisplayOptions(newOptions);
    if (newOptions.sortBy !== displayOptions.sortBy) {
      setInternalSortBy(newOptions.sortBy);
    }
  }, [displayOptions.sortBy]);

  // Get visible columns
  const visibleColumns = useMemo(
    () => columns.filter((c) => displayOptions.visibleColumns.has(c.id)),
    [columns, displayOptions.visibleColumns]
  );

  // Calculate column count for spanning
  const columnCount = visibleColumns.length + (selectable ? 1 : 0);

  // Track row index for keyboard navigation
  let rowIndex = 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('space-y-3', className)}>
      {/* Toolbar */}
      {(filterOptions.length > 0 || displayOptionsConfig || searchPlaceholder) && (
        <DataTableToolbar
          filters={filters}
          onFilterChange={setFilters}
          filterOptions={filterOptions}
          displayOptionsConfig={displayOptionsConfig}
          displayOptions={displayOptions}
          onDisplayChange={handleDisplayChange}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          searchPlaceholder={searchPlaceholder}
          selectedCount={selection.selectedCount}
          bulkActions={bulkActions}
          selectedIds={selection.selectedIds}
          onClearSelection={selection.clearSelection}
        />
      )}

      {/* Table */}
      {processedData.length === 0 ? (
        emptyState || (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No items found</p>
          </div>
        )
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="border-y border-border/30 hover:bg-transparent">
              {/* Selection header */}
              {selectable && (
                <TableHead className="w-[32px] px-2">
                  <Checkbox
                    checked={selection.isAllSelected}
                    onCheckedChange={() => {
                      if (selection.isAllSelected) {
                        selection.clearSelection();
                      } else {
                        selection.selectAll();
                      }
                    }}
                    className="h-3.5 w-3.5 opacity-30 hover:opacity-100 transition-opacity"
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              {/* Column headers */}
              {visibleColumns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    'text-sm font-medium text-foreground/70 h-9',
                    column.align === 'center' && 'text-center',
                    column.align === 'right' && 'text-right',
                    column.sortable && 'cursor-pointer hover:text-foreground select-none'
                  )}
                  style={{
                    width: column.width,
                    minWidth: column.minWidth,
                  }}
                  onClick={() => {
                    if (column.sortable) {
                      const currentSort = displayOptions.sortBy;
                      if (currentSort?.column === column.id) {
                        if (currentSort.direction === 'asc') {
                          handleDisplayChange({
                            ...displayOptions,
                            sortBy: { column: column.id, direction: 'desc' },
                          });
                        } else {
                          handleDisplayChange({ ...displayOptions, sortBy: null });
                        }
                      } else {
                        handleDisplayChange({
                          ...displayOptions,
                          sortBy: { column: column.id, direction: 'asc' },
                        });
                      }
                    }
                  }}
                >
                  <span className="flex items-center gap-1">
                    {column.header}
                    {column.sortable && displayOptions.sortBy?.column === column.id && (
                      <span className="text-foreground">
                        {displayOptions.sortBy.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
              {groupedData.map((group) => {
                const showGroupHeader = effectiveGroupBy && group.key !== '__all__';
                const groupContent: React.ReactNode[] = [];

                // Group header
                if (showGroupHeader) {
                  groupContent.push(
                    <DataTableGroup
                      key={`group-${group.key}`}
                      groupKey={group.key}
                      label={group.label}
                      icon={group.icon}
                      count={group.rows.length}
                      isCollapsed={group.collapsed}
                      onToggle={() => toggleGroupCollapse(group.key)}
                      onCollapseAll={collapseAllGroups}
                      colSpan={columnCount}
                      selectable={selectable}
                      onSelectAll={() => selection.selectAllInGroup(group.key)}
                    />
                  );
                }

                // Rows (if not collapsed)
                if (!group.collapsed) {
                  for (const row of group.rows) {
                    const rowId = getRowId(row);
                    const currentIndex = rowIndex;
                    rowIndex++;

                    const contextItems = onRowContextMenu?.(row);

                    groupContent.push(
                      <DataTableRow
                        key={rowId}
                        row={row}
                        rowId={rowId}
                        columns={columns}
                        visibleColumns={displayOptions.visibleColumns}
                        isSelected={selection.isSelected(rowId)}
                        isFocused={currentIndex === focusedIndex}
                        onToggleSelect={() => selection.toggleSelection(rowId)}
                        onClick={() => onRowClick?.(row)}
                        onDoubleClick={() => onRowDoubleClick?.(row)}
                        onMouseEnter={() => setHoveredRowId(rowId)}
                        onMouseLeave={() => setHoveredRowId(null)}
                        contextMenuItems={contextItems}
                        selectable={selectable}
                      />
                    );
                  }
                }

                return groupContent;
              })}
            </TableBody>
          </Table>
      )}
    </div>
  );
}
