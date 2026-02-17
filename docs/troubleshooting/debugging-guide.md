# Debugging Guide

ChatML's polyglot architecture means debugging can span four languages across five processes. This guide covers the tools and techniques for each layer, plus cross-layer debugging strategies.

## Table of Contents

1. [Architecture Overview for Debugging](#architecture-overview-for-debugging)
2. [Frontend Debugging](#frontend-debugging)
3. [Go Backend Debugging](#go-backend-debugging)
4. [Agent Runner Debugging](#agent-runner-debugging)
5. [Tauri Shell Debugging](#tauri-shell-debugging)
6. [Cross-Layer Debugging](#cross-layer-debugging)
7. [Log Locations](#log-locations)
8. [Common Debugging Scenarios](#common-debugging-scenarios)

---

## Architecture Overview for Debugging

Understanding which process handles what is the first step in debugging:

```
┌─────────────────────────────────────────────────┐
│ Tauri Shell (Rust)                              │
│   - Manages sidecar (Go backend)                │
│   - File watching, native dialogs, deep links   │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Next.js Frontend (Browser/WebView)        │  │
│  │   - React components, Zustand stores      │  │
│  │   - WebSocket client                      │  │
│  │   - Debug with: Chrome DevTools           │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Go Backend (Sidecar process)              │  │
│  │   - REST API, WebSocket hub               │  │
│  │   - Agent manager, SQLite store           │  │
│  │   - Debug with: Delve, structured logs    │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Agent Runner (Node.js, per conversation)  │  │
│  │   - Claude SDK, MCP tools                 │  │
│  │   - Debug with: --inspect, console output │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Frontend Debugging

### Chrome DevTools

The frontend runs in a WebView (or browser during development). Access DevTools:

- **Development mode** (`npm run dev`): Open `http://localhost:3000` in Chrome, use standard DevTools (F12)
- **Tauri app**: Right-click in the app window and select "Inspect Element", or use the Tauri debug build

### Useful DevTools Panels

**Console** — Check for:
- React errors and warnings
- WebSocket connection/disconnection messages
- Zustand store state changes (if logging middleware is enabled)

**Network** — Check for:
- REST API call failures (red entries in the XHR/Fetch filter)
- WebSocket frame inspection (WS tab shows all events flowing through)
- Rate limit responses (HTTP 429)

**Performance** — Use for:
- Identifying components re-rendering too frequently during streaming
- Finding bottlenecks in the rendering pipeline

### Inspecting Zustand Store State

Access store state from the browser console:

```javascript
// Access any Zustand store's state
// (Store instances are in module scope - this works in dev mode)

// Check streaming state
document.querySelector('[data-testid="message-list"]');

// The React DevTools extension shows component props and hooks,
// including useStore results
```

### WebSocket Event Inspection

Monitor WebSocket events in the Network tab:
1. Open DevTools > Network > WS
2. Click the WebSocket connection
3. The Messages tab shows all events with their JSON payloads
4. Filter by event type in the search

### Common Frontend Issues

- **Stale closures**: If a callback uses an old value, check that dependencies are correct in `useEffect`/`useCallback`
- **Missing re-renders**: Use `useShallow` with Zustand selectors for object comparisons. Without it, new object references trigger unnecessary renders.
- **Memory leaks**: Check for uncleared intervals/timeouts in useEffect cleanup functions

---

## Go Backend Debugging

### Structured Logging

The backend uses `chi/middleware.Logger` for HTTP request logging. Requests are logged to stderr with method, path, status, and duration.

### Running with Verbose Output

```bash
# Run backend directly with full output
cd backend && go run ./... 2>&1 | tee backend.log

# Or with environment variables for debugging
CHATML_DEBUG=1 cd backend && go run ./...
```

### Delve Debugger

For interactive debugging:

```bash
# Install Delve
go install github.com/go-delve/delve/cmd/dlv@latest

# Start with debugger
cd backend && dlv debug ./...

# Attach to running process
dlv attach <pid>

# Common breakpoint locations:
# break backend/server/handlers.go:100    (API handlers)
# break backend/agent/manager.go:50       (Agent management)
# break backend/store/sqlite.go:200       (Database operations)
# break backend/server/websocket.go:200   (WebSocket hub)
```

### Race Condition Detection

```bash
cd backend && go test -race ./...
```

The `-race` flag instruments the binary to detect concurrent access to shared state. Particularly useful for:
- WebSocket hub client map access
- Agent manager process map
- SQLite connection pool
- Streaming snapshot updates

### Database Inspection

SQLite databases can be inspected directly:

```bash
# Open the database
sqlite3 ~/.chatml/chatml.db

# Useful queries:
.tables                                    # List all tables
SELECT * FROM repos;                       # List workspaces
SELECT * FROM sessions WHERE status='active';  # Active sessions
SELECT COUNT(*) FROM messages WHERE conversation_id='xxx';  # Message count
SELECT key, value FROM settings;           # All settings
.schema messages                           # Show table schema
```

### WebSocket Hub Diagnostics

The hub exposes metrics via `GET /ws/stats`:

```bash
curl http://localhost:9876/ws/stats -H "Authorization: Bearer <token>"
```

Key metrics to check:
- `messagesDropped > 0`: Clients are being evicted for slowness
- `messagesTimedOut > 0`: The broadcast channel is backing up
- `broadcastBackpressure > 0`: Hub buffer exceeded 75%

---

## Agent Runner Debugging

### Node.js Inspector

Attach a debugger to the agent runner process:

```bash
# The agent runner is spawned by the Go backend with these args:
# node agent-runner/dist/index.js --cwd <path> --conversation-id <id>

# To debug manually, run with --inspect:
node --inspect agent-runner/dist/index.js \
  --cwd /path/to/worktree \
  --conversation-id test-conv

# Then open chrome://inspect in Chrome to attach
```

### Stdout/Stderr Monitoring

The agent runner communicates via JSON lines on stdout. The Go backend reads these in `process.go`. To see raw output:

```bash
# If running the agent manually, stdout shows all events:
node agent-runner/dist/index.js --cwd . --conversation-id test 2>agent-stderr.log
```

Stderr output is prefixed and forwarded to the backend's logger. Check for:
- SDK initialization errors
- MCP server connection failures
- Tool execution errors
- Process crash stack traces

### MCP Server Debugging

If custom MCP servers aren't working:

1. Check the server configuration in Settings > Advanced > MCP Servers
2. For stdio servers: verify the command and args are correct by running manually
3. For SSE/HTTP servers: verify the URL is accessible
4. Check agent runner stderr for MCP connection error messages

### Claude API Debugging

If API calls are failing:

1. Check the API key is valid: Settings > Account > Anthropic API Key
2. Verify the model name is correct: `claude-sonnet-4-6`, `claude-opus-4-6`, etc.
3. Check for rate limiting from the Claude API (different from ChatML's internal rate limits)
4. Look for `error` events in the WebSocket stream with API-specific error codes

---

## Tauri Shell Debugging

### Tauri Dev Mode

```bash
# Run with Tauri dev tools enabled
make dev
# Or: cargo tauri dev
```

In dev mode, the WebView has DevTools enabled and the Rust backend logs to the terminal.

### Rust Logging

Tauri uses the `log` crate. Set the log level:

```bash
RUST_LOG=debug cargo tauri dev
```

### Sidecar Process Monitoring

The Tauri shell manages the Go backend as a sidecar:

1. **Port discovery**: Tauri spawns the backend, which writes its port to a known location
2. **Health monitoring**: Periodic `GET /health` checks
3. **Restart**: If the backend crashes, Tauri restarts it

Debug sidecar issues by checking:
- The terminal output when running `cargo tauri dev`
- Whether the backend process is running: `ps aux | grep chatml-backend`
- Port allocation: `lsof -i :9876-9899`

### File Watcher Debugging

The notify crate watches for file changes in worktrees. If file changes aren't being detected:

1. Check the watcher is running: Tauri logs should show watcher initialization
2. Verify the watched path is correct
3. Some filesystems (network mounts) may not support `inotify`/`FSEvents` properly
4. The watcher uses debouncing — rapid changes are coalesced

---

## Cross-Layer Debugging

### Tracing a Message Through the Stack

When a user sends a message, it flows through every layer. To trace the complete path:

1. **Frontend**: Check Network tab for `POST /api/conversations/{convId}/messages` (or `POST .../conversations` for new conversations)
2. **Go Backend**: Check HTTP logs for the request arriving, then look for agent process spawn in the agent manager logs
3. **Agent Runner**: Check stdout for the initial message receipt, SDK initialization, and the first API call
4. **WebSocket**: Check the WS Messages tab for events flowing back: `init` → `assistant_text` → `tool_start` → `tool_end` → `result` → `complete`

### Debugging Event Delivery

If events aren't reaching the frontend:

1. **Check the agent is running**: `GET /api/conversations/{convId}` should show status `active`
2. **Check the WebSocket is connected**: Network tab should show the WS connection as open
3. **Check hub broadcast**: `GET /ws/stats` shows if messages are being dropped
4. **Check the streaming snapshot**: `GET /api/conversations/{convId}/streaming-snapshot` shows buffered state

### Process Crash Debugging

If a process crashes:

| Process | Where to look | What to check |
|---------|--------------|---------------|
| Frontend | Browser console | JavaScript errors, React error boundaries |
| Go Backend | Terminal / sidecar logs | Panic stack traces, `recovered from panic` middleware output |
| Agent Runner | Backend logs (stderr forwarding) | Node.js stack traces, SDK errors |
| Tauri Shell | `cargo tauri dev` terminal | Rust panics, plugin errors |

---

## Log Locations

| Component | Location | Content |
|-----------|----------|---------|
| Frontend | Browser DevTools Console | React errors, WebSocket events, store operations |
| Go Backend | stderr (terminal or sidecar capture) | HTTP requests, agent lifecycle, database operations |
| Agent Runner | stderr (forwarded to Go backend with prefix) | SDK events, tool execution, MCP server connections |
| Tauri Shell | `cargo tauri dev` terminal | Sidecar management, file watcher, IPC commands |
| SQLite | `~/.chatml/chatml.db` | All persistent state (queryable) |

---

## Common Debugging Scenarios

### Scenario: Conversation starts but no text appears

1. Open browser DevTools > Network > WS
2. Check if `init` event was received (agent started)
3. Check if `assistant_text` events are arriving
4. If no events: check `GET /ws/stats` for connection issues
5. If `init` received but no text: check agent runner stderr for API errors

### Scenario: Tool shows as "running" indefinitely

1. Check the WebSocket for a matching `tool_end` event
2. If no `tool_end`: the agent may be stuck. Stop the conversation and retry
3. If `tool_end` was sent: check if the frontend received it (WS Messages tab)
4. The frontend has a tool timeout display — tools showing "timed out" had no `tool_end` within the expected window

### Scenario: Session creation fails

1. Check the REST API response for error details
2. Common causes:
   - Git worktree creation failed (branch already checked out elsewhere)
   - Base directory doesn't exist or isn't writable
   - The repository path is invalid or not a git repository
3. Check `git worktree list` in the workspace repository for conflicts

### Scenario: PR creation fails

1. Check GitHub authentication: `GET /api/auth/status`
2. Verify the branch has been pushed to remote
3. Check if a PR already exists for the branch
4. Look at the REST API error response — GitHub's error messages are usually informative

### Scenario: Database errors

1. Check if the database file exists: `ls -la ~/.chatml/chatml.db`
2. Verify it's not corrupted: `sqlite3 ~/.chatml/chatml.db "PRAGMA integrity_check;"`
3. Check WAL file size: `ls -la ~/.chatml/chatml.db-wal` (very large WAL may indicate stuck checkpoint)
4. Check for lock contention: `lsof ~/.chatml/chatml.db`

---

## Related Documentation

- [Common Issues](./common-issues.md)
- [Getting Started](../development/getting-started.md)
- [Testing Strategy](../development/testing-strategy.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
