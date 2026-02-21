# Contributing to ChatML

Thank you for your interest in contributing to ChatML! This guide will help you get set up and start contributing.

ChatML is a polyglot project spanning four languages. You don't need to be an expert in all of them — most contributions touch only one layer.

| Layer | Directory | Language | You'll need |
|-------|-----------|----------|-------------|
| Frontend | `src/` | TypeScript / React | Node.js 20+, npm |
| Backend | `backend/` | Go | Go 1.25+ |
| Agent Runner | `agent-runner/` | TypeScript / Node.js | Node.js 20+, npm |
| Desktop Shell | `src-tauri/` | Rust | Rust 1.77+, Cargo |

---

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ (LTS) | [nodejs.org](https://nodejs.org) or `nvm install --lts` |
| Go | 1.25+ | [go.dev/dl](https://go.dev/dl/) |
| Rust | 1.77+ | [rustup.rs](https://rustup.rs) |
| Tauri CLI | 2.x | `cargo install tauri-cli` |

**macOS additional** (for Tauri):
```bash
xcode-select --install
```

**Linux additional** (for Tauri):
```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Clone and Setup

```bash
git clone https://github.com/chatml/chatml.git
cd chatml

# Install frontend + root dependencies
npm install

# Install agent-runner dependencies
cd agent-runner && npm install && cd ..

# Build the Go backend
cd backend && go build -o ../src-tauri/binaries/chatml-backend . && cd ..

# Run everything in development mode
make dev
```

This starts:
- Next.js frontend on `http://localhost:3100` (with Turbopack)
- Go backend on port `9876` (with fallback range 9877-9899)
- Tauri desktop window wrapping the frontend

### Layer-Specific Development

If you're only working on one layer, you don't need the full stack:

**Frontend only:**
```bash
npm install
npm run dev          # Next.js dev server on :3100
npm run lint         # ESLint
npm run test:run     # Vitest
npm run build        # Production build (also checks TypeScript)
```

**Backend only:**
```bash
cd backend
go mod download
go test -race ./...  # Run tests with race detection
go build ./...       # Verify compilation
```

**Agent Runner only:**
```bash
cd agent-runner
npm install
npm run build        # TypeScript compilation
npm run dev          # Watch mode
```

**Tauri / Rust only:**
```bash
cd src-tauri
cargo fmt --check    # Format check
cargo clippy -- -D warnings  # Lint
cargo test           # Unit tests
```

---

## Project Architecture

```
chatml/
├── src/                    # Next.js 16 frontend (React 19, Tailwind 4, Zustand 5)
│   ├── app/               # App Router pages
│   ├── components/        # 230+ React components
│   ├── hooks/             # 30+ custom hooks
│   ├── stores/            # Zustand state stores
│   └── lib/               # Utilities, API client, constants
├── backend/               # Go backend (chi router, WebSocket, SQLite)
│   ├── agent/             # Agent process lifecycle management
│   ├── git/               # Git worktree & branch operations
│   ├── github/            # GitHub API client
│   ├── linear/            # Linear API client
│   ├── models/            # Shared data structures
│   ├── server/            # HTTP handlers & WebSocket hub
│   └── store/             # SQLite persistence layer
├── agent-runner/          # Node.js agent process (Claude Agent SDK)
│   └── src/               # TypeScript source
├── src-tauri/             # Tauri 2 desktop shell (Rust)
│   └── src/               # Rust source
├── docs/                  # Architecture documentation
├── Makefile               # Build automation
└── CLAUDE.md              # AI assistant instructions
```

### Data Flow

```
User → Frontend (React) → Backend (Go) → Agent Runner (Node.js) → AI Model API
                  ↕ WebSocket                    ↕ JSON lines (stdin/stdout)
```

### Data Model

```
Workspace (git repository)
  └── Session (git worktree + branch)
       └── Conversation (task / review / chat)
            └── Message (user / assistant / system)
```

---

## Making Changes

### Branch Naming

```bash
git checkout -b feature/description   # New features
git checkout -b fix/description       # Bug fixes
git checkout -b docs/description      # Documentation
git checkout -b refactor/description  # Code refactoring
```

**Never commit directly to `main`.**

### Commit Messages

Write clear, concise commit messages. Use the imperative mood:

```
Add worktree cleanup on session archive
Fix WebSocket reconnection after backend restart
Refactor streaming state into dedicated store
```

### Pre-Commit Checklist

Run the checks for the layers you modified:

```bash
# Frontend
npm run lint
npm run test:run
npm run build

# Backend
cd backend && go test -race ./...
cd backend && go build ./...

# Agent Runner
cd agent-runner && npm run build

# Tauri
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy -- -D warnings
cd src-tauri && cargo test
```

Or run everything:
```bash
make test            # Go backend tests
npm run lint         # Frontend lint
npm run build        # Frontend build
```

### Pull Requests

1. Fork the repository and create a branch
2. Make your changes with clear commits
3. Run the relevant checks (see above)
4. Open a PR against `main`
5. Fill in the PR template — describe what changed and why
6. Link any related issues

PRs are reviewed for:
- **Correctness** — does it work as intended?
- **Consistency** — does it follow existing patterns?
- **Scope** — is it focused on one thing?
- **Tests** — are new behaviors covered?

---

## Where to Contribute

### Good First Issues

Look for issues labeled `good first issue`. These are scoped, well-defined tasks ideal for getting familiar with the codebase.

Typical good first issues:
- Add a new built-in skill (markdown file in `docs/skills/`)
- Fix a UI styling issue in a single component
- Add a missing API validation in a backend handler
- Improve error messages
- Add test coverage for an existing function

### Areas We Need Help

| Area | Skills Needed | Complexity |
|------|--------------|------------|
| **Windows/Linux polish** | Rust, Tauri | Medium |
| **New skills** | Markdown, domain expertise | Low |
| **MCP server integrations** | TypeScript, MCP protocol | Medium |
| **Test coverage** | Go (testify), TypeScript (Vitest) | Low-Medium |
| **Accessibility** | React, ARIA, screen readers | Medium |
| **Model provider abstraction** | TypeScript, AI SDK experience | High |
| **Performance** | React profiling, Go profiling | Medium-High |
| **Documentation** | Technical writing | Low |

### Skills Contributions

Skills are the easiest way to contribute. They're markdown files that provide specialized guidance to the AI agent. See `docs/skills/` for the 19 built-in skills as examples.

To add a skill:
1. Create a markdown file following the existing format
2. Define the skill metadata (name, description, category)
3. Write clear, actionable instructions
4. Submit a PR

---

## Code Style

### TypeScript / React

- **ESLint** enforces style — run `npm run lint`
- Use functional components with hooks
- Use `useShallow()` from Zustand for store selectors that return objects
- Prefer Tailwind utility classes over custom CSS
- Component files: PascalCase (`ConversationArea.tsx`)
- Hook files: camelCase with `use` prefix (`useWebSocket.ts`)
- Utility files: camelCase (`formatDate.ts`)

### Go

- **gofmt** enforces formatting
- Follow standard Go conventions (exported = PascalCase, unexported = camelCase)
- Use `chi` router patterns for new endpoints
- Return errors explicitly — don't panic
- Use `charmbracelet/log` for logging
- Test files mirror source: `handlers.go` → `handlers_test.go`

### Rust

- **cargo fmt** enforces formatting
- **cargo clippy** enforces best practices (warnings are errors in CI)
- Follow Tauri 2 plugin patterns for new native features
- Keep the Rust layer thin — business logic belongs in Go or TypeScript

### General

- No unused imports or variables
- No commented-out code in PRs
- Avoid adding new dependencies without justification
- Don't add features beyond what was requested

---

## Testing

### Frontend (Vitest + Testing Library)

```bash
npm run test:run          # Run all tests once
npm run test              # Watch mode
npm run test:coverage     # With coverage report
npm run test:ui           # Visual test UI
```

Tests live next to the code they test:
```
src/hooks/useWebSocket.ts
src/hooks/__tests__/useWebSocket.test.ts
```

### Backend (Go testing + testify)

```bash
cd backend
go test ./...              # Run all tests
go test -race ./...        # With race condition detection (used in CI)
go test -cover ./...       # With coverage
go test -v ./store/...     # Verbose, specific package
```

### Tauri (Cargo test)

```bash
cd src-tauri
cargo test
```

---

## Architecture Decisions

Before making significant architectural changes, please open an issue to discuss the approach. Areas that warrant discussion:

- Adding new dependencies (especially to the frontend bundle)
- Changing the database schema
- Modifying the agent-runner ↔ backend protocol
- Adding new Tauri plugins or native capabilities
- Changing the WebSocket event format

We maintain architecture decision records in `docs/` — check there for context on existing design choices.

---

## Development Tips

### Hot Reload

- **Frontend**: Turbopack provides instant HMR via `npm run dev`
- **Backend**: Restart manually (`make backend`) or use `air` for Go hot reload
- **Agent Runner**: Use `npm run dev` for TypeScript watch mode
- **Tauri**: `cargo tauri dev` rebuilds on Rust changes (slow — avoid if not touching Rust)

### Debugging

- **Frontend**: React DevTools + browser console. Zustand DevTools shows store state.
- **Backend**: `charmbracelet/log` outputs to stderr. Set `LOG_LEVEL=debug` for verbose output.
- **Agent Runner**: JSON lines on stdout — redirect to a file for inspection.
- **Tauri**: `println!` macros appear in the terminal that launched the app.

### Database

SQLite database lives at `~/.chatml/chatml.db`. To inspect:

```bash
sqlite3 ~/.chatml/chatml.db ".tables"
sqlite3 ~/.chatml/chatml.db ".schema sessions"
sqlite3 ~/.chatml/chatml.db "SELECT id, name, status FROM sessions LIMIT 10;"
```

The database uses WAL mode and a pure-Go driver (no CGo) — no native SQLite installation needed.

### Worktrees

Session worktrees are created at `~/.chatml/worktrees/<workspace>/<session>/`. Each is a full git worktree with its own branch. You can `cd` into any worktree and use standard git commands.

---

## Getting Help

- **Issues**: Open a GitHub issue for bugs, feature requests, or questions
- **Discussions**: Use GitHub Discussions for broader topics
- **Architecture docs**: Read `docs/` for deep dives into subsystems

---

## License

ChatML is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contributions will be licensed under the same license.
