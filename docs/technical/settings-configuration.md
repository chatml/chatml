# Settings & Configuration

ChatML has a three-tier settings system: backend settings (stored in SQLite), frontend settings (stored in Zustand/localStorage), and per-workspace settings. This document covers all settings, their storage, and how they're applied.

## Backend Settings

Backend settings are stored in SQLite as key-value pairs and managed through REST API endpoints.

### Global Settings

| Setting | Endpoint | Description |
|---------|----------|-------------|
| Workspaces base directory | `GET/PUT /api/settings/workspaces-base-dir` | Where session worktrees are stored (default: `~/.chatml/workspaces`) |
| Review prompts | `GET/PUT /api/settings/review-prompts` | Default system prompt for code review conversations |
| Environment variables | `GET/PUT /api/settings/env` | Environment variables passed to agent processes |
| PR template | `GET/PUT /api/settings/pr-template` | Default PR description template |
| Anthropic API key | `GET/PUT /api/settings/anthropic-api-key` | Claude API key (encrypted) |
| Claude auth status | `GET /api/settings/claude-auth-status` | Whether Claude authentication is configured |

### Per-Workspace Settings

Each workspace can override global settings:

| Setting | Endpoint | Description |
|---------|----------|-------------|
| Branch prefix | `PATCH /api/repos/{id}` | Branch naming: "github", "custom", "none" |
| Custom prefix | `PATCH /api/repos/{id}` | Custom prefix value |
| Review prompts | `GET/PUT /api/repos/{id}/settings/review-prompts` | Workspace-specific review prompts |
| PR template | `GET/PUT /api/repos/{id}/settings/pr-template` | Workspace-specific PR template |
| MCP servers | `GET/PUT /api/repos/{id}/mcp-servers` | Custom MCP server configurations |
| Workspace config | `GET/PUT /api/repos/{id}/config` | Scripts, hooks, and auto-setup |

### MCP Server Configuration

Users can configure custom MCP servers per workspace:

```typescript
interface McpServerConfig {
  name: string;
  type: 'stdio' | 'sse' | 'http';
  command?: string;       // For stdio: executable path
  args?: string[];        // For stdio: command arguments
  env?: Record<string, string>; // For stdio: environment variables
  url?: string;           // For sse/http: server URL
  headers?: Record<string, string>; // For sse/http: request headers
  enabled: boolean;
}
```

Three transport types are supported:
- **stdio** — The MCP server runs as a child process, communicating via stdin/stdout
- **sse** — The MCP server is accessed via Server-Sent Events
- **http** — The MCP server is accessed via HTTP

### Workspace Configuration

**File: `.chatml/config.json`** (per workspace)

```typescript
interface ChatMLConfig {
  setupScripts: ScriptDef[];           // Scripts to run on session creation
  runScripts: Record<string, ScriptDef>; // Named scripts available to run
  hooks: Record<string, string>;       // Event hooks
  autoSetup: boolean;                  // Auto-run setup scripts
}
```

ChatML can auto-detect configuration from the workspace (e.g., detecting `package.json` for Node.js projects).

## Frontend Settings

Frontend settings are managed through the `settingsStore` Zustand store and persisted in localStorage.

### AI Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Model | `claude-sonnet-4-6` | Claude model to use |
| Extended thinking | false | Enable extended thinking |
| Max thinking tokens | 50000 | Token budget for thinking |
| Fallback model | — | Model when primary fails |

### Appearance Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Theme | system | Visual theme (light/dark/system) |
| Font size | 14px | Code and UI font size |

### Git Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Branch prefix | "github" | Branch naming strategy |
| Custom prefix | — | Custom prefix when strategy is "custom" |

### Session Settings

Settings that affect session behavior:
- **Tool preset** — Default tool access level for new conversations
- **Enable checkpointing** — Whether to create file checkpoints
- **Budget controls** — Default cost/turn/thinking limits

## Credential Storage

### Anthropic API Key

The API key is stored encrypted in the backend:
- **Storage**: SQLite settings table
- **Encryption**: AES-256-GCM
- **Access**: Only the Go backend can decrypt; the frontend never sees the raw key

### OAuth Tokens

OAuth tokens (GitHub, Linear) are stored in Tauri's Stronghold vault:
- **Storage**: Stronghold encrypted vault file
- **Encryption**: AES-256 with Argon2id-derived keys
- **Salt**: Fixed application-specific salt (`b"chatml-stronghld"`)
- **Key derivation**: Argon2id with 4 MiB memory, 1 iteration, 32-byte output

The Stronghold vault is a Rust-based encrypted storage designed for secrets. It uses memory protection to prevent sensitive data from being swapped to disk.

### Deep Link OAuth Flow

OAuth callbacks use deep links (`chatml://oauth/...`):

1. Frontend opens OAuth provider URL in the system browser
2. User authorizes the application
3. Provider redirects to `chatml://oauth/callback?code=...`
4. Tauri deep link handler catches the URL
5. Frontend calls the backend to exchange the code for a token
6. Token is stored in Stronghold

## Settings UI

The settings modal has 8 sections:

| Section | Contents |
|---------|----------|
| **General** | Workspaces base directory |
| **Appearance** | Theme, font size |
| **AI** | Model selection, thinking, budget controls |
| **Git** | Branch prefix configuration |
| **Review** | Review prompt customization |
| **Account** | GitHub OAuth, Linear OAuth, API key |
| **Advanced** | Environment variables, MCP servers, PR templates |
| **About** | Version information |

## Configuration Precedence

When multiple settings levels exist, the most specific wins:

1. **Per-conversation** — Model override for a specific conversation
2. **Per-workspace** — Workspace-specific overrides (review prompts, MCP servers, branch prefix)
3. **Global** — Application-wide defaults

For branch prefix specifically:
- If the workspace has `branchPrefix` set, use it
- If the workspace has `branchPrefix` as empty string (`""`), use the global setting
- If no global setting, default to "github" (GitHub username prefix)

## Related Documentation

- [Product Overview](../product-overview.md)
- [Onboarding & Authentication](../desktop/onboarding-authentication.md)
- [Data Models & Persistence](../architecture/data-models-and-persistence.md)
