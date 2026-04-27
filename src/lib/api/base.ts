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
// Each entry carries its own AbortController so the underlying fetch can be
// cancelled imperatively (today only used by the test reset hook below; in
// the future this is also where waiter-refcount cancellation would plug in).
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
type InFlightEntry = {
  promise: Promise<Response>;
  controller: AbortController;
};
const inFlightGets = new Map<string, InFlightEntry>();

/**
 * Test-only escape hatch: aborts and drops all in-flight dedup entries.
 *
 * Vitest setup runs MSW with `onUnhandledRequest: 'error'`. Without this hook,
 * a component fetch left in flight at test teardown would land after MSW
 * handlers have been reset and fail the run with an unhandled-rejection. We
 * replicate the previous (pre-dedup) behavior — where component AbortSignals
 * cancelled their own fetches on unmount — by aborting each entry's master
 * controller. Production code does not call this.
 */
export function __resetInFlightGetsForTests() {
  for (const entry of inFlightGets.values()) {
    entry.controller.abort();
  }
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

  let entry = inFlightGets.get(url);
  if (!entry) {
    // Issue the underlying request with our own master AbortController, NOT
    // the caller's AbortSignal — one caller's abort cannot cancel work other
    // waiters are sharing.
    //
    // Trade-off: even if every waiter aborts, the shared fetch runs to
    // completion. For a typical 3-5 panel session-switch fan-out this is
    // negligible. If profiling ever shows abandoned fetches dominating, we
    // can refcount waiters and abort the master controller when the count
    // drops to zero. The master also lets the test reset hook abort
    // mid-flight fetches at teardown so they don't outlive their MSW handlers.
    const { signal: _ignored, ...rest } = options;
    void _ignored;
    const controller = new AbortController();
    const promise = rawFetchWithAuth(url, { ...rest, signal: controller.signal }).finally(() => {
      inFlightGets.delete(url);
    });
    // Silence unhandled-rejection if every waiter has gone away by the time
    // the shared promise settles (e.g. component unmounted and the test
    // reset hook aborted the master controller). Per-caller derivative
    // promises still see the rejection through their own .then chains.
    promise.catch(() => {});
    entry = { promise, controller };
    inFlightGets.set(url, entry);
  }
  const shared = entry.promise;

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

