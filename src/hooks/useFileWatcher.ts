'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  startFileWatcher,
  stopFileWatcher,
  listenForFileChanges,
  type FileChangedEvent,
  sendNotification,
} from '@/lib/tauri';
import { getRepoFileContent, getWorkspacesBasePath } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

/**
 * Global file watcher coordinator hook.
 *
 * Responsibilities:
 * 1. Start the single global file watcher on mount (fetches base path from backend)
 * 2. Register ONE Tauri event listener that writes to the Zustand store
 * 3. React to file change events for dirty-tab / reload logic
 * 4. Stop the watcher on unmount
 *
 * The Rust watcher batches file change events per workspace (one IPC call per workspace
 * per debounce window) to avoid flooding the WebView event loop.
 *
 * Other hooks (useGitStatus, ChangesPanel) subscribe to `lastFileChange` in the
 * store instead of registering their own Tauri listeners.
 */
export function useFileWatcher() {
  const setLastFileChange = useAppStore((s) => s.setLastFileChange);
  const { error: showError } = useToast();

  // Track whether we've started the global watcher
  const watcherStartedRef = useRef(false);

  // Handle file change events — check open tabs for conflicts/reloads.
  // Reads fileTabs from the store directly to always get the latest state,
  // avoiding stale closures when the Tauri listener outlives a render cycle.
  const handleFileChange = useCallback(async (event: FileChangedEvent) => {
    const { fileTabs, updateFileTab } = useAppStore.getState();

    // Determine which file paths to check for tab conflicts
    const filesToCheck = event.files ?? [{ path: event.path, fullPath: event.fullPath }];

    for (const file of filesToCheck) {
      // Find if this file is open in a tab
      const openTab = fileTabs.find(
        (tab) => tab.workspaceId === event.workspaceId && tab.path === file.path
      );

      if (!openTab) continue;

      if (openTab.isDirty) {
        // Show conflict warning — don't reload
        sendNotification(
          `${openTab.name} changed on disk`,
          'The file has been modified externally. Your unsaved changes may conflict.'
        );
        console.warn(`File conflict: ${openTab.name} was modified externally but has unsaved changes`);
        continue;
      }

      // File is open and not dirty — reload content
      try {
        const response = await getRepoFileContent(event.workspaceId, file.path);
        updateFileTab(openTab.id, {
          content: response.content,
          originalContent: response.content,
          isLoading: false,
        });
        console.log(`File reloaded: ${openTab.name} was modified externally`);
      } catch (error) {
        console.error('Failed to reload file:', error);
      }
    }
  }, []);

  // Start global watcher once on mount
  useEffect(() => {
    let isMounted = true;

    async function initWatcher() {
      if (watcherStartedRef.current) return;

      try {
        const basePath = await getWorkspacesBasePath();
        if (!isMounted) return;

        // createIfNeeded=true: the default path may not exist yet on first launch
        const started = await startFileWatcher(basePath, true);
        if (started && isMounted) {
          watcherStartedRef.current = true;
          console.log('Global file watcher started on:', basePath);
        }
      } catch (err) {
        console.error('Failed to start global file watcher:', err);
      }
    }

    initWatcher();

    return () => {
      isMounted = false;
      if (watcherStartedRef.current) {
        stopFileWatcher();
        watcherStartedRef.current = false;
      }
    };
  // Empty deps: the watcher lifecycle is app-scoped (start once on mount, stop on unmount).
  // We intentionally don't re-run when basePath could change — SettingsPage handles that separately.
  }, []);

  // Register single Tauri event listener → store + tab conflict handling
  useEffect(() => {
    const cleanupRef = { current: null as (() => void) | null };
    let isMounted = true;

    const onFileChange = (event: FileChangedEvent) => {
      // Write to store so other hooks (useGitStatus, ChangesPanel) can react.
      // The Rust watcher already batches events per workspace, so this fires
      // at most once per workspace per debounce window (~2 seconds).
      setLastFileChange(event);
      // Handle tab conflicts/reloads for all files in the batch
      handleFileChange(event);
    };

    listenForFileChanges(onFileChange)
      .then((unlisten) => {
        cleanupRef.current = unlisten;
      })
      .catch((err) => {
        console.error('Failed to initialize file watcher listener:', err);
        if (isMounted) {
          showError("File watching unavailable. External file changes won't be detected.");
        }
      });

    return () => {
      isMounted = false;
      try {
        cleanupRef.current?.();
      } catch {
        // Ignore errors if listener cleanup fails
      }
    };
  }, [handleFileChange, setLastFileChange, showError]);
}
