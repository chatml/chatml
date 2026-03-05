'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBranchSyncStatus, syncBranch, abortBranchSync, BranchSyncStatusDTO, BranchSyncResultDTO } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Cache TTL in milliseconds (30 seconds)
const SYNC_STATUS_CACHE_TTL = 30_000;

interface UseBranchSyncResult {
  status: BranchSyncStatusDTO | null;
  loading: boolean;
  syncing: boolean;
  aborting: boolean;
  dismissed: boolean;
  conflictFiles: string[];
  lastOperation: 'rebase' | 'merge' | null;
  checkStatus: () => Promise<void>;
  rebase: () => Promise<BranchSyncResultDTO | null>;
  merge: () => Promise<BranchSyncResultDTO | null>;
  abort: () => Promise<void>;
  dismiss: () => void;
  clearConflicts: () => void;
}

/**
 * Hook to manage branch sync status and operations for a session.
 * Includes 30-second caching to avoid repeated fetches.
 */
export function useBranchSync(
  workspaceId: string | null,
  sessionId: string | null
): UseBranchSyncResult {
  const [syncing, setSyncing] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [lastOperation, setLastOperation] = useState<'rebase' | 'merge' | null>(null);

  // Use store for persistent state
  const branchSyncStatus = useAppStore((s) => s.branchSyncStatus);
  const branchSyncLoading = useAppStore((s) => s.branchSyncLoading);
  const branchSyncDismissed = useAppStore((s) => s.branchSyncDismissed);
  const setBranchSyncStatus = useAppStore((s) => s.setBranchSyncStatus);
  const setBranchSyncLoading = useAppStore((s) => s.setBranchSyncLoading);
  const setBranchSyncDismissed = useAppStore((s) => s.setBranchSyncDismissed);
  const setBranchSyncCompletedAt = useAppStore((s) => s.setBranchSyncCompletedAt);

  const status = sessionId ? branchSyncStatus[sessionId] ?? null : null;
  const loading = sessionId ? branchSyncLoading[sessionId] ?? false : false;
  const dismissed = sessionId ? branchSyncDismissed[sessionId] ?? false : false;

  const isMountedRef = useRef(true);
  // Track last check time per session (keyed by sessionId)
  const lastCheckBySessionRef = useRef<Record<string, number>>({});
  // Track sessions that were just synced to skip auto-refresh
  const justSyncedRef = useRef<Set<string>>(new Set());

  // Check sync status (with cache) - stable reference, no status dependency
  const checkStatus = useCallback(async (force = false) => {
    if (!workspaceId || !sessionId) return;

    // Skip network calls when branch sync banner is disabled in settings
    if (!useSettingsStore.getState().branchSyncBanner) return;

    // Skip if this session was just synced (prevents re-fetch after successful sync)
    if (justSyncedRef.current.has(sessionId)) {
      justSyncedRef.current.delete(sessionId);
      return;
    }

    // Check cache TTL per session (unless forced)
    const now = Date.now();
    const lastCheck = lastCheckBySessionRef.current[sessionId] || 0;
    const currentStatus = branchSyncStatus[sessionId];
    if (!force && now - lastCheck < SYNC_STATUS_CACHE_TTL && currentStatus !== null) {
      return;
    }

    setBranchSyncLoading(sessionId, true);

    try {
      const data = await getBranchSyncStatus(workspaceId, sessionId);
      if (isMountedRef.current) {
        setBranchSyncStatus(sessionId, data);
        lastCheckBySessionRef.current[sessionId] = now;
        // Clear dismissed state when new commits are detected
        if (data.behindBy > 0) {
          setBranchSyncDismissed(sessionId, false);
        }
      }
    } catch (err) {
      console.error('Failed to check branch sync status:', err);
    } finally {
      if (isMountedRef.current) {
        setBranchSyncLoading(sessionId, false);
      }
    }
  }, [workspaceId, sessionId, branchSyncStatus, setBranchSyncLoading, setBranchSyncStatus, setBranchSyncDismissed]);

  // Force check (bypasses cache)
  const forceCheck = useCallback(async () => {
    await checkStatus(true);
  }, [checkStatus]);

  // Perform rebase
  const rebase = useCallback(async (): Promise<BranchSyncResultDTO | null> => {
    if (!workspaceId || !sessionId) return null;

    setSyncing(true);
    setLastOperation('rebase');
    setConflictFiles([]);

    try {
      const result = await syncBranch(workspaceId, sessionId, 'rebase');
      if (result.success) {
        // Mark this session as just synced to prevent auto-refresh from showing banner again
        justSyncedRef.current.add(sessionId);
        // Dismiss the banner and clear status
        setBranchSyncDismissed(sessionId, true);
        setBranchSyncStatus(sessionId, { behindBy: 0, commits: [], baseBranch: 'origin/main', lastChecked: new Date().toISOString() });
        // Update the cache time for this session so we don't re-fetch immediately
        lastCheckBySessionRef.current[sessionId] = Date.now();
        // Signal that sync completed so changes panel can refresh
        setBranchSyncCompletedAt(sessionId, Date.now());
      } else if (result.conflictFiles && result.conflictFiles.length > 0) {
        setConflictFiles(result.conflictFiles);
      }
      return result;
    } catch (err) {
      console.error('Rebase failed:', err);
      return null;
    } finally {
      setSyncing(false);
    }
  }, [workspaceId, sessionId, setBranchSyncDismissed, setBranchSyncStatus, setBranchSyncCompletedAt]);

  // Perform merge
  const merge = useCallback(async (): Promise<BranchSyncResultDTO | null> => {
    if (!workspaceId || !sessionId) return null;

    setSyncing(true);
    setLastOperation('merge');
    setConflictFiles([]);

    try {
      const result = await syncBranch(workspaceId, sessionId, 'merge');
      if (result.success) {
        // Mark this session as just synced to prevent auto-refresh from showing banner again
        justSyncedRef.current.add(sessionId);
        // Dismiss the banner and clear status
        setBranchSyncDismissed(sessionId, true);
        setBranchSyncStatus(sessionId, { behindBy: 0, commits: [], baseBranch: 'origin/main', lastChecked: new Date().toISOString() });
        // Update the cache time for this session so we don't re-fetch immediately
        lastCheckBySessionRef.current[sessionId] = Date.now();
        // Signal that sync completed so changes panel can refresh
        setBranchSyncCompletedAt(sessionId, Date.now());
      } else if (result.conflictFiles && result.conflictFiles.length > 0) {
        setConflictFiles(result.conflictFiles);
      }
      return result;
    } catch (err) {
      console.error('Merge failed:', err);
      return null;
    } finally {
      setSyncing(false);
    }
  }, [workspaceId, sessionId, setBranchSyncDismissed, setBranchSyncStatus, setBranchSyncCompletedAt]);

  // Abort in-progress operation
  const abort = useCallback(async () => {
    if (!workspaceId || !sessionId) return;

    setAborting(true);

    try {
      await abortBranchSync(workspaceId, sessionId);
      setConflictFiles([]);
      setLastOperation(null);
      // Refresh status after abort
      await forceCheck();
    } catch (err) {
      console.error('Abort failed:', err);
    } finally {
      setAborting(false);
    }
  }, [workspaceId, sessionId, forceCheck]);

  // Dismiss banner
  const dismiss = useCallback(() => {
    if (sessionId) {
      setBranchSyncDismissed(sessionId, true);
    }
  }, [sessionId, setBranchSyncDismissed]);

  // Clear conflicts
  const clearConflicts = useCallback(() => {
    setConflictFiles([]);
    setLastOperation(null);
  }, []);

  // Effect for mount/unmount tracking
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Re-check when the setting is toggled ON so the banner appears immediately
  const branchSyncBanner = useSettingsStore((s) => s.branchSyncBanner);
  const prevBannerRef = useRef(branchSyncBanner);
  useEffect(() => {
    if (branchSyncBanner && !prevBannerRef.current) {
      checkStatus(true);
    }
    prevBannerRef.current = branchSyncBanner;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchSyncBanner]);

  // Check status on session change only (not on checkStatus change)
  // Deferred via requestIdleCallback so it doesn't block the initial render
  useEffect(() => {
    if (!sessionId) return;

    const scheduleCheck = () => checkStatus();

    // Use requestIdleCallback to defer the network call until the browser is idle,
    // preventing it from blocking the session navigation render.
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(scheduleCheck, { timeout: 8000 });
      return () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(scheduleCheck, 2000);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, workspaceId]);

  return {
    status,
    loading,
    syncing,
    aborting,
    dismissed,
    conflictFiles,
    lastOperation,
    checkStatus: forceCheck,
    rebase,
    merge,
    abort,
    dismiss,
    clearConflicts,
  };
}
