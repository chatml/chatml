'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { listFileTabs, saveFileTabs, FileTabDTO, API_BASE } from '@/lib/api';
import type { FileTab } from '@/lib/types';

// Debounce delay for saving tabs (ms)
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Hook that handles persisting file tabs to the backend
 * - Loads tabs when workspace changes
 * - Saves tabs with debouncing when they change
 */
export function useTabPersistence() {
  const {
    selectedWorkspaceId,
    fileTabs,
    setFileTabs,
    selectedFileTabId,
    selectFileTab,
  } = useAppStore();

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');
  const isLoadingRef = useRef(false);

  // Load tabs when workspace changes
  useEffect(() => {
    if (!selectedWorkspaceId) return;

    const loadTabs = async () => {
      isLoadingRef.current = true;
      try {
        const savedTabs = await listFileTabs(selectedWorkspaceId);

        if (savedTabs.length > 0) {
          // Convert DTOs to FileTab objects
          const tabs: FileTab[] = savedTabs.map((dto) => ({
            id: dto.id,
            workspaceId: dto.workspaceId,
            sessionId: dto.sessionId || undefined,
            path: dto.path,
            name: dto.path.split('/').pop() || dto.path,
            viewMode: dto.viewMode as 'file' | 'diff',
            isPinned: dto.isPinned,
            openedAt: dto.openedAt,
            lastAccessedAt: dto.lastAccessedAt,
            // Content will be loaded on demand when tab is selected
            isLoading: false,
          }));

          setFileTabs(tabs);

          // Update last saved reference to prevent immediate save
          lastSavedRef.current = JSON.stringify(
            tabs.map(tabToDTO).sort((a, b) => a.id.localeCompare(b.id))
          );

          // Select the first tab if none is selected
          if (!selectedFileTabId && tabs.length > 0) {
            selectFileTab(tabs[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load tabs:', err);
      } finally {
        isLoadingRef.current = false;
      }
    };

    loadTabs();
  }, [selectedWorkspaceId, setFileTabs, selectFileTab, selectedFileTabId]);

  // Save tabs when they change (debounced)
  const saveTabs = useCallback(async () => {
    if (!selectedWorkspaceId || isLoadingRef.current) return;

    // Only save tabs for the current workspace
    const workspaceTabs = fileTabs.filter(
      (t) => t.workspaceId === selectedWorkspaceId
    );

    // Convert to DTOs
    const tabDTOs = workspaceTabs.map(tabToDTO);

    // Check if anything changed
    const currentJson = JSON.stringify(
      tabDTOs.sort((a, b) => a.id.localeCompare(b.id))
    );
    if (currentJson === lastSavedRef.current) {
      return;
    }

    try {
      await saveFileTabs(selectedWorkspaceId, tabDTOs);
      lastSavedRef.current = currentJson;
    } catch (err) {
      console.error('Failed to save tabs:', err);
    }
  }, [selectedWorkspaceId, fileTabs]);

  // Debounced save effect
  useEffect(() => {
    if (!selectedWorkspaceId || isLoadingRef.current) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule save
    saveTimeoutRef.current = setTimeout(saveTabs, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [fileTabs, selectedWorkspaceId, saveTabs]);

  // Use beforeunload event to ensure tabs are saved before window closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Synchronously save tabs using navigator.sendBeacon if available
      // This is more reliable than async save during unmount
      if (!selectedWorkspaceId || isLoadingRef.current) return;

      const workspaceTabs = fileTabs.filter(
        (t) => t.workspaceId === selectedWorkspaceId
      );
      const tabDTOs = workspaceTabs.map(tabToDTO);

      // Use sendBeacon for reliable delivery during page unload
      const url = `${API_BASE}/api/repos/${selectedWorkspaceId}/tabs`;
      const data = JSON.stringify({ tabs: tabDTOs });
      navigator.sendBeacon(url, data);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Clear pending save timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Fire off save but don't wait for it
        saveTabs();
      }
    };
  }, [saveTabs, selectedWorkspaceId, fileTabs]);
}

// Convert FileTab to FileTabDTO for API
function tabToDTO(tab: FileTab): FileTabDTO {
  return {
    id: tab.id,
    workspaceId: tab.workspaceId,
    sessionId: tab.sessionId,
    path: tab.path,
    viewMode: tab.viewMode || 'file',
    isPinned: tab.isPinned || false,
    position: 0, // Will be set by order in array
    openedAt: tab.openedAt || new Date().toISOString(),
    lastAccessedAt: tab.lastAccessedAt || new Date().toISOString(),
  };
}
