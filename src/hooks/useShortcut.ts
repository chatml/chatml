'use client';

import { useEffect, useCallback } from 'react';
import { getShortcutById, matchesShortcut, type Shortcut } from '@/lib/shortcuts';

/**
 * Hook for registering a keyboard shortcut handler.
 *
 * Uses the centralized shortcuts registry to ensure consistency
 * between the actual handlers and the shortcuts dialog.
 *
 * @param shortcutId - The ID of the shortcut from the registry
 * @param callback - Function to call when the shortcut is triggered
 * @param options - Optional configuration
 */
export function useShortcut(
  shortcutId: string,
  callback: () => void,
  options: {
    /** Whether the shortcut is currently enabled (default: true) */
    enabled?: boolean;
    /** Use capture phase for event handling (default: false) */
    capture?: boolean;
  } = {}
): void {
  const { enabled = true, capture = false } = options;

  // Validate shortcut ID at setup time, not on every keydown
  const shortcut = getShortcutById(shortcutId);

  useEffect(() => {
    if (!shortcut) {
      console.warn(`useShortcut: Unknown shortcut ID "${shortcutId}"`);
    }
  }, [shortcutId, shortcut]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !shortcut) return;

      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        callback();
      }
    },
    [shortcut, callback, enabled]
  );

  useEffect(() => {
    if (!enabled || !shortcut) return;

    document.addEventListener('keydown', handleKeyDown, capture);
    return () => document.removeEventListener('keydown', handleKeyDown, capture);
  }, [handleKeyDown, enabled, capture, shortcut]);
}

/**
 * Hook for registering multiple keyboard shortcuts at once.
 *
 * IMPORTANT: The `shortcuts` parameter should be memoized (e.g., with useMemo)
 * to avoid re-registering event listeners on every render.
 *
 * @example
 * const shortcuts = useMemo(() => ({
 *   'commandPalette': () => setOpen(true),
 *   'filePicker': () => setFileOpen(true),
 * }), []);
 * useShortcuts(shortcuts);
 *
 * @param shortcuts - Map of shortcut IDs to their callbacks (should be memoized)
 * @param options - Optional configuration
 */
export function useShortcuts(
  shortcuts: Record<string, () => void>,
  options: {
    enabled?: boolean;
    capture?: boolean;
  } = {}
): void {
  const { enabled = true, capture = false } = options;

  // Validate shortcut IDs at setup time, not on every keydown
  const shortcutIds = Object.keys(shortcuts);
  useEffect(() => {
    for (const shortcutId of shortcutIds) {
      if (!getShortcutById(shortcutId)) {
        console.warn(`useShortcuts: Unknown shortcut ID "${shortcutId}"`);
      }
    }
  }, [shortcutIds]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      for (const [shortcutId, callback] of Object.entries(shortcuts)) {
        const shortcut = getShortcutById(shortcutId);
        if (!shortcut) continue;

        if (matchesShortcut(event, shortcut)) {
          event.preventDefault();
          callback();
          return; // Only trigger one shortcut per event
        }
      }
    },
    [shortcuts, enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown, capture);
    return () => document.removeEventListener('keydown', handleKeyDown, capture);
  }, [handleKeyDown, enabled, capture]);
}

/**
 * Hook for handling a shortcut with a custom matching function.
 * Use this when you need more control than the registry provides.
 *
 * @param shortcut - The shortcut definition (can be from registry or custom)
 * @param callback - Function to call when the shortcut is triggered
 * @param options - Optional configuration
 */
export function useCustomShortcut(
  shortcut: Shortcut,
  callback: () => void,
  options: {
    enabled?: boolean;
    capture?: boolean;
  } = {}
): void {
  const { enabled = true, capture = false } = options;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      if (matchesShortcut(event, shortcut)) {
        event.preventDefault();
        callback();
      }
    },
    [shortcut, callback, enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown, capture);
    return () => document.removeEventListener('keydown', handleKeyDown, capture);
  }, [handleKeyDown, enabled, capture]);
}
