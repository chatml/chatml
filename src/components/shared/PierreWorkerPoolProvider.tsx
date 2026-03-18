'use client';

import { WorkerPoolContextProvider } from '@/lib/pierre';
import type { ReactNode } from 'react';

const PIERRE_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

/**
 * Initializes Pierre's built-in Web Worker pool for Shiki syntax tokenization.
 *
 * Without this provider, Pierre tokenizes every line synchronously on the main
 * thread — which blocks the UI for 10-30 seconds on large diffs.
 *
 * Uses `worker-portable.js`, a fully self-contained bundle (no external imports,
 * no WASM) that works in Tauri's asset protocol.
 */
export function PierreWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () =>
          new Worker(
            new URL('@pierre/diffs/worker/worker-portable.js', import.meta.url),
            { type: 'module' },
          ),
        poolSize: 2,
      }}
      highlighterOptions={{
        theme: PIERRE_THEMES,
        tokenizeMaxLineLength: 500,
        lineDiffType: 'word',
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
