import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { FileContents, FileDiffMetadata } from '@/lib/pierre';
import { parseDiffFromFile } from '@/lib/pierre';

// ---------------------------------------------------------------------------
// Per-hook external store: replaces useState to avoid the
// react-hooks/set-state-in-effect lint rule. useSyncExternalStore bridges
// the async worker callbacks into React without calling setState in effects.
// ---------------------------------------------------------------------------

interface DiffState {
  fileDiff: FileDiffMetadata | null;
  isPending: boolean;
}

const IDLE: DiffState = { fileDiff: null, isPending: false };
const PENDING: DiffState = { fileDiff: null, isPending: true };

function createDiffStore() {
  let state: DiffState = IDLE;
  const listeners = new Set<() => void>();

  function emit() {
    for (const fn of listeners) fn();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot(): DiffState {
      return state;
    },
    setPending() {
      if (state.isPending && state.fileDiff === null) return;
      state = PENDING;
      emit();
    },
    setResult(fileDiff: FileDiffMetadata) {
      state = { fileDiff, isPending: false };
      emit();
    },
    setIdle() {
      if (state === IDLE) return;
      state = IDLE;
      emit();
    },
  };
}

/**
 * Runs parseDiffFromFile() in a Web Worker so the main thread stays responsive.
 *
 * Falls back to synchronous main-thread computation if the worker fails to
 * initialize (e.g. bundler issues, CSP restrictions).
 */
export function useDiffWorker(
  oldFile: FileContents | null,
  newFile: FileContents | null,
): { fileDiff: FileDiffMetadata | null; isPending: boolean } {
  // Stable per-hook store — created once, never changes.
  const storeRef = useRef<ReturnType<typeof createDiffStore>>();
  if (!storeRef.current) storeRef.current = createDiffStore();
  const store = storeRef.current;

  // Track the latest request so we can ignore stale worker responses
  const latestRequestId = useRef(0);

  // Subscribe to the external store — no useState, no setState-in-effect.
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  useEffect(() => {
    if (!oldFile || !newFile) {
      // Invalidate any in-flight request and reset state
      latestRequestId.current++;
      store.setIdle();
      return;
    }

    const requestId = ++latestRequestId.current;
    store.setPending();

    const worker = getSharedWorker();

    if (!worker) {
      // Fallback: run synchronously via microtask to keep effect body clean
      queueMicrotask(() => {
        if (requestId !== latestRequestId.current) return;
        try {
          const result = parseDiffFromFile(oldFile, newFile);
          store.setResult(result);
        } catch {
          store.setIdle();
        }
      });
      return;
    }

    // Send request to worker
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      if (requestId !== latestRequestId.current) return;
      console.warn('[useDiffWorker] Worker timed out after 10s, falling back to main thread');
      try {
        const result = parseDiffFromFile(oldFile, newFile);
        store.setResult(result);
      } catch {
        store.setIdle();
      }
    }, 10_000);

    pendingRequests.set(requestId, {
      resolve(result) {
        clearTimeout(timeoutId);
        if (requestId === latestRequestId.current) {
          store.setResult(result);
        }
      },
      reject() {
        clearTimeout(timeoutId);
        if (requestId !== latestRequestId.current) return;
        // Fallback to synchronous
        try {
          const result = parseDiffFromFile(oldFile, newFile);
          store.setResult(result);
        } catch {
          store.setIdle();
        }
      },
    });

    worker.postMessage({ id: requestId, oldFile, newFile });

    return () => {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestId);
    };
  }, [oldFile, newFile, store]);

  return state;
}

// ---------------------------------------------------------------------------
// Singleton worker + request correlation
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (result: FileDiffMetadata) => void;
  reject: (error: string) => void;
}

const pendingRequests = new Map<number, PendingRequest>();

let sharedWorker: Worker | null | undefined; // undefined = not yet attempted

function getSharedWorker(): Worker | null {
  if (sharedWorker !== undefined) return sharedWorker;

  try {
    const w = new Worker(new URL('../workers/diffWorker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (event: MessageEvent<{ id: number; result?: FileDiffMetadata; error?: string }>) => {
      const { id, result, error } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return; // Stale or already handled
      pendingRequests.delete(id);
      if (error) {
        pending.reject(error);
      } else if (result) {
        pending.resolve(result);
      } else {
        pending.reject('Worker returned empty response');
      }
    };
    w.onerror = (err) => {
      console.error('[useDiffWorker] Worker error:', err);
      // Permanently fall back to synchronous — avoid timeout hangs on
      // every subsequent diff if the worker is broken.
      sharedWorker = null;
      for (const [id, pending] of pendingRequests) {
        pendingRequests.delete(id);
        pending.reject('Worker error');
      }
    };
    sharedWorker = w;
    return w;
  } catch (err) {
    console.warn('[useDiffWorker] Failed to create worker, using synchronous fallback:', err);
    sharedWorker = null;
    return null;
  }
}
