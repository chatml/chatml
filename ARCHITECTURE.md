# Architecture

ChatML is a native macOS desktop application for AI-assisted development. It uses a polyglot architecture with four distinct layers, each chosen for its strengths.

## System Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Tauri Shell (Rust)                     │
│   Window management, PTY terminals, OAuth deep links,    │
│   Stronghold credential storage, native menus            │
├──────────────────────────────────────────────────────────┤
│                Next.js Frontend (React 19)                │
│   UI components, Zustand stores, WebSocket client        │
│   Static HTML export served by Tauri                     │
├──────────────────────────────────────────────────────────┤
│                  Go Backend (:9876)                       │
│   REST API, WebSocket hub, SQLite, git/worktree ops,     │
│   agent process management, OAuth handlers               │
├──────────────────────────────────────────────────────────┤
│              Agent Runner (Node.js)                       │
│   Claude Agent SDK wrapper, MCP server, tool execution   │
│   One process per conversation, runs in session worktree │
└──────────────────────────────────────────────────────────┘
```

## Data Model

```
Workspace → Session → Conversation → Message
```

- **Workspace** — A git repository on disk. Contains settings, branch prefix config, and custom instructions.
- **Session** — An isolated git worktree for a single task. Has its own branch, priority, status, and PR tracking.
- **Conversation** — A chat within a session. Types: `task` (full tool access), `review` (code review), `chat` (general discussion).
- **Message** — Individual message with role (`user`, `assistant`, `system`), content blocks, tool calls, and token usage stats.

## Communication Flow

```
Frontend ←──HTTP/WS──→ Go Backend ←──stdin/stdout──→ Agent Runner
   │                       │                              │
   │  REST: CRUD ops       │  Spawns process per          │  Claude Agent SDK
   │  WebSocket: streaming │  conversation in the         │  query() + hooks
   │                       │  session's worktree           │
   │                       │                              │
   │                       ├── SQLite (persistence)        │
   │                       ├── Git (worktree management)   │
   │                       └── OAuth (GitHub, Linear)      │
```

1. Frontend connects to Go backend via HTTP REST + WebSocket on localhost port 9876
2. When a conversation starts, the backend spawns a Node.js agent-runner process
3. The agent-runner runs inside the session's git worktree directory
4. Agent output streams through stdout → backend → WebSocket → frontend
5. All state is persisted in SQLite (backend/store/)

## Provider Architecture

ChatML uses a two-level provider abstraction:

### Go Backend (`ai.Provider` interface)
For lightweight AI tasks that don't need the full agent SDK:
- PR description generation
- Conversation/session summarization
- Input suggestions

The `ai.Provider` interface in `backend/ai/provider.go` can be implemented by any provider.

### Agent Runner (stdin/stdout JSON protocol)
For heavy agentic work (coding, tool use, planning):
- The Go backend spawns an agent-runner process and communicates via JSON over stdin/stdout
- The protocol is documented in `docs/agent-runner-protocol.md`
- The current implementation wraps the Claude Agent SDK
- New providers can implement their own agent-runner that speaks the same protocol

### Provider Capabilities
The backend exposes `GET /api/provider/capabilities` which returns what the current provider supports (extended thinking, plan mode, sub-agents, effort levels). The frontend uses this to conditionally show/hide features.

## Directory Structure

```
chatml/
├── src/                        # Next.js frontend
│   ├── app/                    # App router pages
│   ├── components/             # React components
│   │   ├── conversation/       # Chat interface, message rendering
│   │   ├── session/            # Session management UI
│   │   ├── settings/           # Settings panels
│   │   └── workspace/          # Workspace sidebar, dashboard
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # API client, utilities, types
│   └── stores/                 # Zustand state stores
├── backend/                    # Go backend server
│   ├── agent/                  # Agent process spawning & management
│   ├── ai/                     # AI provider interface & Anthropic client
│   ├── git/                    # Git & worktree operations
│   ├── server/                 # HTTP handlers, WebSocket hub, router
│   ├── store/                  # SQLite persistence layer
│   └── main.go                 # Server entry point
├── agent-runner/               # Claude Agent SDK runner
│   └── src/
│       ├── index.ts            # Main entry point, SDK hooks
│       └── mcp/                # Built-in MCP server
├── src-tauri/                  # Tauri desktop wrapper
│   ├── src/                    # Rust source (main.rs, plugins)
│   └── tauri.conf.json         # Tauri configuration
├── docs/                       # Documentation
└── public/                     # Static assets
```

## State Management

- **Frontend**: Zustand stores in `src/stores/` — one store per concern (sessions, conversations, settings, etc.)
- **Backend**: SQLite in WAL mode via pure-Go driver (no CGo) in `backend/store/`
- **Real-time sync**: WebSocket events keep frontend state in sync with backend changes

## Key Design Decisions

1. **Git worktrees for isolation** — Each session gets its own worktree and branch, enabling truly parallel AI development without merge conflicts.

2. **Process-per-conversation** — Each agent conversation runs in its own Node.js process, providing natural isolation and the ability to kill runaway agents.

3. **Local-first** — All data stays on your machine. No cloud component except the AI provider API.

4. **Stdin/stdout protocol** — The Go backend communicates with agent runners via JSON over stdin/stdout, making it straightforward to swap in different AI providers without changing the backend.

5. **Static frontend export** — Next.js generates static HTML that Tauri serves directly, avoiding the need for a separate web server process.
