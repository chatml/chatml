/**
 * Backend port discovery for Tauri builds.
 * Retrieves the port from Tauri via IPC and caches it for subsequent calls.
 *
 * The port is dynamically allocated by the Go backend and captured by Tauri
 * when the sidecar starts. If the sidecar restarts, the port may change,
 * so the cache must be invalidated and re-fetched.
 */

const DEFAULT_PORT = 9876;
const MAX_PORT_RETRIES = 10;
const PORT_RETRY_DELAY_MS = 200;

let cachedPort: number | null = null;

/**
 * Get the backend port for API calls.
 * In Tauri environment, retrieves the port via IPC command with retries.
 * In non-Tauri environment (development), returns default or env var.
 */
export async function getBackendPort(): Promise<number> {
  if (typeof window === 'undefined') return DEFAULT_PORT;

  // Non-Tauri: use env var or default
  if (!(window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const envPort = process.env.NEXT_PUBLIC_BACKEND_PORT;
    return envPort ? parseInt(envPort, 10) : DEFAULT_PORT;
  }

  if (cachedPort !== null) return cachedPort;

  // Retry logic for Tauri builds - the port may not be available immediately
  // if the sidecar is still starting up
  const { invoke } = await import('@tauri-apps/api/core');

  for (let attempt = 1; attempt <= MAX_PORT_RETRIES; attempt++) {
    try {
      cachedPort = await invoke<number>('get_backend_port');
      if (attempt > 1) {
        console.info(`Backend port acquired on attempt ${attempt}: ${cachedPort}`);
      }
      return cachedPort;
    } catch (e) {
      if (attempt === MAX_PORT_RETRIES) {
        console.error(
          `[CRITICAL] Failed to get backend port after ${MAX_PORT_RETRIES} attempts. ` +
          `The sidecar may not have started correctly. Using default port ${DEFAULT_PORT}. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`
        );
        return DEFAULT_PORT;
      }
      // Wait before retry - port may not be captured from sidecar stdout yet
      await new Promise(resolve => setTimeout(resolve, PORT_RETRY_DELAY_MS));
    }
  }

  return DEFAULT_PORT;
}

/**
 * Get the cached backend port synchronously.
 * Returns null if the port hasn't been fetched yet.
 * Use this for contexts where async isn't practical.
 */
export function getCachedBackendPort(): number | null {
  return cachedPort;
}

/**
 * Get the cached backend port or the default port.
 * Use this when you need a synchronous port value and can accept the default.
 */
export function getBackendPortSync(): number {
  return cachedPort ?? DEFAULT_PORT;
}

/**
 * Initialize the backend port early during app startup.
 * Call this during app initialization to ensure the port is cached
 * before API calls or WebSocket connections are established.
 */
export async function initBackendPort(): Promise<number> {
  return getBackendPort();
}

/**
 * Clear the cached port. Call this when the sidecar restarts,
 * as a new port may be allocated.
 */
export function clearBackendPortCache(): void {
  cachedPort = null;
}

/**
 * Set the backend port directly. Used when receiving port updates
 * from Tauri events (e.g., backend-port event on sidecar restart).
 */
export function setBackendPort(port: number): void {
  cachedPort = port;
}

/**
 * Get the WebSocket URL for the backend.
 */
export function getWsUrl(port: number = getBackendPortSync()): string {
  return `ws://localhost:${port}/ws`;
}
