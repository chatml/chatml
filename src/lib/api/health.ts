import { getApiBase } from './base';
import { HEALTH_CHECK_REQUEST_TIMEOUT_MS } from '@/lib/constants';
import { getBackendPort } from '@/lib/backend-port';

export interface HealthCheckResult {
  success: boolean;
  error?: string;
  attempts: number;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check backend health with exponential backoff retry
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelay Initial delay in ms (doubles each retry)
 * @param onAttempt Callback called before each attempt with attempt number
 */
export async function checkHealthWithRetry(
  maxRetries: number = 10,
  initialDelay: number = 500,
  onAttempt?: (attempt: number) => void
): Promise<HealthCheckResult> {
  // Ensure we have the backend port before making health checks
  // This is especially important for Tauri builds with dynamic port allocation
  await getBackendPort();

  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    onAttempt?.(attempt);

    try {
      const res = await fetch(`${getApiBase()}/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_REQUEST_TIMEOUT_MS)
      });

      if (res.ok) {
        return { success: true, attempts: attempt };
      }
    } catch {
      // Connection failed, will retry
    }

    // Don't wait after the last attempt
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 5000); // Exponential backoff, max 5s
    }
  }

  return {
    success: false,
    error: 'Backend service did not respond after multiple attempts',
    attempts: maxRetries
  };
}
