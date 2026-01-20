'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { saveFile } from '@/lib/api';
import type { FileTab } from '@/lib/types';

// Auto-save delay in milliseconds (30 seconds after last change)
const AUTO_SAVE_DELAY_MS = 30000;

/**
 * Hook that handles auto-saving dirty file tabs
 * - Auto-saves after 30 seconds of inactivity
 * - Provides manual save function for Cmd+S
 * - Updates tab state after save (clears dirty flag)
 */
export function useAutoSave() {
  const { fileTabs, selectedFileTabId, updateFileTab } = useAppStore();
  const saveTimeoutRef = useRef<Record<string, NodeJS.Timeout>>({});
  const mountedRef = useRef(true);

  // Track mounted state to prevent state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Get the currently selected tab
  const selectedTab = fileTabs.find((t) => t.id === selectedFileTabId);

  // Save a specific tab
  const saveTab = useCallback(
    async (tab: FileTab): Promise<boolean> => {
      if (!tab.isDirty || !tab.content || tab.viewMode === 'diff') {
        return false;
      }

      try {
        await saveFile(tab.workspaceId, tab.path, tab.content, tab.sessionId);

        // Only update tab state if component is still mounted
        if (mountedRef.current) {
          updateFileTab(tab.id, {
            originalContent: tab.content,
            isDirty: false,
          });
        }

        return true;
      } catch (err) {
        console.error('Failed to save file:', err);
        return false;
      }
    },
    [updateFileTab]
  );

  // Save the currently selected tab (for Cmd+S)
  const saveCurrentTab = useCallback(async (): Promise<boolean> => {
    if (!selectedTab) {
      return false;
    }
    return saveTab(selectedTab);
  }, [selectedTab, saveTab]);

  // Auto-save effect for dirty tabs.
  // Each dirty tab gets its own timeout. If multiple tabs become dirty simultaneously,
  // they'll all trigger saves around the same time after AUTO_SAVE_DELAY_MS. This is
  // acceptable because: 1) saves are independent and non-blocking, 2) it's rare for users
  // to make simultaneous changes to many files, 3) batching would add complexity and delay
  // saves for the first changed file. If burst saves become a problem, consider batching.
  useEffect(() => {
    const dirtyTabs = fileTabs.filter((t) => t.isDirty && t.viewMode !== 'diff');

    // Set up auto-save timers for dirty tabs
    dirtyTabs.forEach((tab) => {
      // Clear existing timer for this tab
      if (saveTimeoutRef.current[tab.id]) {
        clearTimeout(saveTimeoutRef.current[tab.id]);
      }

      // Schedule auto-save
      saveTimeoutRef.current[tab.id] = setTimeout(() => {
        saveTab(tab);
        delete saveTimeoutRef.current[tab.id];
      }, AUTO_SAVE_DELAY_MS);
    });

    // Clean up timers for tabs that are no longer dirty
    Object.keys(saveTimeoutRef.current).forEach((tabId) => {
      const tab = fileTabs.find((t) => t.id === tabId);
      if (!tab || !tab.isDirty) {
        clearTimeout(saveTimeoutRef.current[tabId]);
        delete saveTimeoutRef.current[tabId];
      }
    });

    // Cleanup on unmount
    return () => {
      Object.values(saveTimeoutRef.current).forEach((timeout) =>
        clearTimeout(timeout)
      );
    };
  }, [fileTabs, saveTab]);

  // Save all dirty tabs immediately (for app unmount/workspace switch)
  const saveAllDirty = useCallback(async (): Promise<void> => {
    const dirtyTabs = fileTabs.filter((t) => t.isDirty && t.viewMode !== 'diff');
    await Promise.all(dirtyTabs.map(saveTab));
  }, [fileTabs, saveTab]);

  return {
    saveCurrentTab,
    saveTab,
    saveAllDirty,
    hasDirtyTabs: fileTabs.some((t) => t.isDirty),
  };
}
