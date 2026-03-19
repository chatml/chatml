'use client';

import { WorkerPoolContextProvider, PIERRE_THEMES } from '@/lib/pierre';
import { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * Worker factory that catches creation failures.
 * The new URL() + Worker pattern depends on the bundler resolving the asset
 * path at build time. If this fails in production (e.g. Tauri asset protocol
 * issues), we return a dummy worker that immediately closes itself — Pierre's
 * WorkerPoolManager will set workersFailed = true and fall back to sync
 * tokenization.
 */
function createWorker(): Worker {
  try {
    return new Worker(
      new URL('@pierre/diffs/worker/worker-portable.js', import.meta.url),
      { type: 'module' },
    );
  } catch (e) {
    console.warn('[Pierre] Worker creation failed, will fall back to sync tokenization:', e);
    // Return a minimal stub that Pierre's pool manager can detect as failed
    const blob = new Blob(['self.close()'], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }
}

// Stable references — defined outside the component so they survive remounts
// and WorkerPoolContextProvider doesn't re-create the pool on every render.
const poolOptions = {
  workerFactory: createWorker,
  poolSize: 2,
};

const highlighterOptions = {
  theme: PIERRE_THEMES,
  tokenizeMaxLineLength: 500,
  lineDiffType: 'word' as const,
};

/**
 * Error boundary that catches worker pool initialization failures
 * and falls back to rendering children without the pool (synchronous tokenization).
 */
class WorkerPoolErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[Pierre] Worker pool provider failed, falling back to main-thread tokenization:', error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.children;
    }
    return this.props.children;
  }
}

/**
 * Initializes Pierre's built-in Web Worker pool for Shiki syntax tokenization.
 *
 * Without this provider, Pierre tokenizes every line synchronously on the main
 * thread — which blocks the UI for 30+ seconds on large files.
 *
 * Wrapped in an error boundary so failures in production gracefully fall back
 * to synchronous tokenization instead of crashing the UI.
 */
export function PierreWorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolErrorBoundary>
      <WorkerPoolContextProvider
        poolOptions={poolOptions}
        highlighterOptions={highlighterOptions}
      >
        {children}
      </WorkerPoolContextProvider>
    </WorkerPoolErrorBoundary>
  );
}
