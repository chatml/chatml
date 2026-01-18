# ChatML MVP Design

## Overview

ChatML is an open-source macOS application that orchestrates multiple AI coding agents working simultaneously on isolated workspaces within a single repository. Built with Tauri, Next.js, and Go.

## Business Context

- **Model:** Open-source with services revenue (hosted services, support, consulting)
- **Differentiators (post-MVP):**
  - Linear integration with multi-account/team support
  - Smart agent orchestration (auto-task decomposition, conflict detection)
  - Price accessibility for indie devs/smaller teams

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         Tauri App                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Next.js Frontend                       │  │
│  │  - Repository management UI                               │  │
│  │  - Agent dashboard (status, logs, actions)                │  │
│  │  - Worktree/branch viewer                                 │  │
│  │  - Diff viewer & merge interface                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                         WebSocket                               │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Go Backend (sidecar)                   │  │
│  │  - Agent lifecycle (spawn, monitor, stop)                 │  │
│  │  - Git operations (clone, worktree, merge)                │  │
│  │  - Claude CLI wrapper (stream output)                     │  │
│  │  - WebSocket server for real-time updates                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│         ┌────────┐      ┌────────┐      ┌────────┐              │
│         │ Agent  │      │ Agent  │      │ Agent  │              │
│         │Worktree│      │Worktree│      │Worktree│              │
│         └────────┘      └────────┘      └────────┘              │
└────────────────────────────────────────────────────────────────┘
```

**How it works:**
1. Tauri bundles both the Next.js frontend and the Go backend binary
2. On launch, Tauri spawns the Go sidecar
3. Frontend connects via WebSocket for real-time agent updates
4. Go backend spawns `claude` CLI processes, each in its own git worktree
5. Output streams back through WebSocket to UI

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Shell | Tauri | Lightweight, Rust security, single binary |
| Frontend | Next.js + React | Developer comfort, fast iteration |
| Backend | Go | Compiled binary, excellent concurrency |
| AI Integration | Claude CLI | Wrapped by Go, streams output |
| State | Zustand | Lightweight, good for real-time |
| Styling | Tailwind CSS | Fast styling |

## MVP Features

### Core Features

1. **Repository Setup**
   - Add local repo path or clone from URL
   - App stores repo config (path, default branch, remote)

2. **Agent Spawning**
   - Click "New Agent" → enters task description
   - Go backend creates worktree: `git worktree add .worktrees/agent-{id} -b agent/{id}`
   - Spawns `claude` CLI in that directory with the task
   - Streams output to UI in real-time

3. **Dashboard View**
   - List of active agents with status (working, waiting, done, error)
   - Live output log per agent (collapsible)
   - Quick actions: pause, resume, stop, open in terminal

4. **Review & Merge**
   - When agent completes, show diff against base branch
   - One-click merge or cherry-pick specific commits
   - Discard worktree if not needed

### User Flow

```
Add Repo → Spawn Agent(s) → Monitor Progress → Review Diff → Merge/Discard
```

### Not in MVP (Future)

- Linear integration
- Multi-account/team
- Smart task decomposition
- Agent-to-agent communication
- Conflict detection

## Project Structure

```
chatml/
├── src-tauri/
│   ├── Cargo.toml          # Tauri dependencies
│   ├── tauri.conf.json     # App config, sidecar setup
│   ├── src/
│   │   └── main.rs         # Minimal: spawn sidecar, basic commands
│   └── binaries/           # Go binary placed here at build time
├── src/                    # Next.js frontend
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── repo/[id]/page.tsx
│   ├── components/
│   │   ├── RepoList.tsx
│   │   ├── AddRepoModal.tsx
│   │   ├── AgentCard.tsx
│   │   ├── AgentSpawnForm.tsx
│   │   ├── OutputLog.tsx
│   │   ├── DiffViewer.tsx
│   │   └── MergePanel.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   ├── useAgents.ts
│   │   └── useRepo.ts
│   ├── lib/
│   │   ├── api.ts
│   │   └── types.ts
│   └── stores/
│       └── appStore.ts
├── backend/                # Go backend
│   ├── main.go
│   ├── server/
│   │   ├── router.go
│   │   └── handlers.go
│   ├── agent/
│   │   ├── manager.go
│   │   ├── process.go
│   │   └── stream.go
│   ├── git/
│   │   ├── repo.go
│   │   ├── worktree.go
│   │   └── merge.go
│   ├── models/
│   │   └── types.go
│   └── config/
│       └── config.go
├── package.json
└── Makefile
```

## Go Backend Details

### Key Components

| Component | Responsibility |
|-----------|---------------|
| `agent.Manager` | Tracks all agents, handles concurrent spawning via goroutines |
| `agent.Process` | Wraps `exec.Cmd` for claude CLI, captures stdout/stderr |
| `git.Worktree` | Shell out to git for worktree operations |
| `server.Router` | Chi or Fiber for HTTP, gorilla/websocket for WS |

### WebSocket Events

```go
type Event struct {
    Type    string      `json:"type"`    // "output", "status", "error"
    AgentID string      `json:"agentId"`
    Payload interface{} `json:"payload"`
}
```

## Frontend Details

### Key Libraries

| Library | Purpose |
|---------|---------|
| Zustand | Lightweight state management |
| react-diff-view | Diff rendering |
| Tailwind CSS | Styling |
| xterm.js | Terminal-like output (optional) |

### Layout

```
┌─────────┬────────────────────────────────────┐
│  Repos  │  Agent 1  [Running]    [Stop]      │
│  -----  │  ┌─────────────────────────────┐   │
│  repo-1 │  │ > Analyzing codebase...     │   │
│  repo-2 │  │ > Found 12 files to modify  │   │
│         │  └─────────────────────────────┘   │
│         ├────────────────────────────────────│
│  [+Add] │  Agent 2  [Done]      [Review]     │
│         │  ┌─────────────────────────────┐   │
│         │  │ ✓ Task completed            │   │
│         │  └─────────────────────────────┘   │
└─────────┴────────────────────────────────────┘
```

## Tauri Configuration

### tauri.conf.json (key parts)

```json
{
  "bundle": {
    "externalBin": ["binaries/chatml-backend"]
  },
  "app": {
    "security": {
      "csp": null
    }
  }
}
```

### Minimal Rust (main.rs)

```rust
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let sidecar = app.shell()
                .sidecar("chatml-backend")?
                .spawn()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running app");
}
```

### Build Process (Makefile)

```makefile
build:
	cd backend && go build -o ../src-tauri/binaries/chatml-backend
	npm run tauri build
```

## Implementation Roadmap

### Phase 1: Foundation
- Set up Tauri + Next.js project
- Create Go backend skeleton with HTTP/WebSocket server
- Verify sidecar spawning works
- Basic UI shell (layout, routing)

### Phase 2: Git Operations
- Implement repo add/list/remove
- Worktree create/list/delete
- Test worktree isolation manually

### Phase 3: Agent Core
- Claude CLI process spawning in Go
- Output streaming via WebSocket
- Agent lifecycle (spawn, track status, stop)
- Frontend: AgentCard with live output

### Phase 4: Review & Merge
- Diff generation (worktree vs base branch)
- DiffViewer component
- Merge/discard operations
- Worktree cleanup after merge

### Phase 5: Polish & Package
- Error handling & edge cases
- App settings (claude path, default repo location)
- Tauri build for macOS (.dmg)
- Basic README for OSS release

## References

- [Tauri 2.0 Documentation](https://v2.tauri.app/)
- [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview)
- [Anthropic Go SDK](https://github.com/anthropics/anthropic-sdk-go)
- [Conductor.build](https://conductor.build) - inspiration
