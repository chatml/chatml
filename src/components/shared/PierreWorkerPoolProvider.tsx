'use client';

import { WorkerPoolContextProvider, PIERRE_THEMES } from '@/lib/pierre';
import type { ReactNode } from 'react';

// Stable references — defined outside the component so they survive remounts
// and WorkerPoolContextProvider doesn't re-create the pool on every render.
const poolOptions = {
  workerFactory: () =>
    new Worker(
      new URL('@pierre/diffs/worker/worker-portable.js', import.meta.url),
      { type: 'module' },
    ),
  poolSize: 2,
};

const highlighterOptions = {
  theme: PIERRE_THEMES,
  tokenizeMaxLineLength: 500,
  lineDiffType: 'word' as const,
};

/**
 * Initializes Pierre's built-in Web Worker pool for Shiki syntax tokenization.
 *
 * Without this provider, Pierre tokenizes every line synchronously on the main
 * thread — which blocks the UI for 30+ seconds on large files.
 *
 * Uses worker-portable.js, a fully self-contained bundle (no external imports,
 * no WASM) that works in Tauri's asset protocol. The WorkerPoolManager on the
 * main thread resolves languages from ResolvedLanguages (pre-populated by
 * pierrePreload.ts) and sends the resolved grammar data to workers via
 * postMessage — workers never need bundledLanguages.
 */
export function PierreWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
