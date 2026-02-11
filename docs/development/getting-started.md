# Getting Started

This guide covers setting up a ChatML development environment, running the application, and understanding the project structure.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 20+ | Frontend and agent runner |
| **Go** | 1.25+ | Backend server |
| **Rust** | Latest stable | Tauri desktop shell |
| **pnpm** or **npm** | Latest | Package management |
| **Xcode Command Line Tools** | Latest | macOS build tools |

## Repository Setup

```bash
# Clone the repository
git clone <repo-url>
cd pangyo-v1

# Install frontend dependencies
npm install

# Install agent runner dependencies
cd agent-runner && npm install && cd ..

# Build the agent runner (TypeScript → JavaScript)
cd agent-runner && npm run build && cd ..

# Build the Go backend
cd backend && go build ./... && cd ..
```

## Development Commands

### Full Stack

```bash
make dev          # Starts all services: backend + frontend + Tauri
```

This starts the Go backend, Next.js dev server, and Tauri application concurrently.

### Individual Services

```bash
make backend      # Go backend only (port 9876)
npm run dev       # Next.js frontend only (port 3000)
```

### Building

```bash
make build        # Full production build
npm run build     # Frontend build only
cd backend && go build ./...  # Backend build only
```

### Linting and Type Checking

```bash
npm run lint      # ESLint for frontend
npm run build     # TypeScript type checking (checked during build)
cd backend && go vet ./...    # Go vet
```

## Project Structure

```
pangyo-v1/
├── src/                        # Next.js 15 frontend
│   ├── app/                    # Next.js app router
│   │   └── page.tsx            # Main dashboard (entry point)
│   ├── components/             # React components (44+)
│   │   ├── ConversationArea.tsx
│   │   ├── StreamingMessage.tsx
│   │   ├── ToolUsageBlock.tsx
│   │   ├── SessionSidebar.tsx
│   │   └── ...
│   ├── hooks/                  # Custom React hooks
│   │   ├── useWebSocket.ts     # WebSocket connection
│   │   └── ...
│   ├── stores/                 # Zustand state management
│   │   ├── appStore.ts         # Main store
│   │   ├── selectors.ts        # Optimized selectors
│   │   └── ...                 # 12 stores total
│   └── lib/                    # Utilities and types
│       ├── types.ts            # TypeScript type definitions
│       └── api.ts              # REST API client
│
├── backend/                    # Go backend
│   ├── main.go                 # Entry point (port 9876)
│   ├── server/
│   │   ├── router.go           # Route definitions
│   │   ├── handlers.go         # Request handlers
│   │   └── websocket.go        # WebSocket hub
│   ├── agent/
│   │   ├── manager.go          # Agent process lifecycle
│   │   ├── process.go          # Process spawning
│   │   └── parser.go           # Event parsing
│   ├── store/
│   │   └── sqlite.go           # SQLite persistence
│   ├── git/
│   │   └── worktree.go         # Git worktree operations
│   ├── models/
│   │   └── types.go            # Data structures
│   ├── skills/
│   │   └── catalog.go          # Skills catalog (19 skills)
│   ├── branch/
│   │   ├── watcher.go          # Branch change detection
│   │   └── pr_watcher.go       # PR status polling
│   ├── github/                 # GitHub API client
│   ├── linear/                 # Linear API client
│   ├── ai/                     # AI summarization client
│   └── scripts/                # Script runner
│
├── agent-runner/               # Node.js agent runner
│   ├── src/
│   │   ├── index.ts            # Main entry, SDK integration
│   │   └── mcp/
│   │       ├── server.ts       # MCP server
│   │       ├── context.ts      # Workspace context
│   │       └── tools/          # MCP tool implementations
│   ├── package.json
│   └── tsconfig.json
│
├── src-tauri/                  # Rust/Tauri desktop shell
│   ├── src/
│   │   ├── lib.rs              # Main setup, plugins
│   │   ├── sidecar.rs          # Go backend management
│   │   ├── commands.rs         # IPC commands
│   │   ├── watcher.rs          # File system watcher
│   │   ├── menu.rs             # Menu bar
│   │   ├── tray.rs             # System tray
│   │   └── state.rs            # App state
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── docs/                       # Documentation
├── Makefile                    # Build automation
├── package.json                # Frontend dependencies
└── CLAUDE.md                   # AI development instructions
```

## Debugging

### Frontend

- Open Chrome DevTools via the Tauri window
- React DevTools extension works in development mode
- Zustand DevTools available via middleware

### Backend

- Go's Delve debugger: `dlv debug ./backend`
- Structured logging with the `logger` package
- `CHATML_DEBUG=1` enables debug logging in agent runner

### Agent Runner

- `--sdk-debug` flag enables Claude SDK debug logging
- stderr output is captured by the Go backend
- `console.error()` writes to stderr for debugging

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `CHATML_DEBUG` | Enable debug logging |
| `SENTRY_DSN` | Sentry crash reporting |
| `NEXT_PUBLIC_WS_URL` | WebSocket URL override |

## Related Documentation

- [Testing Strategy](./testing-strategy.md)
- [Architecture Decisions](./architecture-decisions.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
