# GitHub OAuth & Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add GitHub OAuth authentication with an onboarding screen as the first authentication system for the app.

**Architecture:** Tauri handles OAuth flow via deep links, stores token in secure storage (keychain), and passes token to Go backend on startup. Backend exchanges OAuth code for token and keeps token in memory for GitHub API calls.

**Tech Stack:** Go (backend), Rust/Tauri (app shell), React/Next.js (frontend), Zustand (state), tauri-plugin-deep-link, tauri-plugin-stronghold

---

## Task 1: Add GitHub OAuth Dependencies to Backend

**Files:**
- Modify: `backend/go.mod`

**Step 1: Add golang.org/x/oauth2 dependency**

```bash
cd backend && go get golang.org/x/oauth2
```

**Step 2: Verify dependency added**

Run: `grep oauth2 backend/go.mod`
Expected: `golang.org/x/oauth2` appears in dependencies

**Step 3: Commit**

```bash
git add backend/go.mod backend/go.sum
git commit -m "chore(backend): add oauth2 dependency for GitHub auth"
```

---

## Task 2: Create GitHub Client Module

**Files:**
- Create: `backend/github/client.go`
- Create: `backend/github/client_test.go`

**Step 1: Write the test file**

```go
// backend/github/client_test.go
package github

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExchangeCode(t *testing.T) {
	// Mock GitHub OAuth server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login/oauth/access_token" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{
				"access_token": "gho_test_token_123",
				"token_type":   "bearer",
				"scope":        "repo,read:user",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("test_client_id", "test_client_secret")
	client.baseURL = server.URL // Override for testing

	token, err := client.ExchangeCode(r.Context(), "test_code")
	if err != nil {
		t.Fatalf("ExchangeCode failed: %v", err)
	}
	if token != "gho_test_token_123" {
		t.Errorf("Expected token gho_test_token_123, got %s", token)
	}
}

func TestGetUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/user" {
			// Check auth header
			auth := r.Header.Get("Authorization")
			if auth != "Bearer test_token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{
				"login":      "testuser",
				"name":       "Test User",
				"avatar_url": "https://github.com/testuser.png",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient("", "")
	client.apiURL = server.URL

	user, err := client.GetUser(r.Context(), "test_token")
	if err != nil {
		t.Fatalf("GetUser failed: %v", err)
	}
	if user.Login != "testuser" {
		t.Errorf("Expected login testuser, got %s", user.Login)
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd backend && go test ./github/... -v`
Expected: FAIL (package doesn't exist)

**Step 3: Write the implementation**

```go
// backend/github/client.go
package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// User represents a GitHub user
type User struct {
	Login     string `json:"login"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// Client handles GitHub API interactions
type Client struct {
	clientID     string
	clientSecret string
	httpClient   *http.Client
	baseURL      string // OAuth base URL (github.com)
	apiURL       string // API base URL (api.github.com)

	// In-memory token storage
	mu    sync.RWMutex
	token string
	user  *User
}

// NewClient creates a new GitHub client
func NewClient(clientID, clientSecret string) *Client {
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{},
		baseURL:      "https://github.com",
		apiURL:       "https://api.github.com",
	}
}

// ExchangeCode exchanges an OAuth code for an access token
func (c *Client) ExchangeCode(ctx context.Context, code string) (string, error) {
	data := url.Values{}
	data.Set("client_id", c.clientID)
	data.Set("client_secret", c.clientSecret)
	data.Set("code", code)

	req, err := http.NewRequestWithContext(ctx, "POST",
		c.baseURL+"/login/oauth/access_token",
		strings.NewReader(data.Encode()))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("exchanging code: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var result struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding response: %w", err)
	}

	if result.Error != "" {
		return "", fmt.Errorf("GitHub error: %s - %s", result.Error, result.ErrorDesc)
	}

	return result.AccessToken, nil
}

// GetUser fetches the authenticated user's profile
func (c *Client) GetUser(ctx context.Context, token string) (*User, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.apiURL+"/user", nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching user: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GitHub returned %d: %s", resp.StatusCode, body)
	}

	var user User
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("decoding user: %w", err)
	}

	return &user, nil
}

