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

import { isTauri, safeListen, safeInvoke } from '@/lib/tauri';
import { getBackendPortSync } from '@/lib/backend-port';

// Get API base URL dynamically based on the backend port
function getApiBase(): string {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const port = getBackendPortSync();
    return `http://localhost:${port}`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876';
}

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

// Generate random string for state/PKCE
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}


// Generate PKCE code challenge from verifier (S256 method)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  // Base64url encode (no padding)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Store state and verifier temporarily for verification
let pendingOAuthState: string | null = null;
let pendingCodeVerifier: string | null = null;

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
  pendingCodeVerifier = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_code_verifier');
  }
}

// Try to restore state and verifier from sessionStorage on module load
if (typeof window !== 'undefined') {
  pendingOAuthState = sessionStorage.getItem('oauth_state');
  pendingCodeVerifier = sessionStorage.getItem('oauth_code_verifier');
}

/**
 * Start the GitHub OAuth flow with PKCE
 * Opens browser to GitHub authorization page
 */
export async function startOAuthFlow(): Promise<void> {
  // Generate state and PKCE code verifier (32 bytes = 64 hex chars, within 43-128 range)
  pendingOAuthState = generateRandomString(32);
  pendingCodeVerifier = generateRandomString(32);

  // Generate code challenge from verifier
  const codeChallenge = await generateCodeChallenge(pendingCodeVerifier);

  // Persist to sessionStorage in case app refreshes
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('oauth_state', pendingOAuthState);
    sessionStorage.setItem('oauth_code_verifier', pendingCodeVerifier);
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state: pendingOAuthState,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
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
  console.log('[OAuth] Received callback URL:', url);
  const parsed = new URL(url);

  // Check for GitHub error response FIRST (e.g., user denied access)
  const error = parsed.searchParams.get('error');
  const errorDescription = parsed.searchParams.get('error_description');

  if (error) {
    console.log('[OAuth] GitHub returned error:', error, errorDescription);
    pendingOAuthState = null; // Clear state on error
    const message = getOAuthErrorMessage(error, errorDescription);
    throw new Error(message);
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');
  console.log('[OAuth] Parsed callback - code present:', !!code, 'state present:', !!state);

  if (!code) {
    console.log('[OAuth] No authorization code in callback');
    pendingOAuthState = null;
    throw new Error('No authorization code received from GitHub.');
  }

  // Also check sessionStorage for state (in case module variable was lost)
  const storedState = typeof window !== 'undefined'
    ? sessionStorage.getItem('oauth_state')
    : null;

  console.log('[OAuth] State validation - received:', state, 'pending:', pendingOAuthState, 'stored:', storedState);

  if (state !== pendingOAuthState && state !== storedState) {
    // Save expected values BEFORE clearing for accurate logging
    const expectedPending = pendingOAuthState;
    pendingOAuthState = null;
    console.warn('[OAuth] State mismatch', {
      received: state,
      expectedPending,
      stored: storedState
    });
    throw new Error('Security error: state mismatch. Please try again.');
  }

  // Get the code verifier before clearing
  const codeVerifier = pendingCodeVerifier ||
    (typeof window !== 'undefined' ? sessionStorage.getItem('oauth_code_verifier') : null);
  console.log('[OAuth] Code verifier present:', !!codeVerifier);

  // Clear state and verifier
  pendingOAuthState = null;
  pendingCodeVerifier = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_code_verifier');
  }

  // Exchange code for token via backend (with PKCE verifier)
  console.log('[OAuth] Exchanging code for token via backend...');
  const res = await fetch(`${getApiBase()}/api/auth/github/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[OAuth] Backend token exchange failed:', res.status, text);
    throw new Error(`Failed to complete authentication: ${text}`);
  }

  const result = await res.json();
  console.log('[OAuth] Token exchange successful, user:', result.user?.login);
  return result;
}

// Cache stronghold instance to avoid slow Argon2 password derivation on every call
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedStronghold: { stronghold: any; store: any } | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let strongholdLoadPromise: Promise<{ stronghold: any; store: any }> | null = null;

/**
 * Get or create stronghold client and store (cached)
 * @returns The stronghold store for token operations
 */
async function getStrongholdStore() {
  // Return cached instance if available
  if (cachedStronghold) {
    return cachedStronghold;
  }

  // If already loading, wait for that promise
  if (strongholdLoadPromise) {
    return strongholdLoadPromise;
  }

  // Start loading
  strongholdLoadPromise = (async () => {
    const start = performance.now();
    console.log('[Auth] getStrongholdStore: starting...');

    const { Stronghold } = await import('@tauri-apps/plugin-stronghold');
    const { appDataDir } = await import('@tauri-apps/api/path');
    console.log('[Auth] getStrongholdStore: imports done', (performance.now() - start).toFixed(0), 'ms');

    const dataDir = await appDataDir();
    // Ensure path has trailing slash
    const vaultPath = dataDir.endsWith('/') ? `${dataDir}${STRONGHOLD_VAULT_FILE}` : `${dataDir}/${STRONGHOLD_VAULT_FILE}`;
    console.log('[Auth] getStrongholdStore: loading vault from', vaultPath);
    const stronghold = await Stronghold.load(vaultPath, STRONGHOLD_PASSWORD);
    console.log('[Auth] getStrongholdStore: vault loaded', (performance.now() - start).toFixed(0), 'ms');

    // Try to load existing client, or create a new one
    let client;
    try {
      client = await stronghold.loadClient(STRONGHOLD_CLIENT_NAME);
    } catch {
      client = await stronghold.createClient(STRONGHOLD_CLIENT_NAME);
    }
    console.log('[Auth] getStrongholdStore: client ready', (performance.now() - start).toFixed(0), 'ms');

    cachedStronghold = { stronghold, store: client.getStore() };
    return cachedStronghold;
  })();

  return strongholdLoadPromise;
}

/**
 * Store token in secure storage
 * TODO: Re-enable Stronghold once performance issue is resolved
 */
export async function storeToken(token: string): Promise<void> {
  console.log('[Auth] storeToken: using localStorage (Stronghold disabled for debugging)');
  localStorage.setItem(STRONGHOLD_TOKEN_KEY, token);
}

/**
 * Load token from secure storage
 * TODO: Re-enable Stronghold once performance issue is resolved
 */
export async function loadToken(): Promise<string | null> {
  console.log('[Auth] loadToken: using localStorage (Stronghold disabled for debugging)');
  return localStorage.getItem(STRONGHOLD_TOKEN_KEY);
}

/**
 * Clear token from secure storage
 * TODO: Re-enable Stronghold once performance issue is resolved
 */
export async function clearToken(): Promise<void> {
  console.log('[Auth] clearToken: using localStorage (Stronghold disabled for debugging)');
  localStorage.removeItem(STRONGHOLD_TOKEN_KEY);
}

/**
 * Send token to backend (on app startup)
 * Returns null if token validation fails (expired, revoked, etc.)
 * Uses a short timeout to avoid blocking app startup if backend isn't ready yet
 */
export async function sendTokenToBackend(token: string): Promise<{ user: GitHubUser } | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(3000), // 3 second timeout - don't block startup
    });

    if (!res.ok) {
      // Token is invalid - this is expected if token expired/revoked
      // Don't log as error since this is a normal flow
      return null;
    }

    return res.json();
  } catch {
    // Network error, timeout, or backend not reachable
    return null;
  }
}

/**
 * Check auth status from backend
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${getApiBase()}/api/auth/status`);
  return res.json();
}

