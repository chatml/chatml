import type { ReactNode } from 'react';

// Column definition for the data table
export interface Column<T> {
  /** Unique identifier for the column */
  id: string;
  /** Header text or component */
  header: string | ReactNode;
  /** Key to access data or function to compute value */
  accessorKey?: keyof T | ((row: T) => unknown);
  /** Custom cell renderer */
  cell?: (row: T) => ReactNode;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Fixed width (e.g., '32px', '100px') */
  width?: string;
  /** Minimum width */
  minWidth?: string;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
  /** Whether this column is hidden by default */
  hidden?: boolean;
}

// Group configuration for grouping rows
export interface GroupConfig<T> {
  /** Key to group by or function to compute group key */
  key: keyof T | ((row: T) => string);
  /** Optional label for the grouping */
  label?: string;
  /** Function to get display label for a group key */
  getLabel?: (key: string) => string;
  /** Function to get icon for a group key */
  getIcon?: (key: string) => ReactNode;
  /** Group keys that should be collapsed by default */
  defaultCollapsed?: string[];
  /** Custom sort order for groups */
  sortOrder?: string[];
  /** Whether to show empty groups */
  showEmpty?: boolean;
}

// Sort configuration
export interface SortConfig {
  /** Column ID to sort by */
  column: string;
  /** Sort direction */
  direction: 'asc' | 'desc';
}

// Filter condition for filtering rows
export interface FilterCondition {
  /** Column ID to filter */
  column: string;
  /** Filter operator */
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan' | 'isEmpty' | 'isNotEmpty';
  /** Value to compare against */
  value: string | number | boolean;
}

// Context menu item definition
export interface ContextMenuItem {
  /** Menu item label */
  label: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Keyboard shortcut hint */
  shortcut?: string;
  /** Click handler */
  onClick: () => void;
  /** Visual variant */
  variant?: 'default' | 'destructive';
  /** Whether this is a separator (renders a divider) */
  separator?: boolean;
  /** Whether this item is disabled */
  disabled?: boolean;
}

// Display options for the table
export interface DisplayOptions {
  /** Group by setting (null for no grouping) */
  groupBy: string | null;
  /** Sort configuration */
  sortBy: SortConfig | null;
  /** Column visibility */
  visibleColumns: Set<string>;
  /** Whether to show empty groups */
  showEmptyGroups: boolean;
  /** Custom toggle states keyed by ID */
  customToggles: Record<string, boolean>;
}

// Bulk action definition
export interface BulkAction {
  /** Action label */
  label: string;
  /** Optional icon */
  icon?: ReactNode;
  /** Click handler with selected IDs */
  onClick: (selectedIds: Set<string>) => void;
  /** Visual variant */
  variant?: 'default' | 'destructive';
}

// Main DataTable props
export interface DataTableProps<T> {
  /** Array of data items */
  data: T[];
  /** Column definitions */
  columns: Column<T>[];
  /** Function to get unique ID for each row */
  getRowId: (row: T) => string;
  /** Group configuration */
  groupBy?: GroupConfig<T>;
  /** Sort configuration */
  sortBy?: SortConfig;
  /** Active filter conditions */
  filters?: FilterCondition[];
  /** Controlled selection state */
  selectedIds?: Set<string>;
  /** Selection change handler */
  onSelectionChange?: (ids: Set<string>) => void;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Row double-click handler */
  onRowDoubleClick?: (row: T) => void;
  /** Context menu items generator */
  onRowContextMenu?: (row: T) => ContextMenuItem[];
  /** Loading state */
  loading?: boolean;
  /** Custom empty state */
  emptyState?: ReactNode;
  /** Whether row selection is enabled */
  selectable?: boolean;
  /** Bulk actions when rows are selected */
  bulkActions?: BulkAction[];
  /** Filter options configuration */
  filterOptions?: FilterOption[];
  /** Display options configuration */
  displayOptionsConfig?: DisplayOptionsConfig;
  /** Search placeholder text */
  searchPlaceholder?: string;
  /** External search value (controlled) */
  searchValue?: string;
  /** Search change handler */
  onSearchChange?: (value: string) => void;
  /** Callback when display options change */
  onDisplayOptionsChange?: (options: DisplayOptions) => void;
  /** Custom class name for the container */
  className?: string;
  /** Custom content for the left side of the toolbar */
  toolbarLeftContent?: ReactNode;
}

