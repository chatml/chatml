/**
 * Authentication module for GitHub OAuth
 *
 * Handles:
 * - Starting OAuth flow (opening GitHub auth URL in browser)
 * - Handling OAuth callback (parsing code from URL, exchanging for token)
 * - Storing/loading/clearing token from secure storage (Tauri Stronghold or localStorage fallback)
 * - Sending token to backend on startup
 * - Checking auth status
 * - Logout
 * - Listening for OAuth callback events from Tauri
 */

import { isTauri, safeListen } from '@/lib/tauri';

const API_BASE = typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__
  ? 'http://localhost:9876'
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876');

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '';
const GITHUB_REDIRECT_URI = 'chatml://oauth/callback';
const GITHUB_SCOPES = 'repo,read:user';

// Stronghold configuration
const STRONGHOLD_VAULT_FILE = 'chatml.vault';
const STRONGHOLD_PASSWORD = 'chatml-secure-storage';
const STRONGHOLD_CLIENT_NAME = 'auth';
const STRONGHOLD_TOKEN_KEY = 'github_token';

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: GitHubUser;
}

// Generate random state for CSRF protection
function generateState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Store state temporarily for verification (also in sessionStorage for persistence across refreshes)
let pendingOAuthState: string | null = null;

// OAuth timeout duration (2 minutes)
export const OAUTH_TIMEOUT_MS = 120000;

/**
 * Get user-friendly error message for GitHub OAuth errors
 */
function getOAuthErrorMessage(error: string, description: string | null): string {
  switch (error) {
    case 'access_denied':
      return 'You declined to authorize ChatML. Click "Sign in" to try again.';
    case 'redirect_uri_mismatch':
      return 'OAuth configuration error. The redirect URL is not registered with GitHub.';
    case 'application_suspended':
      return 'This application has been suspended. Please contact support.';
    case 'incorrect_client_credentials':
      return 'OAuth configuration error. Please contact support.';
    default:
      return description || `GitHub authorization failed: ${error}`;
  }
}

/**
 * Check if an OAuth flow is currently pending
 */
export function isOAuthPending(): boolean {
  return pendingOAuthState !== null;
}

/**
 * Cancel any pending OAuth flow
 * Clears the stored state so callbacks will be rejected
 */
export function cancelOAuthFlow(): void {
  pendingOAuthState = null;
}

// Try to restore state from sessionStorage on module load
if (typeof window !== 'undefined') {
  pendingOAuthState = sessionStorage.getItem('oauth_state');
}

/**
 * Start the GitHub OAuth flow
 * Opens browser to GitHub authorization page
 */
