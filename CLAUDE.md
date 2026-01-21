# CLAUDE.md

ChatML is a native macOS desktop app for AI-assisted development. It uses isolated git worktrees to run parallel AI agent sessions. Polyglot architecture: Next.js frontend, Go backend, Tauri wrapper, Node.js agent runner.

## Tech Stack & Directory Structure

| Directory | Tech | Purpose |
|-----------|------|---------|
| `src/` | Next.js 15 / React 19 | Frontend UI components & hooks |
| `backend/` | Go 1.25 | REST API, WebSocket, SQLite |
| `agent-runner/` | Node.js / TypeScript | Claude Agent SDK wrapper |
| `src-tauri/` | Rust / Tauri 2 | Native desktop shell |
| `speech-cli/` | Swift | macOS speech recognition |

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

## Issue Tracking (GitHub Issues)

This project uses **GitHub Issues** for issue tracking. Do NOT use Linear for this project.

### Creating Issues

Use clean titles without prefixes like `[BUG]` or `[PERF]`. Instead, set the **Issue Type**:

| Type | Use For |
|------|---------|
| Bug | Unexpected behavior, errors, crashes, race conditions |
| Task | Performance improvements, tests, refactoring, chores |
| Feature | New functionality, enhancements |

**Creating an issue:**
```bash
# Create issue with labels
gh issue create --title "Description of the issue" --body "..." --label "bug,frontend,P1"

# Set issue type via GraphQL (Bug=IT_kwDOAHVBAs4ADKJ1, Task=IT_kwDOAHVBAs4ADKJy, Feature=IT_kwDOAHVBAs4ADKJ5)
ID=$(gh issue view <number> --json id -q .id)
gh api graphql -f query='mutation { updateIssue(input: { id: "'"$ID"'", issueTypeId: "IT_kwDOAHVBAs4ADKJ1" }) { issue { number } } }'
```

### Labels

| Label | Description |
|-------|-------------|
| `frontend` | Frontend/UI (React, Next.js) |
| `backend` | Backend/Go related |
| `agent` | Claude agent/SDK related |
| `P0` | Critical - must fix immediately |
| `P1` | High priority |
| `P2` | Medium priority |
| `P3` | Low priority |
| `security` | Security issues |
| `perf` | Performance improvements |
| `test` | Test coverage |
| `reliability` | Reliability/resilience |

### Working on Issues

1. **Find an issue**: `gh issue list --label P0` or `gh issue list --label frontend`
2. **View details**: `gh issue view <number>`
3. **Create branch**: Use issue number in branch name (e.g., `fix/86-stale-closure`)

### Auto-Closing Issues (IMPORTANT)

**ALWAYS** include the exact closing keyword format in PR descriptions:

```
Fixes #86
```

| Format | Auto-closes? |
|--------|--------------|
| `Fixes #86` | ✅ Yes |
| `Closes #86` | ✅ Yes |
| `Resolves #86` | ✅ Yes |
| `Fixes Issue #86` | ❌ No (extra word) |
| `Addresses #86` | ❌ No (wrong keyword) |
| `Related to #86` | ❌ No (wrong keyword) |

**Multiple issues**: `Fixes #86, fixes #87, fixes #88` (repeat keyword)

**Where to put it**: First line of PR body or in a commit message that gets merged.

### Issue Body Template

```markdown
## Description
[What is the problem?]

## Location
`path/to/file.ts:line-number`

## Impact
[What happens if this isn't fixed?]

## Proposed Fix
[How should it be fixed?]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

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