/**
 * Logout - clear token from storage and backend
 */
export async function logout(): Promise<void> {
  await clearToken();
  await fetch(`${getApiBase()}/api/auth/logout`, { method: 'POST' });
}

/**
 * Initialize auth - check for stored token
 * NOTE: This only checks if a token EXISTS locally, it does NOT validate with backend.
 * Token validation happens later after backend connection is established.
 * @returns Auth status (optimistic - assumes token is valid if present)
 */
export async function initAuth(): Promise<AuthStatus> {
  console.log('[Auth] initAuth: loading token...');
  const token = await loadToken();
  console.log('[Auth] initAuth: token loaded, hasToken =', !!token);

  if (!token) {
    return { authenticated: false };
  }

  // We have a token - assume it's valid for now
  // Backend will validate it when we send authenticated requests
  return { authenticated: true };
}

/**
 * Validate stored token with backend after connection is established
 * Call this after backend is confirmed to be running
 * @returns User info if valid, null if invalid (will clear stored token)
 */
export async function validateStoredToken(): Promise<GitHubUser | null> {
  const token = await loadToken();

  if (!token) {
    return null;
  }

  const result = await sendTokenToBackend(token);
  if (result) {
    return result.user;
  }

  // Token invalid, clear it
  await clearToken();
  return null;
}

