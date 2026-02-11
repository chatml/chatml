# Session Lifecycle Management

Sessions are ChatML's primary unit of work. Each session represents an isolated development context with its own git worktree, branch, agent processes, and conversations. This document covers the full lifecycle from creation through deletion.

## Session States

Sessions have two independent status systems:

### Execution Status (`status`)

Tracks the agent process state:

| Status | Meaning |
|--------|---------|
| `active` | An agent process is running and processing |
| `idle` | No agent is running, awaiting user input |
| `done` | Session work is complete |
| `error` | An error occurred |

### Task Status (`taskStatus`)

Tracks the user's workflow stage:

| Status | Meaning |
|--------|---------|
| `backlog` | Not yet started |
| `in_progress` | Actively being worked on |
| `in_review` | Code review in progress |
| `done` | Task is complete |
| `cancelled` | Task was abandoned |

These are independent — a session can be `idle` (no agent running) but `in_progress` (the task isn't done yet).

## Session Creation

### Creation Flow

1. **User request** — `POST /api/repos/{id}/sessions` with session name and options
2. **Name generation** — If no name provided, a constellation-inspired name is generated
3. **Branch naming** — Branch name constructed using the workspace's prefix strategy
4. **Atomic directory creation** — `CreateSessionDirectoryAtomic()` creates the worktree directory under `~/.chatml/workspaces/`
5. **Worktree creation** — `git worktree add -b <branch> <path> <target>` creates the isolated working copy
6. **Database record** — Session record stored in SQLite with workspace ID, branch, path, and base commit
7. **File watcher registration** — Tauri registers the worktree path for file change detection

### Session from PR

Sessions can also be created from an existing pull request:

1. **Resolve PR** — `POST /api/resolve-pr` extracts the branch name from a PR URL
2. **Fetch branch** — `git fetch origin <branch>` retrieves the remote branch
3. **Checkout** — Creates a worktree with the existing remote branch (not a new branch)
4. **Protected branch check** — main/master/develop branches are rejected

## Agent Process Management

### Spawning

**File: `backend/agent/process.go`**

When a conversation starts, the Agent Manager spawns a Node.js process:

```go
type ProcessOptions struct {
    ID                  string
    Workdir             string      // Worktree path
    ConversationID      string
    ResumeSession       string      // SDK session ID to resume
    ForkSession         bool
    LinearIssue         string
    ToolPreset          string      // full, read-only, no-bash, safe-edit
    EnableCheckpointing bool
    MaxBudgetUsd        float64
    MaxTurns            int
    MaxThinkingTokens   int
    StructuredOutput    string      // JSON schema
    SettingSources      string
    Betas               string
    Model               string
    FallbackModel       string
}
```

These options are translated into CLI arguments for the `node agent-runner/dist/index.js` command.

### Communication

The Go backend communicates with each agent process via:
- **stdin** — JSON line messages (user input, stop, interrupt, model changes, etc.)
- **stdout** — JSON line events (agent output, tool events, results)
- **stderr** — Debug logging, prefixed and captured by the backend

### Buffer Management

```go
outputChan := make(chan OutputLine, 1000)  // Output channel buffer
const maxLineSize = 10 * 1024 * 1024       // 10MB max line size
const consumerTimeout = 5 * time.Second     // Consumer read timeout
```

Large JSON lines (up to 10MB) are supported for tool outputs that return substantial content.

### Process Lifecycle

1. **Spawn** — Process started with CLI arguments
2. **Ready** — Agent emits `ready` event
3. **Init** — Agent emits `init` event with configuration
4. **Message loop** — User messages sent via stdin, events received via stdout
5. **Stop** — Backend sends `stop` message, waits for graceful exit
6. **Force kill** — If process doesn't exit within 5 seconds, it's killed

## Session Resume and Fork

### Resume

Resuming continues an existing SDK session. The conversation history is preserved and the agent can continue where it left off.

```
node agent-runner/dist/index.js --resume <sessionId> --conversation-id <convId>
```

The `agentSessionId` stored on the Conversation record provides the session ID to resume.

### Fork

Forking creates a new session based on an existing one. The conversation history is copied but subsequent messages diverge.

```
node agent-runner/dist/index.js --resume <sessionId> --fork --conversation-id <convId>
```

### When to Use Each

| Scenario | Use |
|----------|-----|
| Continue previous work | Resume |
| Try a different approach | Fork |
| Context was compacted | New session (automatic) |
| Session was cleared | New session |

## File Checkpointing

### How Checkpoints Work

When `--enable-checkpointing` is set, the Claude SDK creates file checkpoints after modifying files:

1. **SDK modifies files** — Write or Edit tool changes files in the worktree
2. **SDK creates checkpoint** — Uses `git stash create` to capture file state without committing
3. **Agent emits event** — `checkpoint_created` with UUID, timestamp, and affected files
4. **Backend stores metadata** — Checkpoint UUID, message index, and conversation ID

### Rewind

Users can revert files to a previous checkpoint:

1. **User requests rewind** — `POST /api/conversations/{convId}/rewind` with `checkpointUuid`
2. **Backend sends message** — `{"type":"rewind_files","checkpointUuid":"..."}` to agent stdin
3. **Agent calls SDK** — `queryRef.rewindFiles(uuid)` restores file state
4. **Agent emits event** — `files_rewound` confirms the rewind

## Graceful Shutdown

### Agent Process Shutdown

When a conversation is stopped:

```go
func (m *Manager) StopConversation(convID string) error {
    // Send stop message via stdin
    proc.SendMessage(InputMessage{Type: "stop"})
    // Wait for graceful shutdown
    select {
    case <-proc.Done():       // Exited cleanly
    case <-time.After(5 * time.Second):
        proc.Kill()           // Force kill after timeout
    }
}
```

### Agent Runner Shutdown

On the Node.js side:

1. SIGTERM/SIGINT received → `isShuttingDown = true`
2. Abort controller cancels pending operations
3. SDK query is interrupted via `queryRef.interrupt()`
4. Readline interface closed
5. `shutdown` event emitted with reason
6. Process exits

## Session Management Features

### Priority

Sessions have priority levels (0-4) matching Linear's system:

| Value | Label | Use |
|-------|-------|-----|
| 0 | None | Default, no priority |
| 1 | Urgent | Critical, must fix immediately |
| 2 | High | Important, blocks other work |
| 3 | Medium | Normal priority |
| 4 | Low | Nice to have |

### Pinning and Archiving

- **Pinned sessions** appear at the top of the sidebar regardless of sorting
- **Archived sessions** are hidden from the default view and receive an AI-generated summary describing what was accomplished

### Auto-Naming

When the agent suggests a name via the `name_suggestion` event, the session can be automatically renamed. The `autoNamed` flag tracks whether the name was set by the AI.

### Stats Tracking

Sessions track additions/deletions counts (`SessionStats`) that are updated when changes are detected in the worktree.

## MCP Tools

Each agent process runs a built-in MCP server with workspace-aware tools:

| Tool | Purpose |
|------|---------|
| `get_session_status` | Current session info, git state, Linear issue |
| `get_workspace_diff` | Git diff from base branch |
| `get_recent_activity` | Recent git commits |
| `add_review_comment` | Add inline code review comment |
| `list_review_comments` | List existing comments |
| `get_review_comment_stats` | Per-file comment statistics |

The MCP server uses the `WorkspaceContext` class to provide git state information, resolving the Linear issue from CLI arguments, branch name, or recent commits.

## Related Documentation

- [Git Worktrees Explained](./git-worktrees-explained.md)
- [Claude Agent SDK Integration](./claude-agent-sdk-integration.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
