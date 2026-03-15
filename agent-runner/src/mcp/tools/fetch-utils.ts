// agent-runner/src/mcp/tools/fetch-utils.ts
//
// Retry wrapper for fetch() calls to the local Go backend.
// Retries only on TypeError (network-level failures like ECONNREFUSED),
// never on HTTP error responses (4xx, 5xx).

const RETRY_DELAYS_MS = [500, 1000, 2000];

/** Extract a useful error message from a fetch TypeError, including the root cause. */
export function formatFetchError(error: unknown): string {
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    if (cause) {
      const code = cause.code;
      if (code) return `${error.message} (${code})`;
      const detail = cause.message || (typeof cause === 'object' ? JSON.stringify(cause) : String(cause));
      return `${error.message} (${detail})`;
    }
    return error.message;
  }
  return String(error);
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
      lastError = error;

      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  throw lastError;
}
