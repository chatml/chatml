'use client';

import { useEffect } from 'react';
import { getSessionFileContent, type FileChangeDTO } from '@/lib/api';
import { getFileContentFromCache, setFileContentInCache } from '@/lib/fileContentCache';
import { isBinaryFile } from '@/lib/fileUtils';

const PREFETCH_LIMIT = 10;
const BATCH_SIZE = 3;

/**
 * Prefetch file content for the top N changed files during idle time so
 * they're cached by the time the user clicks them. Follows the same
 * idle-callback + batch pattern as useDiffPrefetch.
 */
export function useFileContentPrefetch(
  workspaceId: string | null,
  sessionId: string | null,
  changes: FileChangeDTO[] | null,
) {
  useEffect(() => {
    if (!workspaceId || !sessionId || !changes || changes.length === 0) return;

    // Narrowed to string by the guard above — avoids non-null assertions later
    const wId = workspaceId;
    const sId = sessionId;

    const ac = new AbortController();

    const filesToPrefetch = changes
      .filter(f => f.status !== 'deleted')
      .filter(f => !isBinaryFile(f.path.split('/').pop() || f.path))
      .filter(f => !getFileContentFromCache(wId, sId, f.path))
      .slice(0, PREFETCH_LIMIT);

    if (filesToPrefetch.length === 0) return;

    async function prefetch() {
      for (let i = 0; i < filesToPrefetch.length; i += BATCH_SIZE) {
        if (ac.signal.aborted) return;

        const batch = filesToPrefetch.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map(async (file) => {
            if (ac.signal.aborted) return;
            // Re-check cache (may have been populated by user action)
            if (getFileContentFromCache(wId, sId, file.path)) return;
            try {
              const fileData = await getSessionFileContent(wId, sId, file.path, ac.signal);
              if (!ac.signal.aborted) {
                setFileContentInCache(wId, sId, file.path, fileData);
              }
            } catch {
              // Silently ignore — user will fetch on demand
            }
          })
        );

        // Yield to main thread between batches
        if (i + BATCH_SIZE < filesToPrefetch.length) {
          await new Promise<void>((resolve) => {
            if (typeof requestIdleCallback === 'function') {
              requestIdleCallback(() => resolve(), { timeout: 3000 });
            } else {
              setTimeout(resolve, 200);
            }
          });
        }
      }
    }

    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => { prefetch(); }, { timeout: 5000 });
    } else {
      timeoutHandle = setTimeout(() => { prefetch(); }, 2000);
    }

    return () => {
      ac.abort();
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, [workspaceId, sessionId, changes]);
}
