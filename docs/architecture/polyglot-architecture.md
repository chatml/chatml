# Polyglot Architecture

ChatML uses four programming languages, each chosen for what it does best. This document explains why each language was selected, how the components communicate, and how data flows through the system.

## Why Four Languages?

A single-language stack would be simpler to maintain but would require compromises. ChatML's requirements span native desktop integration, high-concurrency server operations, AI SDK integration, and a rich interactive UI. No single language excels at all four.

| Language | Component | Why This Language |
|----------|-----------|-------------------|
| **Rust** | Tauri desktop shell | Small binary size (~15MB vs Electron's ~150MB), native macOS APIs, secure by default, Stronghold encrypted storage |
| **Go** | Backend server | Excellent concurrency (goroutines for WebSocket hub), fast compilation, strong standard library for HTTP/SQL/Git |
| **Node.js / TypeScript** | Agent runner | The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is a Node.js package — this is the only language with first-class SDK support |
| **TypeScript / React** | Frontend UI | React 19's concurrent features, Next.js 15 for the rendering framework, rich ecosystem of UI components |

## Component Responsibilities

### Tauri Desktop Shell (Rust)

**Key file: `src-tauri/src/lib.rs`**

The Rust layer is the outermost shell. It provides:

- **Process management** — Spawns and monitors the Go backend as a sidecar process, discovers available ports (9876-9899), and restarts on crashes
- **Native plugins** — Integrates 13+ Tauri plugins: single-instance enforcement, shell access, clipboard, notifications, PTY terminals, auto-updater, window state persistence, deep links, and Stronghold encrypted storage
- **IPC commands** — Exposes 15+ commands callable from the frontend: `mark_app_ready`, `restart_sidecar`, `start_file_watcher`, `register_session`, `get_auth_token`, `get_backend_port`, `read_file_metadata`, `read_file_as_base64`, `get_image_dimensions`, `count_file_lines`, `get_user_shell`, `detect_installed_apps`
- **File watching** — Uses the `notify` crate to watch session worktrees for file changes, debouncing events and filtering git internals
- **Credential storage** — Stronghold vault with Argon2id key derivation (4 MiB memory, 1 iteration, 32-byte output) for storing OAuth tokens and API keys
- **macOS integration** — Traffic light positioning, menu bar construction, system tray with show/hide behavior

### Go Backend

**Key files: `backend/main.go`, `backend/server/router.go`, `backend/server/handlers.go`**

The Go backend is the central coordination layer. It handles:

- **REST API** — 100+ endpoints organized under `/api/` for repos, sessions, conversations, messages, review comments, CI, settings, skills, agents, and orchestrator. Uses `chi` router with middleware for logging, panic recovery, token auth, and rate limiting.
- **WebSocket Hub** — A hub-and-spoke broadcast system where agent events flow through a central hub to all connected clients. The hub has a 4096-message broadcast buffer and 2048 per-client buffers with backpressure protection.
- **Agent process management** — Spawns Node.js agent runner processes per conversation, manages their lifecycle (start, message, stop, interrupt), routes events between processes and the WebSocket hub.
- **SQLite persistence** — Stores workspaces, sessions, conversations, messages, tool actions, review comments, file tabs, settings, and streaming snapshots. Uses WAL mode for concurrent reads, busy timeout for lock contention, and retry with exponential backoff.
- **Git operations** — Worktree creation/removal, branch management, diff generation, commit history, file content retrieval, and branch sync (rebase/merge).
- **GitHub integration** — OAuth flow, PR creation and tracking, CI/CD workflow monitoring, issue listing and search, avatar lookup.
- **Linear integration** — OAuth flow, issue CRUD operations.
- **Branch watching** — Background watchers for branch changes and PR status updates.

### Node.js Agent Runner

**Key file: `agent-runner/src/index.ts`**

Each conversation gets its own Node.js process that wraps the Claude Agent SDK:

- **SDK integration** — Imports `query` from `@anthropic-ai/claude-agent-sdk`, configures tools, system prompts, session management, MCP servers, budget controls, and permissions.
- **Event emission** — Emits 47+ event types as JSON lines to stdout, which the Go backend reads and broadcasts via WebSocket.
- **Hook system** — Implements 9 SDK hooks (PreToolUse, PostToolUse, PostToolUseFailure, Notification, SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop) to intercept and report on tool execution.
- **MCP server** — Runs a built-in MCP server (`chatml`) providing workspace context tools: `get_session_status`, `get_workspace_diff`, `get_recent_activity`, `add_review_comment`, `list_review_comments`.
- **Text streaming** — Buffers text output and emits on paragraph boundaries (double newlines) for smooth rendering.
- **Tool presets** — Supports four permission levels: `full` (all tools), `read-only` (read/search only), `no-bash` (everything except shell), `safe-edit` (read + edit, no write/bash).
- **Budget controls** — Passes `maxBudgetUsd`, `maxTurns`, and `maxThinkingTokens` to the SDK.
- **Graceful shutdown** — Handles SIGTERM/SIGINT with abort controller cancellation, SDK query interruption, and readline cleanup.

### Next.js Frontend

**Key files: `src/app/page.tsx`, `src/stores/appStore.ts`, `src/hooks/useWebSocket.ts`**

The frontend is a single-page React application:

- **Component architecture** — 44+ components organized by feature: conversation display, file browser, code editor, terminal, CI panel, settings, onboarding.
- **State management** — 12 Zustand stores: `appStore` (main state), `authStore`, `connectionStore`, `linearAuthStore`, `navigationStore`, `selectors`, `settingsStore`, `skillsStore`, `slashCommandStore`, `tabStore`, `uiStore`, `agentStore`.
- **Real-time updates** — WebSocket hook receives events from the Go backend and dispatches to appropriate store actions.
- **Streaming rendering** — Per-conversation streaming state with accumulated text, thinking content, active tools, and sub-agent tracking.
- **Performance optimizations** — React.memo with custom comparators, scoped Zustand selectors, useShallow for array comparisons, ref-based scroll tracking, ring buffers for output, LRU tab eviction.

## Communication Patterns

### Frontend ↔ Backend: HTTP REST + WebSocket

The frontend communicates with the Go backend over two channels on port 9876:

- **HTTP REST** — For CRUD operations (create session, send message, get conversations) and settings management. Rate-limited per endpoint type.
- **WebSocket** — For real-time event streaming. A single WebSocket connection (`ws://localhost:9876/ws?token=...`) receives all events for all conversations. The frontend filters events by `conversationId` and routes them to the appropriate store.

### Backend ↔ Agent Runner: stdin/stdout JSON Lines

The Go backend communicates with each agent runner process via JSON lines over stdin/stdout:

- **stdin (Go → Node)** — Input messages: `message` (user text with optional attachments), `stop`, `interrupt`, `set_model`, `set_permission_mode`, `rewind_files`, `user_question_response`, `plan_approval_response`, `get_supported_models`, `get_supported_commands`, `get_mcp_status`, `get_account_info`.
- **stdout (Node → Go)** — Output events: 47+ event types as JSON objects, one per line. The Go backend parses each line through `agent/parser.go`, routes it to handlers, and broadcasts via the WebSocket hub.
- **stderr (Node → Go)** — Debug and error output, prefixed and logged by the backend.

### Tauri ↔ Frontend: IPC Commands

The Tauri shell communicates with the frontend via Tauri's IPC system:

- **Commands** — The frontend calls Tauri commands (e.g., `invoke('get_backend_port')`) for native operations.
- **Events** — Tauri emits events (e.g., `sidecar-ready`, `sidecar-error`, `file-changed`) that the frontend listens to.

## Data Flow Narratives

### User Sends a Message

1. User types in the conversation input and presses Enter
2. Frontend calls `POST /api/conversations/{convId}/messages` with the message content
3. Go backend finds the agent process for this conversation
4. Backend writes `{"type":"message","content":"..."}` to the process's stdin
5. Agent runner receives the message and sends it to the Claude SDK
6. SDK streams the response as an async message iterator
7. Agent runner processes each message, emits events as JSON lines to stdout
8. Go backend reads stdout, parses each line, and broadcasts via WebSocket hub
9. Frontend WebSocket hook receives events, dispatches to Zustand store
10. React components re-render with new streaming content

### Tool Execution

1. Claude decides to use a tool (e.g., Read a file)
2. SDK calls the PreToolUse hook → agent emits `hook_pre_tool` event
3. Agent emits `tool_start` event with tool name and parameters
4. SDK executes the tool
5. SDK calls PostToolUse hook → agent emits `hook_post_tool` event
6. Agent emits `tool_end` event with success status, summary, and duration
7. Go backend stores the tool action in SQLite and broadcasts events
8. Frontend shows the tool as active during execution, then shows the result

### File Change Detection

1. Tauri file watcher detects a change in a session's worktree
2. Watcher debounces the event and filters out `.git/` changes
3. Tauri emits `file-changed` event to the frontend
4. Frontend can refresh file content, update dirty indicators, or notify the user

## Rate Limiting

The Go backend applies rate limits to protect against abuse:

| Endpoint Category | Limit | Window |
|-------------------|-------|--------|
| Agent spawns | 10 | per minute |
| Conversation creation | 20 | per minute |
| Message sending | 60 | per minute |
| Comment operations | 60 | per minute |
| GitHub search | 20 | per minute |

## Related Documentation

- [Data Models & Persistence](./data-models-and-persistence.md)
- [Frontend State & Rendering](./frontend-state-and-rendering.md)
- [WebSocket Streaming](./websocket-streaming.md)
- [Session Lifecycle Management](../technical/session-lifecycle-management.md)
- [Claude Agent SDK Integration](../technical/claude-agent-sdk-integration.md)