export async function startOAuthFlow(): Promise<void> {
  // Clear any previous pending state
  pendingOAuthState = generateState();
  // Persist state to sessionStorage in case app refreshes
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('oauth_state', pendingOAuthState);
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state: pendingOAuthState,
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params}`;

  // Open in system browser
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(authUrl);
  } else {
    // Fallback for non-Tauri (development) - open in new tab
    window.open(authUrl, '_blank');
  }
}

/**
 * Handle OAuth callback from deep link
 * @param url The callback URL from GitHub
 * @returns Token and user info on success
 */
export async function handleOAuthCallback(url: string): Promise<{ token: string; user: GitHubUser }> {
  const parsed = new URL(url);

  // Check for GitHub error response FIRST (e.g., user denied access)
  const error = parsed.searchParams.get('error');
  const errorDescription = parsed.searchParams.get('error_description');

  if (error) {
    pendingOAuthState = null; // Clear state on error
    const message = getOAuthErrorMessage(error, errorDescription);
    throw new Error(message);
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');

  if (!code) {
    pendingOAuthState = null;
    throw new Error('No authorization code received from GitHub.');
  }

  // Also check sessionStorage for state (in case module variable was lost)
  const storedState = typeof window !== 'undefined'
    ? sessionStorage.getItem('oauth_state')
    : null;

  if (state !== pendingOAuthState && state !== storedState) {
    pendingOAuthState = null;
    console.warn('OAuth state mismatch', {
      received: state,
      expected: pendingOAuthState,
      stored: storedState
    });
    throw new Error('Security error: state mismatch. Please try again.');
  }

  pendingOAuthState = null;
  // Clear from sessionStorage
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('oauth_state');
  }

  // Exchange code for token via backend
  const res = await fetch(`${API_BASE}/api/auth/github/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to complete authentication: ${text}`);
  }

  return res.json();
}

/**
 * Get or create stronghold client and store
 * @returns The stronghold store for token operations
 */
async function getStrongholdStore() {
  const { Stronghold } = await import('@tauri-apps/plugin-stronghold');
  const { appDataDir } = await import('@tauri-apps/api/path');

  const vaultPath = `${await appDataDir()}${STRONGHOLD_VAULT_FILE}`;
  const stronghold = await Stronghold.load(vaultPath, STRONGHOLD_PASSWORD);

  // Try to load existing client, or create a new one
  let client;
  try {
    client = await stronghold.loadClient(STRONGHOLD_CLIENT_NAME);
  } catch {
    client = await stronghold.createClient(STRONGHOLD_CLIENT_NAME);
  }

  return { stronghold, store: client.getStore() };
}

/**
 * Store token in secure storage (Tauri Stronghold) or localStorage fallback
 */
export async function storeToken(token: string): Promise<void> {
  if (isTauri()) {
    try {
      const { stronghold, store } = await getStrongholdStore();
      const data = Array.from(new TextEncoder().encode(token));
      await store.insert(STRONGHOLD_TOKEN_KEY, data);
      await stronghold.save();
    } catch (err) {
      console.error('Failed to store token in Stronghold, falling back to localStorage', err);
      localStorage.setItem(STRONGHOLD_TOKEN_KEY, token);
    }
  } else {
    // Fallback for non-Tauri (development)
    localStorage.setItem(STRONGHOLD_TOKEN_KEY, token);
  }
}

/**
 * Load token from secure storage
 */
export async function loadToken(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { store } = await getStrongholdStore();
      const data = await store.get(STRONGHOLD_TOKEN_KEY);
      if (data) {
        return new TextDecoder().decode(new Uint8Array(data));
      }
    } catch {
      // No token stored or error - try localStorage fallback
      const fallback = localStorage.getItem(STRONGHOLD_TOKEN_KEY);
      if (fallback) {
        // Migrate to Stronghold if we can
        try {
          await storeToken(fallback);
          localStorage.removeItem(STRONGHOLD_TOKEN_KEY);
        } catch {
          // Keep in localStorage if migration fails
        }
        return fallback;
      }
    }
    return null;
  } else {
    return localStorage.getItem(STRONGHOLD_TOKEN_KEY);
  }
}

/**
 * Clear token from secure storage
 */
export async function clearToken(): Promise<void> {
  if (isTauri()) {
    try {
      const { stronghold, store } = await getStrongholdStore();
      await store.remove(STRONGHOLD_TOKEN_KEY);
      await stronghold.save();
    } catch {
      // Ignore errors - token may not exist
    }
  }
  // Always clear from localStorage as well (in case of fallback)
  localStorage.removeItem(STRONGHOLD_TOKEN_KEY);
}

/**
 * Send token to backend (on app startup)
 * Returns null if token validation fails (expired, revoked, etc.)
 */
export async function sendTokenToBackend(token: string): Promise<{ user: GitHubUser } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      // Token is invalid - this is expected if token expired/revoked
      // Don't log as error since this is a normal flow
      return null;
    }

    return res.json();
  } catch {
    // Network error or backend not reachable
    return null;
  }
}

/**
 * Check auth status from backend
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/api/auth/status`);
  return res.json();
}

/**
 * Logout - clear token from storage and backend
 */
export async function logout(): Promise<void> {
  await clearToken();
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
}

/**
 * Initialize auth - check for stored token and send to backend
 * @returns Auth status
 */
export async function initAuth(): Promise<AuthStatus> {
  const token = await loadToken();

  if (!token) {
    return { authenticated: false };
  }

  const result = await sendTokenToBackend(token);
  if (result) {
    return { authenticated: true, user: result.user };
  }

  // Token invalid, clear it silently
  await clearToken();
  return { authenticated: false };
}

/**
 * Listen for OAuth callback events from Tauri deep link handler
 * @param callback Called with token and user on successful auth
 * @param onError Called with error on auth failure
 * @returns Cleanup function to stop listening
 */
export async function listenForOAuthCallback(
  callback: (result: { token: string; user: GitHubUser }) => void,
  onError: (error: Error) => void
): Promise<() => void> {
  return safeListen<string>('oauth-callback', async (url) => {
    try {
      const result = await handleOAuthCallback(url);
      await storeToken(result.token);
      callback(result);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
