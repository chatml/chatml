# ChatML Documentation

ChatML is a native macOS desktop application for AI-assisted software development. It uses isolated git worktrees to run parallel AI agent sessions, enabling developers to work on multiple tasks simultaneously with AI assistance.

## What is ChatML?

ChatML wraps the Claude AI into a purpose-built development environment. Rather than using a chat interface with copy-paste workflows, ChatML gives Claude direct access to your codebase through isolated workspaces. Each task gets its own git worktree, its own branch, and its own AI agent process. This means you can have multiple AI-driven development tasks running in parallel without any of them interfering with each other.

The application runs as a native macOS app built with Tauri, with a Go backend managing all server-side operations and a Node.js agent runner bridging the Claude Agent SDK. The frontend is a Next.js 16 / React 19 single-page application that renders in the Tauri webview.

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│  Tauri Desktop Shell (Rust)                             │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Next.js 16 Frontend (React 19 + TypeScript)       │ │
│  │  Zustand stores, WebSocket, REST API calls         │ │
│  └────────────────────┬───────────────────────────────┘ │
│                       │ HTTP + WebSocket (port 9876)    │
│  ┌────────────────────┴───────────────────────────────┐ │
│  │  Go Backend (sidecar process)                      │ │
│  │  REST API, WebSocket Hub, SQLite, Git operations   │ │
│  └────────────────────┬───────────────────────────────┘ │
│                       │ stdin/stdout JSON lines         │
│  ┌────────────────────┴───────────────────────────────┐ │
│  │  Node.js Agent Runner (per conversation)           │ │
│  │  Claude Agent SDK, MCP server, tool hooks          │ │
│  └────────────────────┬───────────────────────────────┘ │
│                       │                                 │
│                 Claude API                               │
└─────────────────────────────────────────────────────────┘
```

## Data Model

ChatML organizes work into a four-level hierarchy:

- **Workspace** — A repository on disk (e.g., `~/projects/my-app`). You register repositories as workspaces.
- **Session** — An isolated git worktree for a task. Each session gets its own branch and working directory so changes are isolated.
- **Conversation** — A chat within a session. Conversations can be of type `task` (coding), `review` (code review), or `chat` (general discussion).
- **Message** — Individual messages within a conversation with roles: `user`, `assistant`, or `system`.

## Documentation Guide

### Product & Features

| Document | Description |
|----------|-------------|
| [Product Overview](./product-overview.md) | All user-facing features and capabilities |

### Architecture

| Document | Description |
|----------|-------------|
| [Polyglot Architecture](./architecture/polyglot-architecture.md) | The four-language system design and component boundaries |
| [Data Models & Persistence](./architecture/data-models-and-persistence.md) | Data hierarchy, SQLite schema, and persistence patterns |
| [Frontend State & Rendering](./architecture/frontend-state-and-rendering.md) | Zustand stores, streaming state, and UI rendering pipeline |
| [WebSocket Streaming](./architecture/websocket-streaming.md) | Hub-and-spoke broadcast, backpressure, and event delivery |

### Technical Deep Dives

| Document | Description |
|----------|-------------|
| [Git Worktrees Explained](./technical/git-worktrees-explained.md) | The core isolation mechanism — how sessions get their own working directories |
| [Claude Agent SDK Integration](./technical/claude-agent-sdk-integration.md) | How the agent runner wraps the SDK with hooks, tools, and streaming |
| [Streaming Events System](./technical/streaming-events-system.md) | The 47+ event types that flow from agent to UI |
| [Session Lifecycle Management](./technical/session-lifecycle-management.md) | Session creation, agent spawning, resume/fork, and shutdown |
| [Skills System](./technical/skills-system.md) | Built-in skills catalog and the skill installation model |
| [Settings & Configuration](./technical/settings-configuration.md) | Backend, frontend, and per-workspace settings |

### Workflows

| Document | Description |
|----------|-------------|
| [Code Review Workflow](./workflows/code-review-workflow.md) | Review conversations, inline comments, and severity levels |
| [Pull Request Workflow](./workflows/pull-request-workflow.md) | PR creation from sessions, tracking, and branch sync |
| [Linear Integration](./workflows/linear-integration.md) | Issue discovery, OAuth, and MCP tools |
| [CI/CD Monitoring](./workflows/ci-cd-monitoring.md) | GitHub Actions status, logs, and AI failure analysis |

### Desktop Integration

| Document | Description |
|----------|-------------|
| [Tauri Shell Architecture](./desktop/tauri-shell-architecture.md) | Sidecar management, IPC commands, and native features |
| [Keyboard Shortcuts](./desktop/keyboard-shortcuts.md) | All keyboard shortcuts organized by context |
| [Onboarding & Authentication](./desktop/onboarding-authentication.md) | First-run wizard, OAuth flows, and credential storage |

### Development

| Document | Description |
|----------|-------------|
| [Getting Started](./development/getting-started.md) | Prerequisites, setup, and development workflow |
| [Testing Strategy](./development/testing-strategy.md) | Frontend, backend, and CI testing approaches |
| [Architecture Decisions](./development/architecture-decisions.md) | Key ADRs and their rationale |

### API Reference

| Document | Description |
|----------|-------------|
| [REST API Reference](./api/rest-api-reference.md) | All endpoints with parameters and examples |
| [WebSocket Events Reference](./api/websocket-events-reference.md) | Event format, types, and TypeScript interfaces |

### Troubleshooting

| Document | Description |
|----------|-------------|
| [Common Issues](./troubleshooting/common-issues.md) | Symptoms, causes, and solutions |
| [Debugging Guide](./troubleshooting/debugging-guide.md) | Tools and techniques for each layer |

## Glossary

| Term | Definition |
|------|-----------|
| **Workspace** | A registered git repository that ChatML manages |
| **Session** | An isolated git worktree with its own branch, created for a development task |
| **Conversation** | A chat thread within a session (task, review, or chat type) |
| **Worktree** | A git feature that allows multiple working directories sharing one repository |
| **Agent Runner** | The Node.js process that wraps the Claude Agent SDK and communicates via stdin/stdout |
| **Hub** | The WebSocket hub in the Go backend that broadcasts events to all connected clients |
| **MCP** | Model Context Protocol — a standard for providing tools and context to AI models |
| **Skill** | A specialized prompt template that augments Claude's capabilities for specific tasks |
| **Checkpoint** | A git stash-based snapshot of file states that enables rewind/undo |
| **Sidecar** | The Go backend process managed by Tauri as a child process |
| **Plan Mode** | A conversation mode where the agent writes a plan for user approval before executing |

## Key Directories

```
pangyo-v1/
├── src/                    # Next.js 16 frontend (React 19, TypeScript)
│   ├── app/                # Next.js app router pages
│   ├── components/         # 44+ React components
│   ├── hooks/              # Custom hooks (WebSocket, etc.)
│   ├── stores/             # Zustand state management (13 stores)
│   └── lib/                # Types, utilities, API client
├── backend/                # Go 1.25 backend
│   ├── server/             # HTTP router, handlers, WebSocket hub
│   ├── agent/              # Agent process management
│   ├── store/              # SQLite persistence
│   ├── git/                # Git and worktree operations
│   ├── models/             # Data structures
│   ├── skills/             # Skills catalog
│   └── branch/             # Branch watching and PR tracking
├── agent-runner/           # Node.js agent runner
│   └── src/
│       ├── index.ts        # Main entry, SDK integration
│       └── mcp/            # MCP server and tools
├── src-tauri/              # Rust/Tauri desktop shell
│   └── src/
│       ├── lib.rs          # Main app setup, plugins
│       ├── sidecar.rs      # Go backend process management
│       ├── commands.rs     # Tauri IPC commands
│       └── watcher.rs      # File system watcher
└── docs/                   # This documentation
```
