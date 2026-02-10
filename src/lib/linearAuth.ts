/**
 * Linear OAuth authentication module (PKCE flow)
 *
 * Mirrors the GitHub OAuth pattern but simpler:
 * - No frontend token storage (backend persists encrypted tokens)
 * - State prefixed with "linear:" to differentiate from GitHub callbacks
 * - Backend handles token refresh automatically
 */

import { isTauri } from '@/lib/tauri';
import { getApiBase } from '@/lib/api';
import { generateRandomString, generateCodeChallenge } from '@/lib/pkce';

// Linear OAuth configuration
const LINEAR_CLIENT_ID = process.env.NEXT_PUBLIC_LINEAR_CLIENT_ID || '';
const LINEAR_REDIRECT_URI = 'chatml://oauth/callback';
const LINEAR_SCOPES = 'read';

// State prefix for routing callbacks
export const LINEAR_STATE_PREFIX = 'linear:';

// Pending OAuth state
let pendingOAuthState: string | null = null;
let pendingCodeVerifier: string | null = null;

// Try to restore state from sessionStorage on module load
if (typeof window !== 'undefined') {
  pendingOAuthState = sessionStorage.getItem('linear_oauth_state');
  pendingCodeVerifier = sessionStorage.getItem('linear_oauth_code_verifier');
}

export interface LinearUser {
  id: string;
  name: string;
  email: string;
  displayName: string;
  avatarUrl: string;
}

export interface LinearAuthStatus {
  authenticated: boolean;
  user?: LinearUser;
}

/** Check if a Linear OAuth flow is currently pending. */
export function isLinearOAuthPending(): boolean {
  return pendingOAuthState !== null;
}

/** Cancel any pending Linear OAuth flow. */
export function cancelLinearOAuthFlow(): void {
  pendingOAuthState = null;
  pendingCodeVerifier = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('linear_oauth_state');
    sessionStorage.removeItem('linear_oauth_code_verifier');
  }
}

/** Start the Linear OAuth flow with PKCE. Opens browser to Linear authorization page. */
export async function startLinearOAuthFlow(): Promise<void> {
  const random = generateRandomString(32);
  pendingOAuthState = LINEAR_STATE_PREFIX + random;
  pendingCodeVerifier = generateRandomString(32);

  const codeChallenge = await generateCodeChallenge(pendingCodeVerifier);

  // Persist to sessionStorage in case app refreshes
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('linear_oauth_state', pendingOAuthState);
    sessionStorage.setItem('linear_oauth_code_verifier', pendingCodeVerifier);
  }

  const params = new URLSearchParams({
    client_id: LINEAR_CLIENT_ID,
    redirect_uri: LINEAR_REDIRECT_URI,
    scope: LINEAR_SCOPES,
    state: pendingOAuthState,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });

  const authUrl = `https://linear.app/oauth/authorize?${params}`;

  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(authUrl);
  } else {
    window.open(authUrl, '_blank');
  }
}

/** Handle Linear OAuth callback from deep link. */
export async function handleLinearOAuthCallback(url: string): Promise<{ user: LinearUser }> {
  console.log('[Linear OAuth] Received callback URL:', url);
  const parsed = new URL(url);

  // Check for error response
  const error = parsed.searchParams.get('error');
  const errorDescription = parsed.searchParams.get('error_description');

  if (error) {
    console.log('[Linear OAuth] Error:', error, errorDescription);
    pendingOAuthState = null;
    throw new Error(errorDescription || `Linear authorization failed: ${error}`);
  }

  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');

  if (!code) {
    pendingOAuthState = null;
    throw new Error('No authorization code received from Linear.');
  }

  // Validate state
  const storedState = typeof window !== 'undefined'
    ? sessionStorage.getItem('linear_oauth_state')
    : null;

  if (state !== pendingOAuthState && state !== storedState) {
    pendingOAuthState = null;
    throw new Error('Security error: state mismatch. Please try again.');
  }

  // Get the code verifier before clearing
  const codeVerifier = pendingCodeVerifier ||
    (typeof window !== 'undefined' ? sessionStorage.getItem('linear_oauth_code_verifier') : null);

  // Clear state
  pendingOAuthState = null;
  pendingCodeVerifier = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('linear_oauth_state');
    sessionStorage.removeItem('linear_oauth_code_verifier');
  }

  // Exchange code for tokens via backend
  const res = await fetch(`${getApiBase()}/api/auth/linear/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: LINEAR_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('[Linear OAuth] Backend exchange failed:', res.status, text);
    throw new Error(`Failed to complete Linear authentication: ${text}`);
  }

  const result = await res.json();
  console.log('[Linear OAuth] Success, user:', result.user?.displayName);
  return result;
}

/** Check Linear auth status from backend. */
export async function getLinearAuthStatus(): Promise<LinearAuthStatus> {
  const res = await fetch(`${getApiBase()}/api/auth/linear/status`);
  return res.json();
}

/** Logout from Linear. */
export async function linearLogout(): Promise<void> {
  await fetch(`${getApiBase()}/api/auth/linear/logout`, { method: 'POST' });
}