// SetToken stores the token in memory
func (c *Client) SetToken(token string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = token
}

// GetToken returns the stored token
func (c *Client) GetToken() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token
}

// SetUser stores the user in memory
func (c *Client) SetUser(user *User) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.user = user
}

// GetStoredUser returns the stored user
func (c *Client) GetStoredUser() *User {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.user
}

// ClearAuth clears the stored token and user
func (c *Client) ClearAuth() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = ""
	c.user = nil
}

// IsAuthenticated returns whether a token is stored
func (c *Client) IsAuthenticated() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.token != ""
}
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./github/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/github/
git commit -m "feat(backend): add GitHub OAuth client module"
```

---

## Task 3: Add Auth Configuration

**Files:**
- Modify: `backend/server/config.go`

**Step 1: Read the current config file**

Already read above - it only has CORS config.

**Step 2: Add GitHub config**

```go
// backend/server/config.go
package server

import "os"

// AllowedOrigins defines the allowed origins for CORS and WebSocket connections.
// These must be kept in sync to prevent security misconfigurations.
var AllowedOrigins = []string{
	"tauri://localhost",
	"https://tauri.localhost",
	"http://localhost:3000", // Dev only - consider removing in production builds
}

// AllowedOriginsMap provides O(1) lookup for WebSocket origin validation.
var AllowedOriginsMap = func() map[string]bool {
	m := make(map[string]bool, len(AllowedOrigins))
	for _, origin := range AllowedOrigins {
		m[origin] = true
	}
	return m
}()

// GitHubConfig holds GitHub OAuth configuration
type GitHubConfig struct {
	ClientID     string
	ClientSecret string
}

// LoadGitHubConfig loads GitHub OAuth config from environment variables
func LoadGitHubConfig() GitHubConfig {
	return GitHubConfig{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
	}
}
```

**Step 3: Commit**

```bash
git add backend/server/config.go
git commit -m "feat(backend): add GitHub OAuth configuration"
```

---

## Task 4: Create Auth Handlers

**Files:**
- Create: `backend/server/auth_handlers.go`
- Create: `backend/server/auth_handlers_test.go`

**Step 1: Write the test file**

```go
// backend/server/auth_handlers_test.go
package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chatml/chatml-backend/github"
)

