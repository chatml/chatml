/**
 * Web Worker that runs parseDiffFromFile() off the main thread.
 *
 * The side-effect import of pierrePreload ensures themes and language grammars
 * are populated in Pierre's internal Maps before any diff parsing occurs —
 * same as the main thread, but in an isolated worker context.
 */

// Populate Pierre's ResolvedThemes / ResolvedLanguages in this worker context
import '@/lib/pierrePreload';

import { parseDiffFromFile } from '@pierre/diffs';
import type { FileContents, FileDiffMetadata } from '@pierre/diffs';

export interface DiffWorkerRequest {
  id: number;
  oldFile: FileContents;
  newFile: FileContents;
}

export interface DiffWorkerResponse {
  id: number;
  result?: FileDiffMetadata;
  error?: string;
}

self.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const { id, oldFile, newFile } = event.data;
  try {
    const result = parseDiffFromFile(oldFile, newFile);
    self.postMessage({ id, result } satisfies DiffWorkerResponse);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, error } satisfies DiffWorkerResponse);
  }
};
