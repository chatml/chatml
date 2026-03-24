// agent-runner/src/mcp/tools/fetch-utils.ts
//
// Retry wrapper for fetch() calls to the local Go backend.
// Retries only on TypeError (network-level failures like ECONNREFUSED),
// never on HTTP error responses (4xx, 5xx).

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const RETRY_DELAYS_MS = [500, 1000, 2000];

const AUTH_TOKEN = process.env.CHATML_AUTH_TOKEN || "";

// Resolve the ChatML app data directory, mirroring appdir.go's platform logic.
// Can be overridden via CHATML_DATA_DIR (used by dev builds).
function getAppDataDir(): string {
  if (process.env.CHATML_DATA_DIR) return process.env.CHATML_DATA_DIR;
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "ChatML");
    case "win32": {
      const localAppData = process.env.LOCALAPPDATA;
      return localAppData
        ? join(localAppData, "ChatML")
        : join(home, "AppData", "Local", "ChatML");
    }
    default:
      return process.env.XDG_DATA_HOME
        ? join(process.env.XDG_DATA_HOME, "ChatML")
        : join(home, ".local", "share", "ChatML");
  }
}

// Determine the backend URL. Priority:
//   1. CHATML_BACKEND_URL env var (set when spawned by ChatML internally)
//   2. Port file written by the backend at startup (enables external MCP usage)
//   3. Default port 9876 fallback
function resolveBackendUrl(): string {
  if (process.env.CHATML_BACKEND_URL) return process.env.CHATML_BACKEND_URL;
  try {
    const portFile = join(getAppDataDir(), "state", "backend.port");
    const portNum = parseInt(readFileSync(portFile, "utf8").trim(), 10);
    if (portNum >= 1 && portNum <= 65535) return `http://127.0.0.1:${portNum}`;
  } catch {
    // File not found or unreadable — fall through to default
  }
  return "http://127.0.0.1:9876";
}

// Resolved once at module load time. For internal usage (CHATML_BACKEND_URL set by the
// spawning process) this is always correct. For external MCP usage, the backend must be
// running before the MCP client starts; if the backend later restarts on a different port,
// the MCP client must also restart to pick up the new port from the port file.
export const BACKEND_URL = resolveBackendUrl();

/** Build standard headers for backend requests (auth + optional JSON content-type). */
export function buildHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return headers;
}

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
