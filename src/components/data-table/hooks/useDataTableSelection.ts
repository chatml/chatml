'use client';

import { useState, useCallback, useMemo } from 'react';

interface UseDataTableSelectionProps {
  /** All row IDs in the data set */
  allRowIds: string[];
  /** Row IDs organized by group */
  groupedRowIds?: Map<string, string[]>;
  /** External controlled selection */
  controlledSelectedIds?: Set<string>;
  /** Change handler for controlled mode */
  onSelectionChange?: (ids: Set<string>) => void;
}

interface UseDataTableSelectionReturn {
  /** Currently selected row IDs */
  selectedIds: Set<string>;
  /** Toggle selection for a single row */
  toggleSelection: (id: string) => void;
  /** Select a single row (clearing others) */
  selectOnly: (id: string) => void;
  /** Add to selection without clearing others */
  addToSelection: (id: string) => void;
  /** Remove from selection */
  removeFromSelection: (id: string) => void;
  /** Select all rows */
  selectAll: () => void;
  /** Select all rows in a specific group */
  selectAllInGroup: (groupKey: string) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Range select from last selected to target */
  rangeSelect: (fromId: string, toId: string) => void;
  /** Check if a row is selected */
  isSelected: (id: string) => boolean;
  /** Check if all rows are selected */
  isAllSelected: boolean;
  /** Check if some (but not all) rows are selected */
  isSomeSelected: boolean;
  /** Check if all rows in a group are selected */
  isGroupAllSelected: (groupKey: string) => boolean;
  /** Check if some rows in a group are selected */
  isGroupSomeSelected: (groupKey: string) => boolean;
  /** Number of selected rows */
  selectedCount: number;
}

export function useDataTableSelection({
  allRowIds,
  groupedRowIds,
  controlledSelectedIds,
  onSelectionChange,
}: UseDataTableSelectionProps): UseDataTableSelectionReturn {
  // Internal state for uncontrolled mode
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());

  // Use controlled or internal state
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;

  // Update function that works for both controlled and uncontrolled modes
  const setSelectedIds = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      if (controlledSelectedIds !== undefined && onSelectionChange) {
        // Controlled mode
        const newIds = typeof updater === 'function' ? updater(controlledSelectedIds) : updater;
        onSelectionChange(newIds);
      } else {
        // Uncontrolled mode
        setInternalSelectedIds((prev) => {
          const newIds = typeof updater === 'function' ? updater(prev) : updater;
          return newIds;
        });
      }
    },
    [controlledSelectedIds, onSelectionChange]
  );

  // Toggle selection for a single row
  const toggleSelection = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [setSelectedIds]
  );

  // Select only a single row (clearing others)
  const selectOnly = useCallback(
    (id: string) => {
      setSelectedIds(new Set([id]));
    },
    [setSelectedIds]
  );

  // Add to selection without clearing
  const addToSelection = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    [setSelectedIds]
  );

  // Remove from selection
  const removeFromSelection = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [setSelectedIds]
  );

  // Select all rows
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(allRowIds));
  }, [allRowIds, setSelectedIds]);

  // Select all rows in a specific group
  const selectAllInGroup = useCallback(
    (groupKey: string) => {
      if (!groupedRowIds) return;
      const groupIds = groupedRowIds.get(groupKey);
      if (!groupIds) return;

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of groupIds) {
          next.add(id);
        }
        return next;
      });
    },
    [groupedRowIds, setSelectedIds]
  );

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, [setSelectedIds]);

  // Range select between two IDs
  const rangeSelect = useCallback(
    (fromId: string, toId: string) => {
      const fromIndex = allRowIds.indexOf(fromId);
      const toIndex = allRowIds.indexOf(toId);

      if (fromIndex === -1 || toIndex === -1) return;

      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(allRowIds[i]);
        }
        return next;
      });
    },
    [allRowIds, setSelectedIds]
  );

  // Check if a row is selected
  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  // Check if all rows are selected
  const isAllSelected = useMemo(
    () => allRowIds.length > 0 && allRowIds.every((id) => selectedIds.has(id)),
    [allRowIds, selectedIds]
  );

  // Check if some (but not all) rows are selected
  const isSomeSelected = useMemo(
    () => selectedIds.size > 0 && !isAllSelected,
    [selectedIds.size, isAllSelected]
  );

  // Check if all rows in a group are selected
  const isGroupAllSelected = useCallback(
    (groupKey: string) => {
      if (!groupedRowIds) return false;
      const groupIds = groupedRowIds.get(groupKey);
      if (!groupIds || groupIds.length === 0) return false;
      return groupIds.every((id) => selectedIds.has(id));
    },
    [groupedRowIds, selectedIds]
  );

  // Check if some rows in a group are selected
  const isGroupSomeSelected = useCallback(
    (groupKey: string) => {
      if (!groupedRowIds) return false;
      const groupIds = groupedRowIds.get(groupKey);
      if (!groupIds) return false;
      const selectedInGroup = groupIds.filter((id) => selectedIds.has(id));
      return selectedInGroup.length > 0 && selectedInGroup.length < groupIds.length;
    },
    [groupedRowIds, selectedIds]
  );

  return {
    selectedIds,
    toggleSelection,
    selectOnly,
    addToSelection,
    removeFromSelection,
    selectAll,
    selectAllInGroup,
    clearSelection,
    rangeSelect,
    isSelected,
    isAllSelected,
    isSomeSelected,
    isGroupAllSelected,
    isGroupSomeSelected,
    selectedCount: selectedIds.size,
  };
}
