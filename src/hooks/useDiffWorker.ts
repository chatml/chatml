import { useState, useEffect, useRef } from 'react';
import type { FileContents, FileDiffMetadata } from '@/lib/pierre';
import { parseDiffFromFile } from '@/lib/pierre';

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
  const [fileDiff, setFileDiff] = useState<FileDiffMetadata | null>(null);
  const [isPending, setIsPending] = useState(false);
  // Track the latest request so we can ignore stale worker responses
  const latestRequestId = useRef(0);

  useEffect(() => {
    if (!oldFile || !newFile) {
      setFileDiff(null);
      setIsPending(false);
      return;
    }

    const requestId = ++latestRequestId.current;
    setIsPending(true);

    const worker = getSharedWorker();

    if (!worker) {
      // Fallback: run synchronously on main thread
      try {
        const result = parseDiffFromFile(oldFile, newFile);
        if (requestId === latestRequestId.current) {
          setFileDiff(result);
          setIsPending(false);
        }
      } catch {
        if (requestId === latestRequestId.current) {
          setIsPending(false);
        }
      }
      return;
    }

    // Send request to worker
    const pending = pendingRequests;
    const timeoutId = setTimeout(() => {
      // Timeout — fall back to synchronous computation
      pending.delete(requestId);
      if (requestId !== latestRequestId.current) return;
      console.warn('[useDiffWorker] Worker timed out after 10s, falling back to main thread');
      try {
        const result = parseDiffFromFile(oldFile, newFile);
        setFileDiff(result);
      } catch {
        // Silently fail — component will show no diff
      }
      setIsPending(false);
    }, 10_000);

    pending.set(requestId, {
      resolve(result) {
        clearTimeout(timeoutId);
        if (requestId === latestRequestId.current) {
          setFileDiff(result);
          setIsPending(false);
        }
      },
      reject() {
        clearTimeout(timeoutId);
        if (requestId !== latestRequestId.current) return;
        // Fallback to synchronous
        try {
          const result = parseDiffFromFile(oldFile, newFile);
          setFileDiff(result);
        } catch {
          // Silently fail
        }
        setIsPending(false);
      },
    });

    worker.postMessage({ id: requestId, oldFile, newFile });

    return () => {
      // Cleanup: mark this request as stale
      clearTimeout(timeoutId);
      pending.delete(requestId);
    };
  }, [oldFile, newFile]);

  return { fileDiff, isPending };
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
      // Permanently fall back to synchronous — avoid 60s timeout hangs on
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
