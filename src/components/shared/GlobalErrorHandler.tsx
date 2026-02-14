'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';

/**
 * Global error handler that catches unhandled errors and promise rejections.
 * Surfaces them via the toast system so users see actionable feedback.
 */

// Errors to silently ignore (benign browser/library noise)
const BENIGN_ERROR_PATTERNS = [
  'ResizeObserver loop',
  'Loading chunk',
  'Failed to fetch',
  'AbortError',
  'The operation was aborted',
  'NotAllowedError',
];

function isBenignError(message: string): boolean {
  return BENIGN_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

// Debounce duplicate error toasts (same message within 5 seconds)
const recentErrors = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000;

function shouldShowError(message: string): boolean {
  const now = Date.now();
  const lastShown = recentErrors.get(message);
  if (lastShown && now - lastShown < DEDUP_WINDOW_MS) {
    return false;
  }
  recentErrors.set(message, now);
  // Clean old entries
  for (const [key, time] of recentErrors) {
    if (now - time > DEDUP_WINDOW_MS) {
      recentErrors.delete(key);
    }
  }
  return true;
}

export function GlobalErrorHandler() {
  const { error: showError } = useToast();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const message = event.message || 'An unexpected error occurred';
      if (isBenignError(message)) return;
      if (!shouldShowError(message)) return;

      console.error('[GlobalErrorHandler] Uncaught error:', event.error || message);
      showError(message, 'Unexpected Error');
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'An unhandled promise rejection occurred';

      if (isBenignError(message)) return;
      if (!shouldShowError(message)) return;

      console.error('[GlobalErrorHandler] Unhandled rejection:', reason);
      showError(message, 'Unexpected Error');
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [showError]);

  return null;
}
