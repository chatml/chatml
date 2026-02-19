# Tauri Shell Architecture

ChatML uses Tauri 2 as its desktop shell, providing native macOS integration with a small binary size and secure credential storage. This document covers the sidecar management, IPC commands, plugins, and native features.

## Why Tauri Over Electron

| Factor | Tauri | Electron |
|--------|-------|----------|
| Bundle size | ~15MB | ~150MB |
| Memory usage | Lower (native webview) | Higher (bundled Chromium) |
| Security | Rust's memory safety, Stronghold vault | Node.js runtime risks |
| Native APIs | Direct access via Rust | Limited via Node.js |
| Auto-update | Built-in plugin | Requires electron-updater |

Tauri uses the system's WebKit webview rather than bundling Chromium, resulting in dramatically smaller binaries and lower memory usage.

## Plugin Stack

**File: `src-tauri/src/lib.rs`**

ChatML registers 13+ Tauri plugins:

| Plugin | Purpose |
|--------|---------|
| `single-instance` | Prevents multiple app instances, focuses existing window |
| `shell` | Opens URLs and files in default applications |
| `dialog` | Native file open/save dialogs |
| `clipboard-manager` | System clipboard access |
| `notification` | Desktop notifications |
| `pty` | Terminal emulation for the integrated terminal |
| `updater` | Automatic update detection and installation |
| `process` | Process management utilities |
| `decorum` | macOS traffic light customization |
| `window-state` | Remembers window position/size across launches |
| `deep-link` | Handles `chatml://` protocol URLs for OAuth callbacks |
| `stronghold` | Encrypted credential storage |
| `log` | Debug logging (development builds only) |
| `mcp-bridge` | MCP server bridge (development builds only) |

## Sidecar Management

**File: `src-tauri/src/sidecar.rs`**

The Go backend runs as a Tauri sidecar — a managed child process that Tauri starts, monitors, and restarts.

### Port Discovery

The sidecar scans ports 9876-9899 for an available port:

1. Try port 9876
2. If occupied, increment and try next
3. Once a port is found, store it in `AppState`
4. Frontend retrieves port via `get_backend_port` command

### Health Monitoring

After spawning the sidecar:
1. Wait for the process to start
2. Poll `http://localhost:{port}/health` for readiness
3. On success, emit `sidecar-ready` event to frontend
4. On failure after timeout, emit `sidecar-error` event

### Restart

The `restart_sidecar` command kills the existing process and spawns a new one, useful for recovering from crashes or configuration changes.

## IPC Commands

**File: `src-tauri/src/commands.rs`**

15+ commands are exposed to the frontend via Tauri's invoke system:

### App Management

| Command | Purpose |
|---------|---------|
| `mark_app_ready` | Signals that the frontend has finished loading |
| `restart_sidecar` | Kills and restarts the Go backend |

### File Watching

| Command | Purpose |
|---------|---------|
| `start_file_watcher` | Starts watching a directory for changes |
| `stop_file_watcher` | Stops the file watcher |
| `register_session` | Registers a session's worktree path for watching |
| `unregister_session` | Unregisters a session from watching |

### Authentication

| Command | Purpose |
|---------|---------|
| `get_auth_token` | Retrieves a stored auth token from Stronghold |
| `get_backend_port` | Returns the port the Go backend is running on |
| `get_pending_oauth_callback` | Checks for pending OAuth callback data |

### File Operations

| Command | Purpose |
|---------|---------|
| `read_file_metadata` | Gets file size, type, and modification date |
| `read_file_as_base64` | Reads a file and returns base64-encoded content |
| `get_image_dimensions` | Returns width/height for image files |
| `count_file_lines` | Counts lines in a text file |

### Shell Detection

| Command | Purpose |
|---------|---------|
| `get_user_shell` | Detects the user's default shell (bash, zsh, etc.) |
| `detect_installed_apps` | Detects installed development tools |

## File Watching

**File: `src-tauri/src/watcher.rs`**

The file watcher uses the Rust `notify` crate to detect changes in session worktrees:

1. **Register session** — `register_session(sessionId, worktreePath)` adds a path to watch
2. **Debouncing** — File events are debounced to avoid rapid-fire notifications
3. **Git filtering** — Changes within `.git/` directories are filtered out
4. **Event emission** — `file-changed` events are emitted to the frontend with the session ID and changed path

## Credential Storage

**File: `src-tauri/src/lib.rs:28-49`**

Credentials are stored in a Stronghold vault with Argon2id key derivation:

```rust
const STRONGHOLD_SALT: &[u8; 16] = b"chatml-stronghld";

pub fn derive_stronghold_key(password: &str) -> Vec<u8> {
    // Argon2id: 4 MiB memory, 1 iteration, 32-byte output
    let params = Params::new(4096, 1, 1, Some(32));
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    argon2.hash_password_into(password.as_bytes(), STRONGHOLD_SALT, &mut output);
    output.to_vec()
}
```

The salt is fixed and application-specific. Changing it would invalidate all existing vaults.

## macOS Integration

### Traffic Lights

The macOS window control buttons (close, minimize, fullscreen) are positioned at (16, 16) from the top-left:

```rust
main_window.set_traffic_lights_inset(16.0, 16.0)
```

### Menu Bar

A native macOS menu is constructed with standard Edit, View, and Help menus.

### Single Instance

The `single-instance` plugin prevents multiple app instances. If a second instance launches, it focuses the existing window instead.

## Sentry Integration

**File: `src-tauri/src/lib.rs:52-73`**

Crash reporting via Sentry is initialized for production builds when the `SENTRY_DSN` environment variable is set:

```rust
fn init_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = std::env::var("SENTRY_DSN").ok()?;
    sentry::init((dsn, sentry::ClientOptions {
        release: Some(env!("CARGO_PKG_VERSION").into()),
        environment: if cfg!(debug_assertions) {
            Some("development".into())
        } else {
            Some("production".into())
        },
        ..Default::default()
    }))
}
```

## CSP Configuration

The Content Security Policy in `tauri.conf.json` uses `'unsafe-inline'` for script-src and style-src because Next.js requires inline scripts for hydration and CSS-in-JS. This is acceptable because Tauri's isolation means no external content is loaded — all content comes from the bundled frontend.

## Related Documentation

- [Keyboard Shortcuts](./keyboard-shortcuts.md)
- [Onboarding & Authentication](./onboarding-authentication.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
