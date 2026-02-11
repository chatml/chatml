# Common Issues

This document covers frequently encountered issues in ChatML, organized by category. Each entry includes symptoms, root cause, and solution.

## Table of Contents

1. [Installation & Startup](#installation--startup)
2. [Connection Issues](#connection-issues)
3. [Agent & Conversation Issues](#agent--conversation-issues)
4. [Git & Worktree Issues](#git--worktree-issues)
5. [Authentication Issues](#authentication-issues)
6. [Performance Issues](#performance-issues)
7. [UI Issues](#ui-issues)

---

## Installation & Startup

### Backend fails to start

**Symptoms:** App opens but shows "Connecting..." indefinitely. No conversations possible.

**Root cause:** The Go backend sidecar failed to start or couldn't bind to a port.

**Solution:**
1. Check if another ChatML instance is running: `lsof -i :9876-9899`
2. Kill stale processes: `pkill -f chatml-backend`
3. Check backend logs in the Tauri app data directory (look for `sidecar` log output)
4. Ensure ports 9876-9899 aren't blocked by a firewall

### "Port already in use" error

**Symptoms:** Backend starts but immediately exits. App shows connection error.

**Root cause:** Another process occupies the default port (9876). ChatML tries ports 9876-9899 sequentially.

**Solution:**
1. Identify the process: `lsof -i :9876`
2. If it's a stale ChatML instance, kill it: `kill <pid>`
3. If all ports 9876-9899 are occupied, free at least one

### Missing dependencies after update

**Symptoms:** Build fails or features missing after updating ChatML.

**Solution:**
```bash
npm install                    # Frontend dependencies
cd backend && go mod download  # Backend dependencies
cd agent-runner && npm install # Agent runner dependencies
```

---

## Connection Issues

### WebSocket disconnects frequently

**Symptoms:** Streaming responses cut off mid-sentence. "Reconnecting..." appears in the UI.

**Root cause:** The ping/pong heartbeat failed within the 60-second pong timeout.

**Solution:**
1. Check system sleep settings — sleep interrupts WebSocket connections
2. Look for `streaming_warning` events in the browser console indicating backpressure
3. Check `GET /ws/stats` for `clientsDropped` count — if non-zero, the client is too slow to consume events

### "Streaming data may have been lost" warning

**Symptoms:** Yellow toast notification about potential data loss.

**Root cause:** The WebSocket Hub's broadcast buffer exceeded 75% capacity, indicating the client can't keep up with events.

**Solution:**
1. Close unnecessary browser tabs to free resources
2. Check if the agent is producing unusually high output (large file reads/writes)
3. This is usually transient during bursts of tool activity — the data often catches up

### Frontend shows stale conversation state

**Symptoms:** Messages appear out of order or tool actions show incorrect status after reconnecting.

**Root cause:** Events were missed during a WebSocket disconnect.

**Solution:**
1. Refresh the page — the frontend fetches all messages via REST on load
2. Check the streaming snapshot: the `GET /api/conversations/{convId}/streaming-snapshot` endpoint provides recovery state
3. If the conversation is still active, new events will resume streaming on reconnect

---

## Agent & Conversation Issues

### Agent not responding after sending message

**Symptoms:** Message sent but no streaming response appears. Status stays "active" indefinitely.

**Root cause:** The agent process may have crashed or is stuck waiting for a tool.

**Solution:**
1. Stop the conversation: click the stop button or `POST /api/conversations/{convId}/stop`
2. Send a new message — a fresh agent process will spawn
3. Check if the rate limiter is blocking: 60 messages/min, 20 conversations/min, 10 agent spawns/min

### "API key not configured" error

**Symptoms:** Conversations fail immediately with an API key error.

**Root cause:** The Anthropic API key is missing or invalid.

**Solution:**
1. Go to Settings > Account > Anthropic API Key
2. Enter a valid `sk-ant-api03-...` key
3. The key is validated with a test request before being saved
4. If using Claude authentication instead, check Settings > Account > Claude Auth Status

### Agent process consuming too much memory

**Symptoms:** System slows down with multiple active conversations. Each agent process uses 50-100MB+.

**Root cause:** Each conversation spawns a separate Node.js process with its own memory allocation.

**Solution:**
1. Stop conversations that aren't actively being used
2. Reduce the number of concurrent active conversations
3. Use budget controls (`maxBudgetUsd`, `maxTurns`) to limit long-running conversations
4. Consider using the `read-only` or `safe-edit` tool presets for review conversations (less memory-intensive)

### Extended thinking not working

**Symptoms:** Responses don't include thinking content even when enabled.

**Root cause:** Extended thinking requires specific model versions and token budget configuration.

**Solution:**
1. Check Settings > AI > Extended Thinking is enabled
2. Ensure Max Thinking Tokens is set (default: 50000)
3. Verify the selected model supports extended thinking
4. Some tool presets may not surface thinking content

### Conversation stuck in "active" status

**Symptoms:** The conversation shows as active but no events are arriving.

**Root cause:** The agent process may have exited without sending a `result` or `complete` event.

**Solution:**
1. Stop the conversation explicitly
2. Check the streaming snapshot endpoint for any buffered state
3. Send a new message to restart the agent process

---

## Git & Worktree Issues

### "Branch already checked out in another worktree"

**Symptoms:** Session creation fails with `ErrBranchAlreadyCheckedOut`.

**Root cause:** Git only allows a branch to be checked out in one worktree at a time.

**Solution:**
1. Use a different branch name for the new session
2. Delete the session that has the branch checked out (if no longer needed)
3. If the worktree is stale, manually remove it: `git worktree remove <path>`

### Session worktree directory missing

**Symptoms:** Session exists in the sidebar but operations fail with "directory not found".

**Root cause:** The worktree directory under `~/.chatml/workspaces/` was manually deleted or moved.

**Solution:**
1. Delete the session from ChatML (it will clean up the database record)
2. Create a new session — a fresh worktree will be created
3. To recover: `git worktree list` shows all worktrees. If the worktree is listed but missing, `git worktree prune` cleans up stale entries

### Merge conflicts during branch sync

**Symptoms:** Branch sync shows "has conflicts" status. Files show conflict markers.

**Root cause:** Changes on the session branch conflict with changes on the base branch.

**Solution:**
1. Use the branch sync UI to see conflicting files
2. Open conflicting files in the editor and resolve manually
3. Or abort the sync: `POST /api/repos/{id}/sessions/{sessionId}/branch-sync/abort`
4. After resolving, the agent can help: ask it to "resolve the merge conflicts"

### Too many worktrees consuming disk space

**Symptoms:** `~/.chatml/workspaces/` directory is very large.

**Root cause:** Completed sessions still have worktrees on disk.

**Solution:**
1. Archive or delete sessions you're done with — this removes the worktree
2. Use the branch cleanup feature: `POST /api/repos/{id}/branches/analyze-cleanup` to find stale branches
3. Note: worktrees share git objects with the main repository, so they're smaller than full clones

---

## Authentication Issues

### GitHub OAuth callback fails

**Symptoms:** After authorizing on GitHub, the app doesn't receive the callback. Browser shows "can't open chatml:// URL".

**Root cause:** The `chatml://` deep link protocol isn't registered on the system.

**Solution:**
1. Restart ChatML — Tauri registers the protocol on launch
2. On macOS, check: `defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep chatml`
3. If the protocol isn't registered, reinstall the app

### GitHub token expired

**Symptoms:** PR creation, issue fetching, or CI operations fail with 401 errors.

**Root cause:** The OAuth token stored in Stronghold has expired or been revoked.

**Solution:**
1. Go to Settings > Account > GitHub
2. Click "Disconnect" then "Connect GitHub" to re-authorize
3. The new token replaces the old one in Stronghold

### Linear authentication not working

**Symptoms:** Linear issue context doesn't appear in conversations. Linear tools fail.

**Solution:**
1. Go to Settings > Account > Linear
2. Re-authorize the Linear integration
3. Verify the issue identifier format: `LIN-123` or `CHA-42` (team prefix + number)

---

## Performance Issues

### UI feels sluggish during streaming

**Symptoms:** Text appears in chunks rather than smoothly. Tool updates lag.

**Root cause:** Too many re-renders during high-frequency streaming events.

**Solution:**
1. This is usually temporary during burst activity
2. Close other browser tabs consuming resources
3. If persistent, check browser DevTools Performance tab for render bottlenecks
4. The frontend uses memoization and scoped selectors to minimize re-renders — if something appears broken, report it

### SQLite "database is locked" errors

**Symptoms:** Operations fail intermittently with database lock errors.

**Root cause:** Multiple concurrent writes exceeding SQLite's WAL mode capacity.

**Solution:**
1. This should be handled automatically by the retry logic (exponential backoff)
2. If persistent, reduce concurrent operations (fewer simultaneous conversations)
3. Check if another process has the database open: `lsof ~/.chatml/chatml.db`

### High CPU usage from file watching

**Symptoms:** `chatml` process shows sustained high CPU even when idle.

**Root cause:** The Tauri file watcher (notify crate) is monitoring a large directory tree with many changes.

**Solution:**
1. Ensure `node_modules/`, `.git/objects/`, and build output directories are excluded from watching
2. The watcher uses debouncing — check if something is generating continuous file changes

---

## UI Issues

### Mermaid diagrams not rendering

**Symptoms:** Mermaid code blocks show raw text instead of rendered diagrams.

**Root cause:** The Mermaid rendering library failed to initialize or the diagram syntax is invalid.

**Solution:**
1. Check browser console for Mermaid errors
2. Validate diagram syntax — ChatML uses Mermaid's latest supported version
3. Complex diagrams may fail silently; simplify and retry

### Code blocks missing syntax highlighting

**Symptoms:** Code appears as plain monospace text without color.

**Root cause:** Shiki (the syntax highlighter) doesn't have the language grammar loaded.

**Solution:**
1. Ensure the code block has a language identifier (e.g., ```typescript not just ```)
2. Uncommon languages may not be supported by the bundled Shiki grammars

### Keyboard shortcuts not working

**Symptoms:** `Cmd+K`, `Cmd+N`, etc. don't respond.

**Root cause:** Focus is on an element that captures keyboard events (editor, terminal, input field).

**Solution:**
1. Click outside any input/editor to restore global shortcut handling
2. Check Settings > Keyboard Shortcuts to verify bindings haven't been changed
3. Some shortcuts only work in specific contexts (e.g., `Cmd+Enter` in the message input)

### Dark mode not applying

**Symptoms:** Theme setting is "dark" but the app appears in light mode.

**Root cause:** The system theme override may conflict with the app setting.

**Solution:**
1. Go to Settings > Appearance > Theme
2. Set explicitly to "dark" (not "system")
3. If using "system", check macOS System Settings > Appearance

---

## Getting More Help

If none of the above resolves your issue:

1. Check the [Debugging Guide](./debugging-guide.md) for detailed diagnostic techniques
2. Look at backend logs for error messages
3. Check browser DevTools console for frontend errors
4. Review the WebSocket stats endpoint (`GET /ws/stats`) for connection issues

---

## Related Documentation

- [Debugging Guide](./debugging-guide.md)
- [Getting Started](../development/getting-started.md)
- [Settings & Configuration](../technical/settings-configuration.md)
