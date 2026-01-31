'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  watchWorkspace,
  unwatchWorkspace,
  listenForFileChanges,
  type FileChangedEvent,
  sendNotification,
} from '@/lib/tauri';
import { getRepoFileContent } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

/**
 * Hook to watch for file changes in the selected workspace
 * - When a file changes on disk:
 *   - If the file is open in a tab and NOT dirty: reload content
 *   - If the file is open in a tab and IS dirty: show conflict warning
 */
export function useFileWatcher() {
  // Use targeted selectors to prevent re-renders on unrelated store updates
  const selectedWorkspaceId = useAppStore((s) => s.selectedWorkspaceId);
  const workspaces = useAppStore((s) => s.workspaces);
  const fileTabs = useAppStore((s) => s.fileTabs);
  const updateFileTab = useAppStore((s) => s.updateFileTab);
  const { error: showError } = useToast();

  // Track the currently watched workspace to avoid duplicate watches
  const watchedWorkspaceRef = useRef<string | null>(null);

  // Handle file change events
  const handleFileChange = useCallback(async (event: FileChangedEvent) => {
    // Find if this file is open in a tab
    const openTab = fileTabs.find(
      (tab) => tab.workspaceId === event.workspaceId && tab.path === event.path
    );

    if (!openTab) {
      // File is not open, nothing to do
      return;
    }

    // Check if the tab has unsaved changes
    if (openTab.isDirty) {
      // Show conflict warning - don't reload
      sendNotification(
        `${openTab.name} changed on disk`,
        'The file has been modified externally. Your unsaved changes may conflict.'
      );
      console.warn(`File conflict: ${openTab.name} was modified externally but has unsaved changes`);
      return;
    }

    // File is open and not dirty - reload content
    try {
      // Reload the file content
      const response = await getRepoFileContent(event.workspaceId, event.path);

      // Update the tab with new content
      updateFileTab(openTab.id, {
        content: response.content,
        originalContent: response.content,
        isLoading: false,
      });

      // Log that file was reloaded (keeping it subtle since reload is automatic)
      console.log(`File reloaded: ${openTab.name} was modified externally`);
    } catch (error) {
      console.error('Failed to reload file:', error);
    }
  }, [fileTabs, updateFileTab]);

  // Start/stop watching when workspace changes
  useEffect(() => {
    if (!selectedWorkspaceId) {
      // No workspace selected - stop watching if we were
      if (watchedWorkspaceRef.current) {
        unwatchWorkspace(watchedWorkspaceRef.current);
        watchedWorkspaceRef.current = null;
      }
      return;
    }

    const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
    if (!workspace) return;

    // If already watching this workspace, don't restart
    if (watchedWorkspaceRef.current === selectedWorkspaceId) {
      return;
    }

    // Stop watching previous workspace
    if (watchedWorkspaceRef.current) {
      unwatchWorkspace(watchedWorkspaceRef.current);
    }

    // Start watching new workspace
    watchWorkspace(selectedWorkspaceId, workspace.path);
    watchedWorkspaceRef.current = selectedWorkspaceId;

    // Cleanup on unmount
    return () => {
      if (watchedWorkspaceRef.current) {
        unwatchWorkspace(watchedWorkspaceRef.current);
        watchedWorkspaceRef.current = null;
      }
    };
  }, [selectedWorkspaceId, workspaces]);

  // Listen for file change events
  useEffect(() => {
    const cleanupRef = { current: null as (() => void) | null };
    let isMounted = true;

    listenForFileChanges(handleFileChange)
      .then((unlisten) => {
        if (isMounted) {
          cleanupRef.current = unlisten;
        } else {
          // Component unmounted before listener was registered
          // Store for cleanup - the cleanup function will handle it safely
          cleanupRef.current = unlisten;
        }
      })
      .catch((err) => {
        console.error('Failed to initialize file watcher:', err);
        if (isMounted) {
          showError("File watching unavailable. External file changes won't be detected.");
        }
      });

    return () => {
      isMounted = false;
      // Delay cleanup slightly to allow Tauri listener to fully register
      // This prevents "listeners[eventId].handlerId is undefined" errors
      setTimeout(() => {
        try {
          cleanupRef.current?.();
        } catch {
          // Ignore errors if listener cleanup fails
        }
      }, 10);
    };
  }, [handleFileChange, showError]);
}
