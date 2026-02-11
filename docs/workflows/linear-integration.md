# Linear Integration

ChatML integrates with Linear for issue tracking, providing automatic issue discovery, OAuth authentication, and issue operations through the AI agent.

## Issue Discovery

The agent runner automatically discovers Linear issues through three methods, tried in priority order:

### 1. CLI Argument

The highest priority. When the Go backend knows the Linear issue, it passes it directly:

```
--linear-issue CHA-123
```

### 2. Branch Name

If no CLI argument, the branch name is scanned for issue patterns:

```
feature/CHA-123-add-auth  →  CHA-123
fix/LIN-456-login-bug     →  LIN-456
```

Pattern: Any `[A-Z]+-\d+` match in the branch name.

### 3. Recent Commits

If the branch name doesn't contain an issue reference, the last 5 commits are scanned:

```
git log -5 --pretty=format:"%s"
```

Any `[A-Z]+-\d+` pattern in commit messages is extracted.

## OAuth Authentication

### Flow

1. **Initiate** — Frontend opens Linear's OAuth authorization URL
2. **User authorizes** — User grants ChatML access in Linear's UI
3. **Callback** — Linear redirects to `chatml://oauth/linear/callback?code=...`
4. **Token exchange** — `POST /api/auth/linear/callback` exchanges the code for an access token
5. **Storage** — Token stored securely in Tauri's Stronghold vault

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/linear/callback` | Exchange OAuth code for token |
| `GET` | `/api/auth/linear/status` | Check authentication status |
| `POST` | `/api/auth/linear/logout` | Revoke and clear token |

## Issue Context

When a Linear issue is discovered, it's made available to the AI agent through the `WorkspaceContext` MCP class. The `get_session_status` MCP tool includes the resolved issue information.

This means Claude can:
- Reference the issue title and description in its work
- Understand the context of what needs to be built
- Create commits that reference the issue

## Related Documentation

- [Settings & Configuration](../technical/settings-configuration.md)
- [Session Lifecycle Management](../technical/session-lifecycle-management.md)