func TestAuthHandlers_SetToken(t *testing.T) {
	ghClient := github.NewClient("", "")
	handlers := NewAuthHandlers(ghClient)

	body := bytes.NewBufferString(`{"token":"test_token_123"}`)
	req := httptest.NewRequest("POST", "/api/auth/token", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handlers.SetToken(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Verify token was stored
	if ghClient.GetToken() != "test_token_123" {
		t.Errorf("Token not stored correctly")
	}
}

func TestAuthHandlers_GetStatus_Unauthenticated(t *testing.T) {
	ghClient := github.NewClient("", "")
	handlers := NewAuthHandlers(ghClient)

	req := httptest.NewRequest("GET", "/api/auth/status", nil)
	w := httptest.NewRecorder()

	handlers.GetStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp AuthStatusResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Authenticated {
		t.Error("Expected authenticated=false")
	}
}

func TestAuthHandlers_GetStatus_Authenticated(t *testing.T) {
	ghClient := github.NewClient("", "")
	ghClient.SetToken("test_token")
	ghClient.SetUser(&github.User{Login: "testuser", Name: "Test"})
	handlers := NewAuthHandlers(ghClient)

	req := httptest.NewRequest("GET", "/api/auth/status", nil)
	w := httptest.NewRecorder()

	handlers.GetStatus(w, req)

	var resp AuthStatusResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if !resp.Authenticated {
		t.Error("Expected authenticated=true")
	}
	if resp.User == nil || resp.User.Login != "testuser" {
		t.Error("Expected user info")
	}
}

func TestAuthHandlers_Logout(t *testing.T) {
	ghClient := github.NewClient("", "")
	ghClient.SetToken("test_token")
	handlers := NewAuthHandlers(ghClient)

	req := httptest.NewRequest("POST", "/api/auth/logout", nil)
	w := httptest.NewRecorder()

	handlers.Logout(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if ghClient.IsAuthenticated() {
		t.Error("Expected token to be cleared")
	}
}
```

**Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./server/... -run TestAuth -v`
Expected: FAIL (handlers don't exist)

**Step 3: Write the implementation**

```go
// backend/server/auth_handlers.go
package server

import (
	"encoding/json"
	"net/http"

	"github.com/chatml/chatml-backend/github"
)

// AuthHandlers handles authentication endpoints
type AuthHandlers struct {
	ghClient *github.Client
}

// NewAuthHandlers creates new auth handlers
func NewAuthHandlers(ghClient *github.Client) *AuthHandlers {
	return &AuthHandlers{ghClient: ghClient}
}

// GitHubCallbackRequest is the request body for OAuth callback
type GitHubCallbackRequest struct {
	Code string `json:"code"`
}

// GitHubCallbackResponse is the response for OAuth callback
type GitHubCallbackResponse struct {
	Token string       `json:"token"`
	User  *github.User `json:"user"`
}

// SetTokenRequest is the request body for setting a token
type SetTokenRequest struct {
	Token string `json:"token"`
}

// AuthStatusResponse is the response for auth status
type AuthStatusResponse struct {
	Authenticated bool         `json:"authenticated"`
	User          *github.User `json:"user,omitempty"`
}

// GitHubCallback handles POST /api/auth/github/callback
// Exchanges OAuth code for token and fetches user info
func (h *AuthHandlers) GitHubCallback(w http.ResponseWriter, r *http.Request) {
	var req GitHubCallbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Code == "" {
		http.Error(w, "code is required", http.StatusBadRequest)
		return
	}

	// Exchange code for token
	token, err := h.ghClient.ExchangeCode(r.Context(), req.Code)
	if err != nil {
		http.Error(w, "failed to exchange code: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Fetch user info
	user, err := h.ghClient.GetUser(r.Context(), token)
	if err != nil {
		http.Error(w, "failed to fetch user: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Store in memory (frontend will also store in keychain)
	h.ghClient.SetToken(token)
	h.ghClient.SetUser(user)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(GitHubCallbackResponse{
		Token: token,
		User:  user,
	})
}

// SetToken handles POST /api/auth/token
// Called by frontend on startup to provide stored token
func (h *AuthHandlers) SetToken(w http.ResponseWriter, r *http.Request) {
	var req SetTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		http.Error(w, "token is required", http.StatusBadRequest)
		return
	}

	// Validate token by fetching user
	user, err := h.ghClient.GetUser(r.Context(), req.Token)
	if err != nil {
		http.Error(w, "invalid token: "+err.Error(), http.StatusUnauthorized)
		return
	}

	h.ghClient.SetToken(req.Token)
	h.ghClient.SetUser(user)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":   true,
		"user": user,
	})
}

// GetStatus handles GET /api/auth/status
func (h *AuthHandlers) GetStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthStatusResponse{
		Authenticated: h.ghClient.IsAuthenticated(),
		User:          h.ghClient.GetStoredUser(),
	})
}

// Logout handles POST /api/auth/logout
func (h *AuthHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	h.ghClient.ClearAuth()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}
```

**Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./server/... -run TestAuth -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/server/auth_handlers.go backend/server/auth_handlers_test.go
git commit -m "feat(backend): add auth handlers for OAuth flow"
```

---

## Task 5: Wire Auth Routes in Router

**Files:**
- Modify: `backend/server/router.go`
- Modify: `backend/main.go`

**Step 1: Update router to include auth routes**

Add to `backend/server/router.go` after the imports, modify the NewRouter function signature and add auth routes:

```go
// Update NewRouter signature to accept github client
func NewRouter(s *store.SQLiteStore, hub *Hub, agentMgr *agent.Manager, ghClient *github.Client) http.Handler {
	r := chi.NewRouter()
	h := NewHandlers(s, agentMgr)
	auth := NewAuthHandlers(ghClient)

	// ... existing middleware ...

	// Auth endpoints (no rate limiting - they're naturally rate limited by OAuth)
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/github/callback", auth.GitHubCallback)
		r.Post("/token", auth.SetToken)
		r.Get("/status", auth.GetStatus)
		r.Post("/logout", auth.Logout)
	})

	// ... rest of existing routes ...
}
```

**Step 2: Update main.go to create and pass GitHub client**

The main.go needs to be updated to:
1. Load GitHub config
2. Create GitHub client
3. Pass to NewRouter

**Step 3: Run the server to verify it compiles**

Run: `cd backend && go build ./...`
Expected: Success

**Step 4: Commit**

```bash
git add backend/server/router.go backend/main.go
git commit -m "feat(backend): wire auth routes in router"
```

---

## Task 6: Add Tauri Deep Link Plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json` (if exists) or `src-tauri/tauri.dev.conf.json`

**Step 1: Add deep-link plugin to Cargo.toml**

Add to dependencies:
```toml
tauri-plugin-deep-link = "2"
```

**Step 2: Update capabilities to allow deep-link**

Add to `src-tauri/capabilities/default.json` permissions array:
```json
"deep-link:default"
```

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/capabilities/default.json
git commit -m "chore(tauri): add deep-link plugin for OAuth callback"
```

---

## Task 7: Add Tauri Stronghold Plugin for Secure Storage

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Add stronghold plugin to Cargo.toml**

Add to dependencies:
```toml
tauri-plugin-stronghold = "2"
```

**Step 2: Update capabilities**

Add to permissions array:
```json
"stronghold:default"
```

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/capabilities/default.json
git commit -m "chore(tauri): add stronghold plugin for secure token storage"
```

---

## Task 8: Configure Tauri Deep Link Handler

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add deep link plugin initialization and handler**

In `lib.rs`, add after existing plugins:
```rust
.plugin(tauri_plugin_deep_link::init())
.plugin(tauri_plugin_stronghold::Builder::new(|_| {
    // Use a simple password for the stronghold vault
    // In production, this could be derived from user password or machine ID
    Ok("chatml-secure-storage".as_bytes().to_vec())
}).build())
```

**Step 2: Register deep link handler in setup**

Add to setup closure:
```rust
// Register deep link handler for OAuth callback
#[cfg(desktop)]
{
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link().on_open_url(|event| {
        let urls = event.urls();
        for url in urls {
            if url.scheme() == "chatml" && url.host_str() == Some("oauth") {
                // Emit to frontend for handling
                if let Some(window) = event.webview_window("main") {
                    let _ = window.emit("oauth-callback", url.to_string());
                }
            }
        }
    });
}
```

**Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Success

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): configure deep link and stronghold plugins"
```

---

## Task 9: Create Frontend Auth API Functions

**Files:**
- Create: `src/lib/auth.ts`

**Step 1: Write the auth API module**

```typescript
// src/lib/auth.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';

const API_BASE = 'http://localhost:9876';

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '';
const GITHUB_REDIRECT_URI = 'chatml://oauth/callback';
const GITHUB_SCOPES = 'repo,read:user';

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

// Store state temporarily for verification
let pendingOAuthState: string | null = null;

/**
 * Start the GitHub OAuth flow
 * Opens browser to GitHub authorization page
 */
export async function startOAuthFlow(): Promise<void> {
  pendingOAuthState = generateState();

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state: pendingOAuthState,
  });

  const authUrl = `https://github.com/login/oauth/authorize?${params}`;

  // Open in system browser
  await open(authUrl);
}