// Filter option for the filter menu
export interface FilterOption {
  /** Column ID */
  column: string;
  /** Display label */
  label: string;
  /** Type of filter input */
  type: 'text' | 'select' | 'boolean';
  /** Options for select type */
  options?: { value: string; label: string }[];
}

// Custom toggle for the List Options section
export interface ListOptionToggle {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Default value */
  defaultValue: boolean;
}

// Display options configuration
export interface DisplayOptionsConfig {
  /** Available grouping options */
  groupingOptions: { value: string; label: string }[];
  /** Available sorting options */
  sortingOptions: { value: string; label: string }[];
  /** Toggleable columns */
  toggleableColumns: { id: string; label: string }[];
  /** Custom toggles in the List Options section */
  listOptions?: ListOptionToggle[];
}

// Group data structure
export interface GroupData<T> {
  /** Group key */
  key: string;
  /** Display label */
  label: string;
  /** Optional icon for the group */
  icon?: ReactNode;
  /** Rows in this group */
  rows: T[];
  /** Whether the group is collapsed */
  collapsed: boolean;
}

// Internal state for the data table
export interface DataTableState {
  /** Set of collapsed group keys */
  collapsedGroups: Set<string>;
  /** Current sort configuration */
  sort: SortConfig | null;
  /** Active filter conditions */
  filters: FilterCondition[];
  /** Selected row IDs */
  selectedIds: Set<string>;
  /** Focused row index */
  focusedIndex: number;
  /** Search term */
  searchTerm: string;
  /** Column visibility */
  visibleColumns: Set<string>;
  /** Current grouping key */
  groupBy: string | null;
}

// Props for the DataTable row component
export interface DataTableRowProps<T> {
  /** The row data */
  row: T;
  /** Row unique ID */
  rowId: string;
  /** Column definitions */
  columns: Column<T>[];
  /** Whether the row is selected */
  isSelected: boolean;
  /** Whether the row is focused */
  isFocused: boolean;
  /** Selection toggle handler */
  onToggleSelect: () => void;
  /** Row click handler */
  onClick?: () => void;
  /** Row double-click handler */
  onDoubleClick?: () => void;
  /** Mouse enter handler for hover tracking */
  onMouseEnter?: () => void;
  /** Mouse leave handler for hover tracking */
  onMouseLeave?: () => void;
  /** Context menu items */
  contextMenuItems?: ContextMenuItem[];
  /** Whether selection is enabled */
  selectable?: boolean;
  /** Index for keyboard navigation */
  index: number;
}

// Props for the DataTable group header
export interface DataTableGroupProps {
  /** Group key */
  groupKey: string;
  /** Display label */
  label: string;
  /** Optional icon for the group */
  icon?: ReactNode;
  /** Number of items in the group */
  count: number;
  /** Whether the group is collapsed */
  isCollapsed: boolean;
  /** Toggle collapse handler */
  onToggle: () => void;
  /** Collapse all groups handler */
  onCollapseAll?: () => void;
  /** Column span */
  colSpan: number;
  /** Whether to show selection controls */
  selectable?: boolean;
  /** Whether all items in group are selected */
  allSelected?: boolean;
  /** Whether some items in group are selected */
  someSelected?: boolean;
  /** Select all in group handler */
  onSelectAll?: () => void;
}

// Props for the toolbar component
export interface DataTableToolbarProps {
  /** Active filter conditions */
  filters: FilterCondition[];
  /** Filter change handler */
  onFilterChange: (filters: FilterCondition[]) => void;
  /** Available filter options */
  filterOptions: FilterOption[];
  /** Display options configuration */
  displayOptionsConfig?: DisplayOptionsConfig;
  /** Current display options */
  displayOptions: DisplayOptions;
  /** Display options change handler */
  onDisplayChange: (options: DisplayOptions) => void;
  /** Search value */
  searchValue: string;
  /** Search change handler */
  onSearchChange: (value: string) => void;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** Number of selected rows */
  selectedCount: number;
  /** Bulk actions */
  bulkActions?: BulkAction[];
  /** Selected IDs for bulk actions */
  selectedIds: Set<string>;
  /** Clear selection handler */
  onClearSelection: () => void;
  /** Custom content for the left side of the toolbar */
  leftContent?: ReactNode;
}
