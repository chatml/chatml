# CLAUDE.md

ChatML is a native macOS desktop app for AI-assisted development. It uses isolated git worktrees to run parallel AI agent sessions. Polyglot architecture: Next.js frontend, Go backend, Tauri wrapper, Node.js agent runner.

## Task Management (MANDATORY)

Always create tasks with `TodoWrite` before starting work. Break requests into discrete steps, update each to `in_progress` before starting and `completed` when done. Add discovered tasks as you go. This is not optional — the user needs visibility into your progress.

## Tech Stack & Directory Structure

| Directory | Tech | Purpose |
|-----------|------|---------|
| `src/` | Next.js 16 / React 19 | Frontend UI components & hooks |
| `backend/` | Go 1.25 | REST API, WebSocket, SQLite |
| `agent-runner/` | Node.js / TypeScript | Claude Agent SDK wrapper + MCP tools |
| `src-tauri/` | Rust / Tauri 2 | Native desktop shell |

### Key Entry Points

- `backend/main.go` — Go server entry point (port 9876)
- `src/app/page.tsx` — Main dashboard page
- `agent-runner/src/index.ts` — Agent process entry
- `Makefile` — Build automation

### Key Frontend Patterns

- **Editor**: Plate.js rich text editor with InlineCombobox pattern for @ mentions and / slash commands
- **State**: Zustand stores in `src/stores/` (14 stores — app, auth, connection, settings, tabs, UI, etc.)
- **Components**: `src/components/` — `ui/` (shadcn/Radix primitives), `conversation/` (chat), `layout/` (shell), `panels/` (sidebars), `dialogs/` (modals)

### Database

- SQLite with WAL mode — schema in `backend/store/sqlite.go`
- Migrations via `runMigrations()` in the same file
- Key tables: repos, sessions, conversations, messages, tool_actions, review_comments, checkpoints, settings

## Development Commands

```bash
# Development
make dev              # Start all services (backend + frontend + Tauri)
make backend          # Build Go backend only
make agent-runner     # Build agent-runner TypeScript
npm run dev           # Frontend dev server only (port 3100, Turbopack)

# Building
make build            # Production build (Tauri + frontend + backend)
make build-debug      # Debug build (for deep links, OAuth testing)
make install-debug    # Install debug .app to /Applications

# Testing
npm run test          # Frontend tests (Vitest)
npm run test:run      # Frontend tests, single run
cd backend && go test -race ./...   # Backend tests
make test             # Backend tests with race detector
make test-cover       # Backend tests with coverage report

# Linting
npm run lint          # ESLint

# Release
make release VERSION=x.y.z   # Bump version, create PR (merge triggers CI build)

# Other
make init             # Initialize fresh worktree
make clean            # Remove all build artifacts
```

## Git Workflow

### ⛔ CRITICAL: Never Commit to Main

**NEVER make changes directly on `main`.** No exceptions.

Before EVERY commit, run `git branch --show-current`. If on `main`:

```bash
git checkout -b fix/description-of-change   # or feature/
```

> **⚠️ Never use `git stash`** — stash is shared across all worktrees and will corrupt other sessions. Uncommitted changes carry over to a new branch automatically.

### Branch Naming

- `fix/description-of-change`
- `feature/description-of-change`

## ChatML MCP Tools

When working in a ChatML session, you have access to `mcp__chatml__*` tools for:
- Session status, workspace diffs, workspace scripts config
- Sprint context and phase updates
- Linear issue integration (start, update status, clear)
- Review comments (add, list, resolve, stats)
- PR lifecycle (report created, report merged, clear link)

Use these tools to interact with the ChatML platform rather than manual workarounds.

## Verification Checklist

Run before completing any task:

```bash
npm run lint
npm run build        # Also checks TypeScript
make test            # Backend tests
```