/**
 * Handle OAuth callback from deep link
 * @param url The callback URL from GitHub
 * @returns Token and user info on success
 */
export async function handleOAuthCallback(url: string): Promise<{ token: string; user: GitHubUser }> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get('code');
  const state = parsed.searchParams.get('state');

  if (!code) {
    throw new Error('No authorization code received');
  }

  if (state !== pendingOAuthState) {
    throw new Error('State mismatch - possible CSRF attack');
  }

  pendingOAuthState = null;

  // Exchange code for token via backend
  const res = await fetch(`${API_BASE}/api/auth/github/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth exchange failed: ${text}`);
  }

  return res.json();
}

/**
 * Store token in secure storage (Tauri Stronghold)
 */
export async function storeToken(token: string): Promise<void> {
  // For Tauri app, use stronghold
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const { Stronghold, Client } = await import('@anthropic/tauri-plugin-stronghold-api');
    const stronghold = await Stronghold.load('chatml.vault', 'chatml-secure-storage');
    const client = await stronghold.createClient('auth');
    const store = client.getStore();
    await store.insert('github_token', Array.from(new TextEncoder().encode(token)));
    await stronghold.save();
  } else {
    // Fallback for non-Tauri (development)
    localStorage.setItem('github_token', token);
  }
}

/**
 * Load token from secure storage
 */
