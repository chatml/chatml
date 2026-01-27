# CLAUDE.md

ChatML is a native macOS desktop app for AI-assisted development. It uses isolated git worktrees to run parallel AI agent sessions. Polyglot architecture: Next.js frontend, Go backend, Tauri wrapper, Node.js agent runner.

## Tech Stack & Directory Structure

| Directory | Tech | Purpose |
|-----------|------|---------|
| `src/` | Next.js 15 / React 19 | Frontend UI components & hooks |
| `backend/` | Go 1.25 | REST API, WebSocket, SQLite |
| `agent-runner/` | Node.js / TypeScript | Claude Agent SDK wrapper |
| `src-tauri/` | Rust / Tauri 2 | Native desktop shell |

### Key Entry Points

- `backend/main.go` - Go server entry point (port 9876)
- `src/app/page.tsx` - Main dashboard page
- `agent-runner/src/index.ts` - Agent process entry
- `Makefile` - Build automation

## Development Commands

```bash
# Development
make dev              # Start all services (backend + frontend + Tauri)
make backend          # Run Go backend only
npm run dev           # Frontend dev server only

# Building
make build            # Production build
npm run build         # Frontend build only

# Linting & Type Checking
npm run lint          # ESLint
npm run build         # TypeScript checked during build
```

## Architecture

### Data Model Hierarchy

```
Workspace → Session → Conversation → Message
```

- **Workspace** - A repository on disk
- **Session** - An isolated git worktree for a task
- **Conversation** - Chat within a session (task, review, or chat type)
- **Message** - Individual messages with role (user/assistant/system)

### Communication Flow

1. Frontend connects to backend via HTTP REST + WebSocket (port 9876)
2. Backend spawns `agent-runner` Node.js processes
3. Agent processes run in isolated worktrees
4. Output streams through WebSocket to UI
5. State persisted in SQLite

### State Management

- **Frontend**: Zustand stores in `src/stores/`
- **Backend**: SQLite persistence in `backend/store/`

## Issue Tracking (Linear)

This project uses the **ChatML** team in Linear for issue tracking. Use the Linear MCP tools (e.g., `mcp__linear__list_issues`, `mcp__linear__create_issue`).

### Working with Issues

```bash
# List issues
mcp__linear__list_issues team="ChatML"

# Create issue
mcp__linear__create_issue team="ChatML" title="Description" description="..."

# View issue
mcp__linear__get_issue id="CHA-123"
```

### Priority Levels

| Priority | Use For |
|----------|---------|
| Urgent (1) | Critical - must fix immediately |
| High (2) | Important, blocks other work |
| Medium (3) | Normal priority |
| Low (4) | Nice to have |

## Git Workflow

### ⛔ CRITICAL: Never Commit to Main

**NEVER make changes directly on `main`.** This is a strict rule with no exceptions.

### Pre-Commit Checklist (MANDATORY)

**Before EVERY commit, you MUST run:**

```bash
git branch --show-current
```

**If the output is `main` or `master`, STOP and do this:**

```bash
git stash
git checkout -b fix/description-of-change   # or feature/
git stash pop
```

**Only then proceed with commit.**

### Branch Naming

```bash
git checkout -b fix/description-of-change
# or
git checkout -b feature/description-of-change
```

### Workflow

1. Check current branch (MANDATORY)
2. Create feature branch if on main
3. Make changes
4. Commit
5. Push
6. Create PR

**Treating this like a destructive operation - always verify the branch first.**

## Verification Checklist

Run before completing any task:

```bash
# Frontend
npm run lint
npm run build

# Backend
cd backend && go test ./...
cd backend && go build ./...

# Full stack (manual testing)
make dev
```
