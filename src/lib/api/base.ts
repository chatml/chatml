import { getAuthToken } from '@/lib/auth-token';
import { getBackendPortSync, initBackendPort } from '@/lib/backend-port';

// Re-export for convenience
export { initBackendPort };

// Get API base URL dynamically based on the backend port
export function getApiBase(): string {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const port = getBackendPortSync();
    return `http://localhost:${port}`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876';
}

// Custom error class for API errors
export class ApiError extends Error {
  public code?: string;

  constructor(
    message: string,
    public status: number,
    public response?: string
  ) {
    super(message);
    this.name = 'ApiError';

    // Try to parse a structured error code from the JSON response body
    if (response) {
      try {
        const parsed = JSON.parse(response);
        if (parsed.code) {
          this.code = parsed.code;
        }
        if (parsed.error) {
          this.message = parsed.error;
        }
      } catch {
        // Response is not JSON, ignore
      }
    }
  }
}

/** Well-known backend error codes */
export const ErrorCode = {
  WORKTREE_NOT_FOUND: 'WORKTREE_NOT_FOUND',
} as const;

// Retry configuration for transient network failures.
// Retries handle brief backend hiccups (sleep/wake, sidecar restart, resource pressure)
// so callers don't have to implement their own retry logic.
const FETCH_RETRY_COUNT = 2; // 2 retries = 3 total attempts
const FETCH_RETRY_BASE_DELAY_MS = 300;

// Fetch helper that adds authentication token for Tauri builds.
// Automatically retries on network-level TypeErrors (e.g. server momentarily unreachable)
// with exponential backoff. Only throws ApiError after all retries are exhausted.
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_COUNT; attempt++) {
    try {
      return await fetch(url, { ...options, headers });
    } catch (err) {
      lastError = err;
      if (!(err instanceof TypeError)) {
        // Not a network error — don't retry
        throw err;
      }
      // Don't retry if the request was already aborted (e.g. AbortController)
      if (options.signal?.aborted) {
        break;
      }
      if (attempt < FETCH_RETRY_COUNT) {
        const delay = FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  // All retries exhausted
  if (lastError instanceof TypeError) {
    throw new ApiError('Cannot connect to backend. Is the server running?', 0);
  }
  throw lastError;
}

// Helper to handle API responses consistently
export async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
  return res.json();
}

// Helper to handle API responses for void-returning operations
export async function handleVoidResponse(res: Response, errorMessage: string = 'Operation failed'): Promise<void> {
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || errorMessage, res.status, text);
  }
}

