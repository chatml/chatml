# CLAUDE.md

ChatML is a native macOS desktop app for AI-assisted development. It uses isolated git worktrees to run parallel AI agent sessions. Polyglot architecture: Next.js frontend, Go backend, Tauri wrapper, Node.js agent runner.

## Task Management (MANDATORY)

**Before starting any work, ALWAYS create a task list using TodoWrite.** This provides visibility into what you're doing.

### When to Create Tasks

- ANY request that involves code changes
- ANY request with multiple steps
- Even "simple" styling changes (they often cascade)

### Task Workflow

1. **Analyze the request** - Break it down into discrete steps
2. **Create tasks** - Use `TodoWrite` for each step with clear `subject` and `activeForm`
3. **Work sequentially** - Update task to `in_progress` before starting, `completed` when done
4. **Add discovered tasks** - If you find additional work needed, create new tasks

### Example

User: "Make the font larger and add a blue pill style"

```
TodoWrite: "Increase font size" (activeForm: "Increasing font size")
TodoWrite: "Add blue pill styling" (activeForm: "Adding blue pill styling")
```

Then work through each task, updating status as you go.

**This is not optional.** The user needs visibility into your progress.

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
git checkout -b fix/description-of-change   # or feature/
```

> **Note:** Do NOT use `git stash` — stash is shared across all worktrees and can corrupt other sessions. Just create the branch directly (uncommitted changes carry over to the new branch).

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
