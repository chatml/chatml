# GitHub OAuth & Onboarding Design

## Overview

Add GitHub OAuth authentication with an onboarding screen. This is the first authentication system for the app and a prerequisite for the Checks Panel feature (which needs GitHub API access to fetch PR check statuses).

## Scope

**This branch:**
- Onboarding screen with "Sign in with GitHub" button
- GitHub OAuth flow via Tauri deep links
- Secure token storage (OS keychain)
- Backend endpoints for OAuth token exchange

**Future branch:**
- Checks Panel using authenticated GitHub API

---

## OAuth Flow Architecture

```
User clicks "Sign in with GitHub"
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tauri Frontend                                                 │
│  1. Generate state parameter (CSRF protection)                  │
│  2. Store state in memory                                       │
│  3. Open browser to GitHub OAuth URL:                           │
│     https://github.com/login/oauth/authorize                    │
│     ?client_id=XXX&redirect_uri=chatml://oauth/callback         │
│     &scope=repo,read:user&state=XXX                             │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  GitHub                                                         │
│  User authorizes app → redirects to chatml://oauth/callback     │
│  with ?code=XXX&state=XXX                                       │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tauri Deep Link Handler                                        │
│  1. Receive callback URL                                        │
│  2. Verify state matches                                        │
│  3. Send code to Go backend: POST /api/auth/github/callback     │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Go Backend                                                     │
│  1. Exchange code for token with GitHub API                     │
│  2. Fetch user info (GET /user)                                 │
│  3. Return token + user info to Tauri                           │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tauri Frontend                                                 │
│  1. Store token in secure storage (keychain)                    │
│  2. Store user info in app state                                │
│  3. Navigate to main workspace view                             │
└─────────────────────────────────────────────────────────────────┘
```

**Key decisions:**
- Deep link (`chatml://`) handles callback - no local server needed
- Backend exchanges code for token (keeps client_secret secure)
- Tauri stores token in keychain, passes to backend when needed

---

## Backend API Changes

### New Endpoints

```
POST /api/auth/github/callback
  Request:  { "code": "xxx", "state": "xxx" }
  Response: { "token": "gho_xxx", "user": { "login": "mcastilho", "avatar_url": "...", "name": "..." } }

  - Exchanges OAuth code for access token via GitHub API
  - Fetches user profile
  - Returns both to frontend (frontend stores token)

POST /api/auth/token
  Request:  { "token": "gho_xxx" }
  Response: { "ok": true }

  - Called by Tauri on app startup
  - Backend stores token in memory for GitHub API calls
  - No persistence to SQLite

GET /api/auth/status
  Response: { "authenticated": true, "user": { "login": "...", ... } }

  - Check if backend has a valid token
  - Returns user info if authenticated

POST /api/auth/logout
  Response: { "ok": true }

  - Clears token from backend memory
  - Frontend also clears keychain
```

### New Files

- `backend/github/client.go` - GitHub API client (OAuth token exchange, user fetch)
- `backend/server/auth_handlers.go` - Auth endpoint handlers

### Configuration

Environment variables:
- `GITHUB_CLIENT_ID` - OAuth app client ID
- `GITHUB_CLIENT_SECRET` - OAuth app client secret

---

## Tauri Changes

### Rust Changes

```
src-tauri/src/lib.rs:
  - Register deep link handler for chatml://oauth/callback
  - Add secure storage for token (keychain integration)

src-tauri/Cargo.toml:
  - Add tauri-plugin-deep-link
  - Add tauri-plugin-stronghold (or keyring crate)

src-tauri/capabilities/default.json:
  - Add deep-link permission
  - Add stronghold/keychain permission
```

---

## Frontend Changes

### New Files

```
src/components/OnboardingScreen.tsx
  - Centered card with logo, tagline, "Sign in with GitHub" button
  - Loading state during OAuth
  - Error state if OAuth fails

src/lib/auth.ts
  - initAuth() - check keychain for token, send to backend
  - startOAuthFlow() - generate state, open GitHub URL
  - handleOAuthCallback() - receive code, exchange via backend, store token
  - logout() - clear keychain, call backend logout

src/stores/authStore.ts (or extend appStore.ts)
  - isAuthenticated: boolean
  - user: { login, name, avatarUrl } | null
  - isLoading: boolean
```

### Modified Files

```
src/app/page.tsx
  - Check auth state on mount
  - Show OnboardingScreen if not authenticated
  - Show main app if authenticated
```

### Onboarding UI

```
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│              [ChatML Logo]               │
│                                          │
│         Your AI coding companion         │
│                                          │
│     ┌────────────────────────────┐       │
│     │  󰊤  Sign in with GitHub   │       │
│     └────────────────────────────┘       │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

---

## App Startup Flow

```
App Launch
    │
    ▼
Tauri initializes, Go backend starts
    │
    ▼
Frontend mounts, check secure storage for existing token
    │
    ├─── Token exists ───┐
    │                    ▼
    │         POST /api/auth/token (send to backend)
    │                    │
    │                    ▼
    │         GET /api/auth/status (verify valid)
    │                    │
    │            ┌───────┴───────┐
    │         Valid           Invalid
    │            │               │
    │            ▼               ▼
    │      Show Main App    Clear storage → Show Onboarding
    │
    └─── No token ───────────────────────→ Show Onboarding
```

### Auth State Transitions

| State | isLoading | isAuthenticated | user | UI Shown |
|-------|-----------|-----------------|------|----------|
| Initial | true | false | null | Splash/loading |
| Unauthenticated | false | false | null | OnboardingScreen |
| Authenticated | false | true | {...} | Main App |

---

## Security Considerations

1. **Token storage**: OS keychain (macOS Keychain, Windows Credential Manager) - not SQLite
2. **Client secret**: Stored only in backend env vars, never exposed to frontend
3. **CSRF protection**: State parameter validated on OAuth callback
4. **Token in memory**: Backend keeps token in memory only, not persisted to disk
