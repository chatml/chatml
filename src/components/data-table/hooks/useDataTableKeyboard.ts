'use client';

import { useEffect, useCallback, useRef } from 'react';

interface UseDataTableKeyboardProps {
  /** Whether keyboard navigation is enabled */
  enabled?: boolean;
  /** Total number of navigable rows */
  rowCount: number;
  /** Current focused row index */
  focusedIndex: number;
  /** Focus change handler */
  onFocusChange: (index: number) => void;
  /** Toggle selection for focused row */
  onToggleSelection: () => void;
  /** Toggle selection for hovered row (X key) */
  onToggleHoveredSelection?: () => void;
  /** Whether a row is currently being hovered */
  hasHoveredRow?: boolean;
  /** Select all rows */
  onSelectAll: () => void;
  /** Clear selection */
  onClearSelection: () => void;
  /** Action on focused row (Enter key) */
  onAction: () => void;
  /** Open filter (F key) */
  onOpenFilter?: () => void;
  /** Open display options (G key for grouping) */
  onOpenDisplay?: () => void;
  /** Show help dialog */
  onShowHelp?: () => void;
  /** Container ref for scoping keyboard events */
  containerRef: React.RefObject<HTMLElement | null>;
}

interface UseDataTableKeyboardReturn {
  /** Get props to spread on a row for keyboard focus */
  getRowProps: (index: number) => {
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    'data-focused': boolean;
    ref: (el: HTMLElement | null) => void;
  };
  /** Handler for keyboard events on the container */
  handleContainerKeyDown: (e: React.KeyboardEvent) => void;
}

export function useDataTableKeyboard({
  enabled = true,
  rowCount,
  focusedIndex,
  onFocusChange,
  onToggleSelection,
  onToggleHoveredSelection,
  hasHoveredRow = false,
  onSelectAll,
  onClearSelection,
  onAction,
  onOpenFilter,
  onOpenDisplay,
  onShowHelp,
  containerRef,
}: UseDataTableKeyboardProps): UseDataTableKeyboardReturn {
  // Store refs to each row for scrolling into view
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Scroll focused row into view
  const scrollIntoView = useCallback((index: number) => {
    const row = rowRefs.current.get(index);
    if (row) {
      row.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, []);

  // Navigate to a specific row
  const navigateTo = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(rowCount - 1, index));
      onFocusChange(clampedIndex);
      scrollIntoView(clampedIndex);
    },
    [rowCount, onFocusChange, scrollIntoView]
  );

  // Move focus up
  const moveUp = useCallback(() => {
    navigateTo(focusedIndex - 1);
  }, [focusedIndex, navigateTo]);

  // Move focus down
  const moveDown = useCallback(() => {
    navigateTo(focusedIndex + 1);
  }, [focusedIndex, navigateTo]);

  // Move to first row
  const moveToFirst = useCallback(() => {
    navigateTo(0);
  }, [navigateTo]);

  // Move to last row
  const moveToLast = useCallback(() => {
    navigateTo(rowCount - 1);
  }, [rowCount, navigateTo]);

  // Handle keyboard events on the container
  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'k': // Vim-style
          e.preventDefault();
          moveUp();
          break;

        case 'ArrowDown':
        case 'j': // Vim-style
          e.preventDefault();
          moveDown();
          break;

        case 'Home':
          e.preventDefault();
          moveToFirst();
          break;

        case 'End':
          e.preventDefault();
          moveToLast();
          break;

        case 'Enter':
          e.preventDefault();
          onAction();
          break;

        case 'x':
        case 'X':
          // Toggle selection for hovered row (Linear-style)
          e.preventDefault();
          if (onToggleHoveredSelection) {
            onToggleHoveredSelection();
          } else {
            onToggleSelection();
          }
          break;

        case ' ':
          // Space also toggles selection
          e.preventDefault();
          onToggleSelection();
          break;

        case 'a':
          if (e.metaKey || e.ctrlKey) {
            // Cmd+A or Ctrl+A to select all
            e.preventDefault();
            onSelectAll();
          }
          break;

        case 'Escape':
          e.preventDefault();
          onClearSelection();
          break;

        case 'f':
        case 'F':
          if (!e.metaKey && !e.ctrlKey) {
            // F to open filter (not Cmd+F)
            e.preventDefault();
            onOpenFilter?.();
          }
          break;

        case 'g':
        case 'G':
          // G for grouping/display options
          e.preventDefault();
          onOpenDisplay?.();
          break;

        case '?':
          // ? for help
          e.preventDefault();
          onShowHelp?.();
          break;
      }
    },
    [
      enabled,
      moveUp,
      moveDown,
      moveToFirst,
      moveToLast,
      onAction,
      onToggleSelection,
      onToggleHoveredSelection,
      onSelectAll,
      onClearSelection,
      onOpenFilter,
      onOpenDisplay,
      onShowHelp,
    ]
  );

  // Set up global keyboard listener
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      // Allow X key to work when hovering, even without focus
      if ((e.key === 'x' || e.key === 'X') && hasHoveredRow && onToggleHoveredSelection) {
        e.preventDefault();
        onToggleHoveredSelection();
        return;
      }

      // For other keys, only handle if the container or a child is focused
      if (!container.contains(document.activeElement)) {
        return;
      }

      // Convert native event to React-like event
      handleContainerKeyDown(e as unknown as React.KeyboardEvent);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, containerRef, handleContainerKeyDown, hasHoveredRow, onToggleHoveredSelection]);

  // Get props for a row
  const getRowProps = useCallback(
    (index: number) => ({
      tabIndex: index === focusedIndex ? 0 : -1,
      onKeyDown: (e: React.KeyboardEvent) => {
        // Row-specific key handling if needed
        handleContainerKeyDown(e);
      },
      'data-focused': index === focusedIndex,
      ref: (el: HTMLElement | null) => {
        if (el) {
          rowRefs.current.set(index, el);
        } else {
          rowRefs.current.delete(index);
        }
      },
    }),
    [focusedIndex, handleContainerKeyDown]
  );

  return {
    getRowProps,
    handleContainerKeyDown,
  };
}

// Keyboard shortcuts for display in help dialog or tooltips
export const KEYBOARD_SHORTCUTS = [
  { key: '↑/↓ or j/k', description: 'Navigate rows' },
  { key: 'Enter', description: 'Open/action on row' },
  { key: 'X or Space', description: 'Toggle selection' },
  { key: '⌘A', description: 'Select all' },
  { key: 'Escape', description: 'Clear selection' },
  { key: 'F', description: 'Open filter' },
  { key: 'G', description: 'Display options' },
  { key: '?', description: 'Show shortcuts' },
] as const;
