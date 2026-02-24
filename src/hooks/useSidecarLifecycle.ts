'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { safeListen, restartSidecar, isTauri } from '@/lib/tauri';
import { clearBackendPortCache } from '@/lib/backend-port';
import { clearAuthTokenCache, initAuthToken } from '@/lib/auth-token';
import { checkHealthWithRetry, initBackendPort } from '@/lib/api';

interface SidecarRestartingPayload {
  attempt: number;
  max_attempts: number;
}

interface SidecarRestartFailedPayload {
  attempt: number;
  error: string;
}

/**
 * Listens for sidecar lifecycle events from Tauri and coordinates
 * frontend recovery (cache clearing, health checks, WebSocket reconnect).
 *
 * Mount once at the app root alongside useWebSocket.
 */
export function useSidecarLifecycle(onReconnectWebSocket: () => void) {
  const reconnectRef = useRef(onReconnectWebSocket);
  reconnectRef.current = onReconnectWebSocket;

  const handleRecovery = useCallback(async () => {
    // Clear cached port and auth token so the frontend re-fetches from Tauri IPC
    clearBackendPortCache();
    clearAuthTokenCache();

    try {
      // Wait for the new backend port to be available via Tauri IPC
      await initBackendPort();
      await initAuthToken();

      // Confirm the backend is healthy before declaring success
      const health = await checkHealthWithRetry(10, 500);
      if (!health.success) {
        console.error('Sidecar restarted but health check failed');
        useConnectionStore.getState().setSidecarFailed();
        return;
      }

      // Reset the Rust-side restart counter
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('reset_sidecar_restart_count');
      }

      useConnectionStore.getState().setSidecarRunning();

      // Trigger WebSocket reconnection now that backend is healthy
      reconnectRef.current();
    } catch (e) {
      console.error('Sidecar recovery failed:', e);
      useConnectionStore.getState().setSidecarFailed();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    async function setupListeners() {
      // Sidecar is being restarted (attempt N of M)
      const u1 = await safeListen<SidecarRestartingPayload>('sidecar-restarting', (payload) => {
        console.log(`[sidecar] Restarting (attempt ${payload.attempt}/${payload.max_attempts})`);
        useConnectionStore.getState().setSidecarRestarting(payload.attempt, payload.max_attempts);
      });
      if (cancelled) { u1(); return; }
      unlisteners.push(u1);

      // Sidecar restarted successfully — run recovery
      const u2 = await safeListen<void>('sidecar-restarted', () => {
        console.log('[sidecar] Restarted successfully, running recovery...');
        handleRecovery();
      });
      if (cancelled) { u2(); unlisteners.forEach(fn => fn()); return; }
      unlisteners.push(u2);

      // A single restart attempt failed (more may follow)
      const u3 = await safeListen<SidecarRestartFailedPayload>('sidecar-restart-failed', (payload) => {
        console.error(`[sidecar] Restart attempt ${payload.attempt} failed: ${payload.error}`);
        // Don't set failed yet — the Rust side may retry with the next attempt
      });
      if (cancelled) { u3(); unlisteners.forEach(fn => fn()); return; }
      unlisteners.push(u3);

      // All restart attempts exhausted
      const u4 = await safeListen<void>('sidecar-restart-exhausted', () => {
        console.error('[sidecar] All restart attempts exhausted');
        useConnectionStore.getState().setSidecarFailed();
      });
      if (cancelled) { u4(); unlisteners.forEach(fn => fn()); return; }
      unlisteners.push(u4);
    }

    setupListeners();

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [handleRecovery]);

  /** Manual restart (used by the "Restart Manually" button) */
  const manualRestart = useCallback(async () => {
    // Reset the Rust-side restart counter first so auto-restart can
    // kick in if the sidecar crashes again after this manual restart.
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('reset_sidecar_restart_count');
      } catch (e) {
        console.warn('Failed to reset sidecar restart count:', e);
      }
    }

    useConnectionStore.getState().setSidecarRestarting(1);
    const ok = await restartSidecar();
    if (ok) {
      await handleRecovery();
    } else {
      useConnectionStore.getState().setSidecarFailed();
    }
  }, [handleRecovery]);

  return { manualRestart };
}
