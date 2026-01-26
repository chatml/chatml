'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { listFileTabs, saveFileTabs, FileTabDTO, getApiBase } from '@/lib/api';
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
    selectedSessionId,
    fileTabs,
    setFileTabs,
    selectedFileTabId,
    selectFileTab,
  } = useAppStore();

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');
  const isLoadingRef = useRef(false);

  // Load tabs when workspace or session changes
  // Tabs are stored at workspace level but filtered by session on load
  useEffect(() => {
    if (!selectedWorkspaceId || !selectedSessionId) return;

    const loadTabs = async () => {
      isLoadingRef.current = true;
      try {
        const savedTabs = await listFileTabs(selectedWorkspaceId);

        // Convert DTOs to FileTab objects, filtering by current session
        // Per migration decision: tabs without sessionId are auto-closed (filtered out)
        const sessionTabs: FileTab[] = savedTabs
          .filter((dto): dto is FileTabDTO & { sessionId: string } =>
            dto.sessionId === selectedSessionId
          )
          .map((dto) => ({
            id: dto.id,
            workspaceId: dto.workspaceId,
            sessionId: dto.sessionId,
            path: dto.path,
            name: dto.path.split('/').pop() || dto.path,
            viewMode: dto.viewMode as 'file' | 'diff',
            isPinned: dto.isPinned,
            openedAt: dto.openedAt,
            lastAccessedAt: dto.lastAccessedAt,
            // Content will be loaded on demand when tab is selected
            isLoading: false,
          }));

        // Preserve tabs from other sessions that may be in memory
        // This prevents losing unsaved tab state when switching sessions
        // Use getState() to avoid stale closure issues
        const currentFileTabs = useAppStore.getState().fileTabs;
        const otherSessionTabs = currentFileTabs.filter(
          (t) => t.workspaceId === selectedWorkspaceId && t.sessionId !== selectedSessionId
        );

        setFileTabs([...otherSessionTabs, ...sessionTabs]);

        // Update last saved reference to prevent immediate save
        // Note: We save ALL workspace tabs, but only load session-specific ones
        lastSavedRef.current = JSON.stringify(
          savedTabs.sort((a, b) => a.id.localeCompare(b.id))
        );

        // Only auto-select the first tab on initial session load
        // Use useAppStore.getState() to get current value without stale closure
        const currentSelectedTabId = useAppStore.getState().selectedFileTabId;
        if (currentSelectedTabId === null && sessionTabs.length > 0) {
          selectFileTab(sessionTabs[0].id);
        }
      } catch (err) {
        console.error('Failed to load tabs:', err);
      } finally {
        isLoadingRef.current = false;
      }
    };

    loadTabs();
    // Re-run when session changes to load that session's tabs
  }, [selectedWorkspaceId, selectedSessionId, setFileTabs, selectFileTab]);

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
      const url = `${getApiBase()}/api/repos/${selectedWorkspaceId}/tabs`;
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
