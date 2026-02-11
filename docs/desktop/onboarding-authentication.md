# Onboarding & Authentication

ChatML includes a first-run onboarding wizard and supports multiple authentication methods for accessing external services.

## Onboarding Wizard

The onboarding wizard guides new users through initial setup in 6 steps:

### Step 1: Welcome

Introduction to ChatML's capabilities and development philosophy. Explains the concept of isolated git worktrees and parallel AI sessions.

### Step 2: API Key Configuration

Users configure their Claude API access. Options:
- **Anthropic API key** — Enter an API key directly (stored encrypted with AES-256-GCM)
- **Claude authentication** — Use existing Claude credentials

The API key is validated by making a test request before proceeding.

### Step 3: Add Workspaces

Users register their git repositories as workspaces. The wizard:
- Allows browsing the filesystem via native dialog
- Detects git repositories at the selected path
- Reads the default branch and remote configuration
- Stores the workspace in the database

### Step 4: Create First Session

Walks through creating the first session:
- Select a workspace
- Choose or accept a session name
- Explain that a git worktree and branch will be created

### Step 5: Start First Conversation

Demonstrates sending the first message:
- Type a message in the input
- Watch the agent streaming response
- See tool execution in real-time

### Step 6: Keyboard Shortcuts

Quick reference of essential shortcuts:
- `Cmd+K` — Command palette
- `Enter` — Send message
- `Cmd+Shift+S` — Stop agent
- `Cmd+N` — New session

## Authentication Methods

### GitHub OAuth

Required for: PR creation, CI monitoring, issue tracking, avatar display.

**Flow:**
1. User clicks "Connect GitHub" in settings
2. Frontend opens GitHub OAuth URL in system browser
3. User authorizes the ChatML application
4. GitHub redirects to `chatml://oauth/callback?code=...`
5. Tauri's deep-link handler catches the URL
6. Frontend sends code to `POST /api/auth/github/callback`
7. Backend exchanges code for access token
8. Token stored in Stronghold vault

**Scopes requested:** `repo`, `read:user` (for repository access and user profile)

**API endpoints:**
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/github/callback` | Exchange OAuth code |
| `POST` | `/api/auth/token` | Set token directly |
| `GET` | `/api/auth/status` | Check auth status |
| `POST` | `/api/auth/logout` | Clear credentials |

### Linear OAuth

Required for: Issue tracking, issue context in agent sessions.

**Flow:** Similar to GitHub OAuth but with Linear's authorization server.

**API endpoints:**
| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/linear/callback` | Exchange OAuth code |
| `GET` | `/api/auth/linear/status` | Check auth status |
| `POST` | `/api/auth/linear/logout` | Clear credentials |

### Anthropic API Key

Required for: Claude AI access.

The API key is stored encrypted in the SQLite database:
- **Encryption:** AES-256-GCM
- **Access:** Only the Go backend decrypts; frontend never sees the raw key
- **Validation:** Test request on save

**API endpoints:**
| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/settings/anthropic-api-key` | Check if key exists (masked) |
| `PUT` | `/api/settings/anthropic-api-key` | Set or update key |
| `GET` | `/api/settings/claude-auth-status` | Check authentication status |

## Credential Storage

### Stronghold Vault

OAuth tokens are stored in Tauri's Stronghold vault:
- **Location:** App data directory
- **Encryption:** AES-256 with Argon2id-derived keys
- **Salt:** Fixed application-specific (`b"chatml-stronghld"`)
- **Parameters:** 4 MiB memory, 1 iteration, 32-byte key

Stronghold provides memory protection — sensitive data in memory is guarded against swap-to-disk and cold boot attacks.

### Deep Link Protocol

ChatML registers the `chatml://` URL protocol for OAuth callbacks. When an OAuth provider redirects to this URL:

1. macOS routes the URL to the ChatML application
2. Tauri's deep-link plugin captures the URL
3. The URL parameters (authorization code) are extracted
4. The frontend is notified via an event
5. The code is exchanged for a token via the backend

## Related Documentation

- [Settings & Configuration](../technical/settings-configuration.md)
- [Tauri Shell Architecture](./tauri-shell-architecture.md)
