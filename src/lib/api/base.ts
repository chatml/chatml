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

// In-flight GET dedup. When a session switch causes 3-5 panels to each fetch
// the same endpoint within a few microtasks, those callers all share a single
// underlying request instead of fanning out across the wire. Cleared as soon
// as the shared promise settles so subsequent calls re-issue freshly.
//
// Constraint — the dedup key is the URL alone:
//   - Concurrent GETs to the same URL with **different headers**
//     (e.g. custom Accept, If-None-Match, per-call auth overrides) silently
//     share the FIRST caller's response. Today this is fine because every
//     callsite relies on the global auth header injected by rawFetchWithAuth.
//     If a callsite needs request-shape-specific behavior, opt out with
//     `cache: 'no-store'`.
//   - getAuthToken() is read inside the first caller's rawFetchWithAuth, so a
//     token that rotates between two near-simultaneous calls is captured
//     once. Effectively a no-op in this app since token rotation is rare and
//     the dedup window is sub-second.
const inFlightGets = new Map<string, Promise<Response>>();

/**
 * Test-only escape hatch: drops all in-flight dedup entries.
 *
 * Tests rotate MSW handlers between cases for the same URL; if a previous
 * test's shared promise is still tracked when a new test starts, the new
 * test would see stale data. Vitest setup wires this into afterEach.
 */
export function __resetInFlightGetsForTests() {
  inFlightGets.clear();
}

// rawFetchWithAuth performs the actual fetch with auth header injection and
// network-error retry. Caller-supplied AbortSignal is honored.
async function rawFetchWithAuth(url: string, options: RequestInit): Promise<Response> {
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

// Fetch helper that adds authentication token for Tauri builds.
//
// For idempotent GETs, concurrent identical calls share a single underlying
// fetch (each waiter gets its own clone of the Response). Non-GET methods and
// any explicit `cache: "no-store"` always go through directly.
//
// AbortSignals are honored per-caller: aborting one caller never cancels the
// shared underlying fetch that other waiters depend on; the aborting caller
// just rejects with AbortError while the shared work continues.
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const dedupable = method === 'GET' && options.cache !== 'no-store';
  if (!dedupable) {
    return rawFetchWithAuth(url, options);
  }

  let shared = inFlightGets.get(url);
  if (!shared) {
    // Issue the underlying request without the caller's AbortSignal so one
    // caller's abort cannot cancel the work other waiters are sharing.
    //
    // Trade-off: even if every waiter aborts, the shared fetch runs to
    // completion. For a typical 3-5 panel session-switch fan-out this is
    // negligible. If profiling ever shows abandoned fetches dominating, we
    // can refcount waiters and abort the underlying fetch only when the
    // count drops to zero.
    const { signal: _ignored, ...rest } = options;
    void _ignored;
    shared = rawFetchWithAuth(url, rest).finally(() => {
      inFlightGets.delete(url);
    });
    inFlightGets.set(url, shared);
  }

  // Invariant: never read the shared Response's body directly — only clone.
  // The shared Response is observed by every concurrent waiter; Response.clone()
  // throws TypeError if the body is locked or disturbed, which would break
  // every other waiter for this URL. Any future change that does
  // `const data = await r.json()` on the shared `r` (instead of cloning first)
  // is a bug.
  const signal = options.signal;
  if (!signal) {
    const r = await shared;
    return r.clone();
  }
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    shared.then(
      (r) => {
        signal.removeEventListener('abort', onAbort);
        // Same invariant — clone, never consume.
        resolve(r.clone());
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
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

