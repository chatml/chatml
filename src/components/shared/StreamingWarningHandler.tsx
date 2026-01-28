'use client';

import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/toast';

interface StreamingWarningDetail {
  source?: string;
  reason?: string;
  message?: string;
}

/**
 * StreamingWarningHandler listens for streaming warnings and displays toast notifications.
 *
 * Rate limiting strategy (layered approach):
 * - Backend Hub: max 1 warning per 5s (prevents flood from broadcast timeout)
 * - Backend Process: no rate limit (emits on every buffer drop, but these are rare)
 * - Frontend (this component): max 1 toast per 10s (final user-facing throttle)
 *
 * The frontend uses a longer debounce to ensure users aren't overwhelmed, while
 * the backend rate limits are tighter to reduce unnecessary network traffic.
 */
export function StreamingWarningHandler() {
  const { warning } = useToast();
  const lastWarningRef = useRef<number>(0);

  useEffect(() => {
    const handleWarning = (event: CustomEvent<StreamingWarningDetail>) => {
      // Debounce warnings - max 1 toast per 10 seconds.
      // This is intentionally longer than the backend rate limit (5s) to provide
      // an additional layer of user experience protection.
      const now = Date.now();
      if (now - lastWarningRef.current < 10000) return;
      lastWarningRef.current = now;

      warning(
        event.detail.message || 'Some streaming data may have been lost',
        'Connection Issue'
      );
    };

    window.addEventListener('streaming-warning', handleWarning as EventListener);
    return () => window.removeEventListener('streaming-warning', handleWarning as EventListener);
  }, [warning]);

  return null;
}