export async function loadToken(): Promise<string | null> {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    try {
      const { Stronghold } = await import('@anthropic/tauri-plugin-stronghold-api');
      const stronghold = await Stronghold.load('chatml.vault', 'chatml-secure-storage');
      const client = await stronghold.createClient('auth');
      const store = client.getStore();
      const data = await store.get('github_token');
      if (data) {
        return new TextDecoder().decode(new Uint8Array(data));
      }
    } catch {
      // No token stored
    }
    return null;
  } else {
    return localStorage.getItem('github_token');
  }
}

/**
 * Clear token from secure storage
 */
export async function clearToken(): Promise<void> {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    try {
      const { Stronghold } = await import('@anthropic/tauri-plugin-stronghold-api');
      const stronghold = await Stronghold.load('chatml.vault', 'chatml-secure-storage');
      const client = await stronghold.createClient('auth');
      const store = client.getStore();
      await store.remove('github_token');
      await stronghold.save();
    } catch {
      // Ignore errors
    }
  } else {
    localStorage.removeItem('github_token');
  }
}

/**
 * Send token to backend (on app startup)
 */
export async function sendTokenToBackend(token: string): Promise<{ user: GitHubUser }> {
  const res = await fetch(`${API_BASE}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    throw new Error('Token validation failed');
  }

  return res.json();
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

  try {
    const { user } = await sendTokenToBackend(token);
    return { authenticated: true, user };
  } catch {
    // Token invalid, clear it
    await clearToken();
    return { authenticated: false };
  }
}

/**
 * Listen for OAuth callback events from Tauri
 */
export async function listenForOAuthCallback(
  callback: (result: { token: string; user: GitHubUser }) => void,
  onError: (error: Error) => void
): Promise<() => void> {
  const unlisten = await listen<string>('oauth-callback', async (event) => {
    try {
      const result = await handleOAuthCallback(event.payload);
      await storeToken(result.token);
      callback(result);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return unlisten;
}
```

**Step 2: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat(frontend): add auth API functions"
```

---

## Task 10: Create Auth Store

**Files:**
- Create: `src/stores/authStore.ts`

**Step 1: Write the auth store**

```typescript
// src/stores/authStore.ts
import { create } from 'zustand';
import type { GitHubUser } from '@/lib/auth';

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: GitHubUser | null;
  error: string | null;

  // Actions
  setLoading: (loading: boolean) => void;
  setAuthenticated: (authenticated: boolean, user?: GitHubUser | null) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoading: true, // Start with loading while checking auth
  isAuthenticated: false,
  user: null,
  error: null,

  setLoading: (isLoading) => set({ isLoading }),

  setAuthenticated: (isAuthenticated, user = null) => set({
    isAuthenticated,
    user,
    isLoading: false,
    error: null,
  }),

  setError: (error) => set({
    error,
    isLoading: false,
  }),

  reset: () => set({
    isLoading: false,
    isAuthenticated: false,
    user: null,
    error: null,
  }),
}));
```

**Step 2: Commit**

```bash
git add src/stores/authStore.ts
git commit -m "feat(frontend): add auth store for state management"
```

---

## Task 11: Create Onboarding Screen Component

**Files:**
- Create: `src/components/OnboardingScreen.tsx`

**Step 1: Write the onboarding screen**

```typescript
// src/components/OnboardingScreen.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Github, Loader2 } from 'lucide-react';
import { startOAuthFlow } from '@/lib/auth';
import { useAuthStore } from '@/stores/authStore';