/**
 * Check for pending OAuth callback URL (stored by Rust deep link handler)
 */
async function checkPendingOAuthCallback(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const url = await safeInvoke<string>('get_pending_oauth_callback');
    return url;
  } catch {
    return null;
  }
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
  console.log('[OAuth] Setting up callback listener...');

  // Track if we've already processed a callback to avoid duplicates
  let processed = false;

  // Handler function to process OAuth callback
  const processCallback = async (url: string) => {
    if (processed) {
      console.log('[OAuth] Already processed a callback, skipping');
      return;
    }
    processed = true;
    console.log('[OAuth] Processing callback URL:', url);
    try {
      console.log('[OAuth] Calling handleOAuthCallback...');
      const result = await handleOAuthCallback(url);
      console.log('[OAuth] handleOAuthCallback returned, result:', !!result, 'user:', result?.user?.login);
      console.log('[OAuth] Storing token...');
      await storeToken(result.token);
      console.log('[OAuth] Token stored, invoking success callback...');
      callback(result);
      console.log('[OAuth] Success callback invoked');
    } catch (err) {
      console.error('[OAuth] Error in callback handler:', err);
      processed = false; // Allow retry on error
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Listen for Tauri event (standard approach)
  const unlistenTauri = await safeListen<string>('oauth-callback', async (url) => {
    console.log('[OAuth] Tauri event received');
    await processCallback(url);
  });

  // Also listen for DOM custom event (fallback via window.eval)
  const domHandler = async (event: Event) => {
    const customEvent = event as CustomEvent<string>;
    console.log('[OAuth] DOM custom event received');
    await processCallback(customEvent.detail);
  };
  window.addEventListener('tauri-oauth-callback', domHandler);

  // Poll for pending callback when window gains focus (fallback for when events don't work)
  const focusHandler = async () => {
    console.log('[OAuth] Window focused, checking for pending callback...');
    const pendingUrl = await checkPendingOAuthCallback();
    if (pendingUrl) {
      console.log('[OAuth] Found pending callback URL');
      await processCallback(pendingUrl);
    }
  };
  window.addEventListener('focus', focusHandler);

  // Also check immediately in case there's already a pending callback
  setTimeout(async () => {
    const pendingUrl = await checkPendingOAuthCallback();
    if (pendingUrl) {
      console.log('[OAuth] Found pending callback URL on init');
      await processCallback(pendingUrl);
    }
  }, 100);

  console.log('[OAuth] All listeners set up (Tauri event, DOM event, focus poll)');

  // Development mode: expose a global function to manually trigger OAuth callback
  // This works around deep link not working in dev mode
  if (process.env.NODE_ENV === 'development') {
    (window as unknown as { __devOAuthCallback: (url: string) => void }).__devOAuthCallback = (url: string) => {
      console.log('[OAuth] Dev mode: manual callback triggered');
      processCallback(url);
    };
    console.log('[OAuth] Dev mode: window.__devOAuthCallback(url) available for manual testing');
  }

  // Return cleanup function that removes all listeners
  return () => {
    unlistenTauri();
    window.removeEventListener('tauri-oauth-callback', domHandler);
    window.removeEventListener('focus', focusHandler);
    if (process.env.NODE_ENV === 'development') {
      delete (window as unknown as { __devOAuthCallback?: unknown }).__devOAuthCallback;
    }
  };
}
