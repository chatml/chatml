# Architecture Decisions

This document records the key architectural decisions made during ChatML's development. Each entry captures the context, the decision, the alternatives considered, and the consequences — providing a trail for future contributors to understand why the system is shaped as it is.

## Table of Contents

1. [ADR-001: Polyglot Architecture](#adr-001-polyglot-architecture)
2. [ADR-002: Git Worktrees for Session Isolation](#adr-002-git-worktrees-for-session-isolation)
3. [ADR-003: SQLite as Primary Database](#adr-003-sqlite-as-primary-database)
4. [ADR-004: WebSockets for Real-Time Streaming](#adr-004-websockets-for-real-time-streaming)
5. [ADR-005: Zustand for Frontend State](#adr-005-zustand-for-frontend-state)
6. [ADR-006: Process-per-Conversation Agent Model](#adr-006-process-per-conversation-agent-model)
7. [ADR-007: Tauri over Electron](#adr-007-tauri-over-electron)
8. [ADR-008: MCP for Tool Extension](#adr-008-mcp-for-tool-extension)
9. [ADR-009: Three-Tier Settings System](#adr-009-three-tier-settings-system)
10. [ADR-010: Hub-and-Spoke Broadcast](#adr-010-hub-and-spoke-broadcast)
11. [ADR-011: Position-Based Message Ordering](#adr-011-position-based-message-ordering)
12. [ADR-012: Constellation Session Naming](#adr-012-constellation-session-naming)

---

## ADR-001: Polyglot Architecture

**Status:** Accepted
**Date:** January 2025

### Context

ChatML needed to be a native macOS desktop application with real-time AI agent capabilities. A single language could not optimally serve all layers: native OS integration, high-performance backend services, AI SDK access, and a rich interactive UI.

### Decision

Use four languages, each for the layer it serves best:

| Layer | Language | Rationale |
|-------|----------|-----------|
| Desktop shell | Rust (Tauri 2) | Native OS access, small bundles, security sandbox |
| Backend API | Go 1.25 | Concurrency, fast compilation, single binary, strong stdlib for HTTP/WebSocket/git |
| Agent runner | Node.js / TypeScript | Claude Agent SDK is JavaScript-only, rich npm ecosystem |
| Frontend UI | Next.js 16 / React 19 | Component model, ecosystem, Shiki/Mermaid/Monaco integration |

### Alternatives Considered

- **Electron + Node.js monolith** — Would unify shell and agent layers but with much larger bundle size (~150MB vs ~15MB), higher memory usage, and weaker OS integration.
- **Go for everything** — Go's UI story is weak, and the Claude Agent SDK only has a JavaScript binding.
- **Rust for backend** — Rust's compile times would slow iteration significantly for the backend where Go's fast builds and goroutine model excel.
- **Python agent runner** — The Claude Agent SDK supports Python, but Node.js has better streaming primitives and TypeScript provides strong type checking that aligns with the frontend.

### Consequences

- **Positive:** Each layer uses the best tool for its job. Performance is excellent across the stack. Minimal bundle size with Tauri. Strong type safety in both TypeScript layers.
- **Negative:** Developers need familiarity with four languages. Build tooling is more complex (Makefile orchestrates). Cross-layer debugging requires switching contexts. Data types are defined separately in Go structs and TypeScript interfaces.

---

## ADR-002: Git Worktrees for Session Isolation

**Status:** Accepted
**Date:** January 2025

### Context

ChatML runs multiple AI agent sessions against the same repository simultaneously. Each session modifies files, creates commits, and pushes branches. If sessions shared a working directory, they would conflict — one agent's edits would corrupt another's.

### Decision

Each session gets its own git worktree. A worktree is a separate working directory that shares the repository's object database and refs but has its own checked-out branch and working files. ChatML creates worktrees under `~/.chatml/workspaces/{workspace-name}/{session-name}/`.

### Alternatives Considered

- **Docker containers per session** — Full isolation but massive overhead. Startup latency (seconds) vs worktree creation (milliseconds). Requires Docker installation.
- **Branch switching in a single directory** — No isolation. Stash/switch/pop workflows are fragile and block parallel work.
- **Separate git clones** — Full copies of the repository. Wastes disk space (N copies of objects), slow to create, desynced refs.
- **Virtual filesystems (overlay fs)** — Complex, platform-dependent, and hard to debug when things go wrong.

### Consequences

- **Positive:** Near-instant session creation. Shared git objects mean minimal disk overhead. Standard git operations work in each worktree. Branches are naturally isolated.
- **Negative:** A branch can only be checked out in one worktree at a time (`ErrBranchAlreadyCheckedOut`). Users must understand that sessions operate on separate directory paths. Submodules require special handling.

---

## ADR-003: SQLite as Primary Database

**Status:** Accepted
**Date:** January 2025

### Context

ChatML needs persistent storage for workspaces, sessions, conversations, messages, tool actions, settings, and more. As a desktop application, it can't require users to install and manage a database server.

### Decision

Use SQLite in WAL (Write-Ahead Logging) mode with `modernc.org/sqlite` (pure Go, no CGo) for all persistence. Single file at `~/.chatml/chatml.db`.

### Alternatives Considered

- **PostgreSQL** — Powerful but requires a running server. Unacceptable UX for a desktop app.
- **BoltDB/BadgerDB** — Key-value stores lack relational querying. Message ordering, foreign keys, and JOIN operations would require custom implementations.
- **File-based JSON** — No query support, no transactional guarantees, doesn't scale to thousands of messages.
- **LevelDB** — Similar limitations to BoltDB for relational data patterns.

### Consequences

- **Positive:** Zero configuration. Single file backup. ACID transactions. WAL mode allows concurrent reads during writes. Pure Go driver means no CGo cross-compilation issues. The `modernc.org/sqlite` driver is well-tested.
- **Negative:** Write throughput limited to one writer at a time (WAL helps but doesn't eliminate). No built-in replication. Schema migrations must be managed manually. Connection pooling is important to avoid lock contention.
- **Mitigations:** Retry logic with exponential backoff for `SQLITE_BUSY`. Batch loading to avoid N+1 queries. Position-based ordering instead of timestamp-dependent sorting.

---

## ADR-004: WebSockets for Real-Time Streaming

**Status:** Accepted
**Date:** January 2025

### Context

Agent responses stream token-by-token from the Claude API. Tool executions happen in real time. The UI must update as events arrive — not wait for a complete response.

### Decision

Use a single WebSocket connection per frontend client, with a hub-and-spoke broadcast architecture. The Go backend maintains a Hub that broadcasts events to all connected clients.

### Alternatives Considered

- **Server-Sent Events (SSE)** — Simpler but unidirectional. ChatML needs bidirectional communication for features like plan approval and question answering. SSE also has browser connection limits (6 per domain).
- **HTTP polling** — High latency for streaming text. Would require frequent requests to appear responsive, wasting resources.
- **gRPC streaming** — Overkill for a desktop app talking to localhost. Adds protobuf compilation step and complexity.
- **GraphQL subscriptions** — Added schema complexity for no benefit in a single-client desktop app context.

### Consequences

- **Positive:** Full-duplex communication. Low latency for streaming text. Single connection handles all event types. Built-in ping/pong for connection health.
- **Negative:** Requires careful backpressure management (slow clients can block the hub). Connection drops need auto-reconnect logic. More complex than SSE for simple one-way streaming.
- **Mitigations:** Three-level backpressure system (hub buffer → client buffer → eviction). Auto-reconnect with configurable delay. Rate-limited warning events.

---

## ADR-005: Zustand for Frontend State

**Status:** Accepted
**Date:** January 2025

### Context

The frontend manages complex state: 12+ independent concerns including conversations, streaming data, UI preferences, file tabs, terminal sessions, and more. State updates arrive at high frequency during agent streaming.

### Decision

Use Zustand with a multi-store architecture. Each concern gets its own store with scoped selectors to minimize re-renders.

### Alternatives Considered

- **Redux Toolkit** — More boilerplate (slices, reducers, actions). Middleware complexity for async operations. Zustand is simpler for the same capabilities.
- **React Context** — Re-renders all consumers on any state change. Unacceptable for high-frequency streaming updates.
- **Jotai/Recoil** — Atomic state models work well for independent atoms but are harder to coordinate for complex cross-cutting concerns like streaming state.
- **MobX** — Proxy-based reactivity adds magic and debugging complexity. Zustand's explicit subscriptions are more predictable.

### Consequences

- **Positive:** Minimal boilerplate. Fine-grained subscriptions via selectors. Can be used outside React components. `useShallow` prevents unnecessary re-renders. No provider wrapping needed.
- **Negative:** No built-in devtools as mature as Redux DevTools. Store interactions (cross-store reads) need careful management. No middleware ecosystem as rich as Redux.
- **Mitigations:** Dedicated `selectors.ts` module for composed selectors. Stores access each other via `getState()` for cross-store coordination.

---

## ADR-006: Process-per-Conversation Agent Model

**Status:** Accepted
**Date:** January 2025

### Context

Each conversation needs its own Claude agent with independent context, tool access, and working directory. Agents run long-lived operations (file edits, shell commands) that can fail or hang.

### Decision

Spawn a separate Node.js process for each conversation. Communication uses JSON lines over stdin/stdout. The Go backend manages process lifecycle.

### Alternatives Considered

- **In-process agent threads** — Can't use Node.js SDK from Go. Would require CGo bindings or reimplementing the SDK.
- **Shared agent process pool** — Complex context switching. One agent's crash affects others. Memory isolation lost.
- **HTTP-based agent service** — Added network overhead for localhost communication. Port management complexity. stdin/stdout is simpler and faster.
- **Worker threads in a single Node.js process** — SharedArrayBuffer and worker communication add complexity. Less isolation than separate processes.

### Consequences

- **Positive:** Complete process isolation (one crash doesn't affect others). Natural resource limits per conversation. Clean lifecycle management (SIGTERM/SIGINT). Each process gets its own working directory via `--cwd`.
- **Negative:** Process spawn overhead (~200ms). Memory overhead per process (~50-100MB). More complex than in-process function calls.
- **Mitigations:** Agent processes are reused within a conversation (resume). Graceful shutdown with 5-second timeout before SIGKILL. Buffer management for stdout (10MB max line size).

---

## ADR-007: Tauri over Electron

**Status:** Accepted
**Date:** January 2025

### Context

ChatML needs native desktop capabilities: system notifications, file dialogs, deep link protocol handling (`chatml://`), credential storage, file system watching, and macOS-specific integrations.

### Decision

Use Tauri 2 as the desktop framework. The Go backend runs as a sidecar process managed by Tauri.

### Alternatives Considered

- **Electron** — Mature but bundles an entire Chromium (~150MB). High memory usage (~300MB baseline). Weaker security model.
- **Swift native app** — macOS-only (which is current target), but would require building the entire UI in AppKit/SwiftUI. No React ecosystem.
- **Neutralinojs** — Lighter than Electron but less mature. Limited plugin ecosystem. No equivalent to Tauri's Stronghold.
- **Progressive Web App** — No native OS access. Can't register URL protocols, manage child processes, or use secure credential storage.

### Consequences

- **Positive:** ~15MB bundle size vs ~150MB for Electron. ~60MB memory baseline vs ~300MB. Native OS integration via 13+ plugins. Stronghold for encrypted credential storage. Built-in code signing and notarization support. Security sandbox with CSP.
- **Negative:** Tauri 2 is newer than Electron — smaller community, fewer examples. Rust compilation adds to build time. WebView rendering varies by OS (not Chromium). Some browser APIs unavailable.
- **Mitigations:** Tauri's plugin ecosystem covers most needs. The Go backend handles heavy lifting, reducing dependency on WebView capabilities.

---

## ADR-008: MCP for Tool Extension

**Status:** Accepted
**Date:** January 2025

### Context

Claude agents need tools beyond the built-in set (Read, Write, Edit, Bash, etc.). Users want to connect their own services — Slack, Jira, custom APIs — as tools the agent can use.

### Decision

Support the Model Context Protocol (MCP) for tool extension. Users configure MCP servers per workspace with three transport types: stdio, SSE, and HTTP. ChatML also runs a built-in MCP server providing workspace-aware tools.

### Alternatives Considered

- **Custom plugin API** — Would require designing and maintaining a proprietary plugin interface. MCP is an emerging standard with existing implementations.
- **Hardcoded integrations** — Build each integration directly. Doesn't scale and couples ChatML to specific services.
- **LangChain tools** — Tied to the LangChain ecosystem. The Claude Agent SDK has native MCP support.

### Consequences

- **Positive:** Users can connect any MCP-compatible service. The built-in MCP server provides `get_session_status`, `get_workspace_diff`, `get_recent_activity`, and review comment tools. Workspace-scoped configuration keeps projects independent.
- **Negative:** MCP is a young standard — breaking changes possible. Three transport types add configuration complexity. stdio transport means managing child processes for MCP servers.

---

## ADR-009: Three-Tier Settings System

**Status:** Accepted
**Date:** January 2025

### Context

Settings need different scopes. Some apply globally (theme, API key), some per-workspace (MCP servers, branch prefix), and some per-conversation (model override).

### Decision

Three tiers with most-specific-wins precedence:

1. **Per-conversation** — Model override for a specific conversation
2. **Per-workspace** — Workspace-specific review prompts, MCP servers, branch prefix, PR templates
3. **Global** — Application-wide defaults stored in SQLite settings table

Frontend settings (theme, font size, panel layout) are stored separately in localStorage via Zustand persistence.

### Alternatives Considered

- **Single global config file** — Simple but no per-workspace customization. Users working on multiple projects need different configurations.
- **Config files in each repo** — `.chatml/config.json` exists for workspace config but can't handle all settings. Users shouldn't commit API keys or personal preferences to repos.
- **Environment variables** — Useful for some settings but poor UX for desktop app configuration.

### Consequences

- **Positive:** Users can customize behavior per project without affecting others. Global defaults reduce repetitive configuration. Clear precedence rules prevent confusion.
- **Negative:** Three storage locations (SQLite, localStorage, workspace config files) to check when debugging settings issues. Settings migration needs to handle all tiers.

---

## ADR-010: Hub-and-Spoke Broadcast

**Status:** Accepted
**Date:** January 2025

### Context

Agent events need to reach all connected UI clients. While typically only one client connects (the desktop app), the architecture should handle multiple windows or development tools connecting simultaneously.

### Decision

A central Hub goroutine runs an event loop, receiving events on a broadcast channel and distributing them to all registered client send channels. Clients are identified by their WebSocket connection.

### Alternatives Considered

- **Direct WebSocket writes from event sources** — Simpler but requires every event producer to know about all clients. No central point for backpressure management.
- **Redis pub/sub** — Overkill for a local desktop app. Adds an external dependency.
- **Event bus library** — Go's channel primitives are sufficient. A library would add abstraction without clear benefit.

### Consequences

- **Positive:** Single broadcast point simplifies backpressure management. Metrics are centralized. Client registration/deregistration is clean. Event serialization happens once per broadcast, not per client.
- **Negative:** Hub is a potential bottleneck (mitigated by 1024-message buffer). Single goroutine processes all broadcasts sequentially.

---

## ADR-011: Position-Based Message Ordering

**Status:** Accepted
**Date:** January 2025

### Context

Messages within a conversation need a stable, deterministic order. Timestamps can collide (especially during fast streaming), and clock skew across components could cause ordering issues.

### Decision

Use an integer `position` field for message ordering. Each new message gets `position = max(existing) + 1`. Messages are always queried with `ORDER BY position ASC`.

### Alternatives Considered

- **Timestamp-based ordering** — Timestamps can collide during rapid streaming. Clock differences between Go backend and Node.js agent could cause inconsistencies.
- **UUID-based ordering with created-at tiebreaker** — UUIDs aren't sortable. Still depends on timestamps as a fallback.
- **Sequence numbers per conversation** — This is essentially what we chose, using `position` as the sequence number.

### Consequences

- **Positive:** Deterministic ordering regardless of clock state. Simple integer comparison for sorting. Easy to insert messages at specific positions if needed.
- **Negative:** Requires atomic increment logic to avoid position collisions under concurrent writes.

---

## ADR-012: Constellation Session Naming

**Status:** Accepted
**Date:** January 2025

### Context

Sessions need default names before the user or AI provides a meaningful one. Names should be memorable, unique-ish, and aesthetically pleasing.

### Decision

Generate default session names from constellation names (Orion, Lyra, Cassiopeia, etc.) combined with short random suffixes. The agent runner also supports AI-generated names via the `name_suggestion` event after the first message exchange.

### Alternatives Considered

- **Sequential numbers** — "Session 1", "Session 2" — functional but not memorable or distinguishable.
- **Random words (Docker-style)** — "Hungry-Panda", "Silly-Goose" — memorable but unprofessional.
- **Timestamp-based** — "2025-01-15-1430" — precise but not human-friendly.
- **UUID** — Not human-readable at all.

### Consequences

- **Positive:** Constellation names are memorable and professional. Short suffix provides uniqueness. AI renaming after first message provides meaningful context.
- **Negative:** Limited constellation pool means names can repeat across sessions (mitigated by suffixes). Some constellation names are long.

---

## Related Documentation

- [Polyglot Architecture](../architecture/polyglot-architecture.md)
- [Data Models & Persistence](../architecture/data-models-and-persistence.md)
- [Git Worktrees Explained](../technical/git-worktrees-explained.md)
- [Settings & Configuration](../technical/settings-configuration.md)
- [WebSocket Streaming](../architecture/websocket-streaming.md)