export function OnboardingScreen() {
  const [isConnecting, setIsConnecting] = useState(false);
  const { error, setError } = useAuthStore();

  const handleSignIn = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      await startOAuthFlow();
      // OAuth callback will be handled by listener in page.tsx
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sign in');
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center space-y-8 p-8">
        {/* Logo */}
        <div className="flex flex-col items-center space-y-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500">
            <span className="text-4xl font-bold text-white">C</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">ChatML</h1>
        </div>

        {/* Tagline */}
        <p className="text-center text-lg text-muted-foreground">
          Your AI coding companion
        </p>

        {/* Sign in button */}
        <Button
          size="lg"
          onClick={handleSignIn}
          disabled={isConnecting}
          className="h-12 px-8 text-base"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Github className="mr-2 h-5 w-5" />
              Sign in with GitHub
            </>
          )}
        </Button>

        {/* Error message */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          By signing in, you agree to grant ChatML access to your repositories.
        </p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/OnboardingScreen.tsx
git commit -m "feat(frontend): add onboarding screen component"
```

---

## Task 12: Integrate Auth Flow in Main Page

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add auth initialization and conditional rendering**

At the top of the file, add imports:
```typescript
import { useAuthStore } from '@/stores/authStore';
import { OnboardingScreen } from '@/components/OnboardingScreen';
import { initAuth, listenForOAuthCallback } from '@/lib/auth';
```

**Step 2: Add auth check in useEffect**

Inside the main component, add:
```typescript
const { isLoading, isAuthenticated, setAuthenticated, setError } = useAuthStore();

// Initialize auth on mount
useEffect(() => {
  let unlistenOAuth: (() => void) | null = null;

  const init = async () => {
    // Set up OAuth callback listener
    unlistenOAuth = await listenForOAuthCallback(
      (result) => {
        setAuthenticated(true, result.user);
      },
      (error) => {
        setError(error.message);
      }
    );

    // Check for existing auth
    const status = await initAuth();
    setAuthenticated(status.authenticated, status.user);
  };

  init();

  return () => {
    if (unlistenOAuth) unlistenOAuth();
  };
}, []);
```

**Step 3: Add conditional rendering**

At the start of the render:
```typescript
// Show loading while checking auth
if (isLoading) {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// Show onboarding if not authenticated
if (!isAuthenticated) {
  return <OnboardingScreen />;
}

// ... rest of the existing UI
```

**Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(frontend): integrate auth flow in main page"
```

---

## Task 13: Add Environment Variables

**Files:**
- Modify: `.env.example` (create if doesn't exist)
- Modify: `src-tauri/tauri.dev.conf.json`

**Step 1: Create/update .env.example**

```bash
# GitHub OAuth
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Frontend (prefix with NEXT_PUBLIC_ to expose to browser)
NEXT_PUBLIC_GITHUB_CLIENT_ID=your_github_client_id
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add environment variables example for GitHub OAuth"
```

---

## Task 14: Update Design Document with Implementation Notes

**Files:**
- Modify: `docs/plans/2026-01-19-github-oauth-onboarding-design.md`

**Step 1: Add implementation notes**

Add a section at the end with any discovered implementation details or deviations from the original design.

**Step 2: Commit**

```bash
git add docs/plans/2026-01-19-github-oauth-onboarding-design.md
git commit -m "docs: update design doc with implementation notes"
```

---

## Task 15: Manual Testing Checklist

Before creating PR, manually verify:

1. [ ] App starts and shows loading state
2. [ ] Without token, onboarding screen appears
3. [ ] "Sign in with GitHub" button opens browser
4. [ ] After authorizing in GitHub, app receives callback
5. [ ] Token is stored (check via backend /api/auth/status)
6. [ ] On app restart, user stays logged in
7. [ ] Logout clears token and shows onboarding again

---

## Summary

**Files created:**
- `backend/github/client.go`
- `backend/github/client_test.go`
- `backend/server/auth_handlers.go`
- `backend/server/auth_handlers_test.go`
- `src/lib/auth.ts`
- `src/stores/authStore.ts`
- `src/components/OnboardingScreen.tsx`

**Files modified:**
- `backend/go.mod`
- `backend/go.sum`
- `backend/server/config.go`
- `backend/server/router.go`
- `backend/main.go`
- `src-tauri/Cargo.toml`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src/app/page.tsx`
