# Session Management Architecture

This document covers session lifecycle management, including session creation, agent process spawning, conversation resume/fork capabilities, and file checkpointing.

## Table of Contents

1. [Session Lifecycle](#session-lifecycle)
2. [Agent Process Management](#agent-process-management)
3. [Session Resume & Fork](#session-resume--fork)
4. [File Checkpointing](#file-checkpointing)
5. [MCP Integration](#mcp-integration)
6. [Graceful Shutdown](#graceful-shutdown)

## Session Lifecycle

### Session State Machine

```mermaid
stateDiagram-v2
    [*] --> Creating: Create session request
    Creating --> Active: Agent process started
    Active --> Active: Messages exchanged
    Active --> Idle: Agent completes turn
    Idle --> Active: User sends message
    Active --> Stopped: Stop requested
    Idle --> Stopped: Stop requested
    Stopped --> [*]: Session deleted

    note right of Creating
        Worktree created
        Agent process spawning
    end note

    note right of Active
        Agent processing
        Streaming responses
    end note

    note right of Idle
        Awaiting user input
        Resources held
    end note
```

### Session Creation Flow

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as Go Backend
    participant Store as SQLite
    participant Git as Git Worktree
    participant Mgr as Agent Manager
    participant Agent as Agent Runner

    UI->>API: POST /sessions (workspace, name)
    API->>Store: Create session record
    API->>Git: Create worktree (isolated branch)
    Git-->>API: Worktree path

    UI->>API: POST /conversations (sessionId, message)
    API->>Mgr: StartConversation(sessionId, message)
    Mgr->>Store: Create conversation record
    Mgr->>Agent: Spawn process with CLI args
    Agent-->>Mgr: Process started
    Mgr->>Agent: Send initial message (stdin)

    loop Streaming Response
        Agent-->>Mgr: stdout events
        Mgr-->>UI: WebSocket broadcast
    end
```

## Agent Process Management

### Process Options

**File: `backend/agent/process.go:32-50`**

```go
type ProcessOptions struct {
    ID                  string      // Unique process identifier
    Workdir             string      // Worktree path
    ConversationID      string      // Associated conversation
    ResumeSession       string      // Session ID to resume from
    ForkSession         bool        // Fork from existing session
    LinearIssue         string      // Linear issue (e.g., "LIN-123")
    ToolPreset          string      // Tool restrictions
    EnableCheckpointing bool        // File checkpoint support
    MaxBudgetUsd        float64     // Cost limit
    MaxTurns            int         // Turn limit
    MaxThinkingTokens   int         // Extended thinking budget
    StructuredOutput    string      // JSON schema for output
    SettingSources      string      // "project,user,local"
    Betas               string      // Beta features
    Model               string      // Model override
    FallbackModel       string      // Fallback model
}
```

### CLI Arguments Construction

**File: `backend/agent/process.go:115-179`**

```mermaid
flowchart TB
    Options[ProcessOptions]
    Base[node agent-runner/dist/index.js]
    CWD[--cwd workdir]
    Conv[--conversation-id uuid]

    subgraph Optional["Optional Arguments"]
        Resume[--resume sessionId]
        Fork[--fork]
        Linear[--linear-issue LIN-123]
        Preset[--tool-preset full|read-only]
        Checkpoint[--enable-checkpointing]
        Budget[--max-budget-usd N]
        Turns[--max-turns N]
        Thinking[--max-thinking-tokens N]
        Output[--structured-output schema]
        Settings[--setting-sources project,user]
        Betas[--betas features]
        Model[--model claude-sonnet-4]
        Fallback[--fallback-model claude-haiku]
    end

    Options --> Base
    Base --> CWD
    CWD --> Conv
    Conv --> Optional
```

### Process Communication

```mermaid
flowchart LR
    subgraph GoBackend["Go Backend"]
        Manager[Agent Manager]
        Process[Process struct]
        Input[stdin writer]
        Output[stdout reader]
        Errors[stderr reader]
    end

    subgraph NodeProcess["Node.js Process"]
        Agent[Agent Runner]
        SDK[Claude SDK]
    end

    Manager -->|JSON lines| Input
    Input -->|stdin| Agent
    Agent -->|stdout| Output
    Output -->|JSON lines| Manager
    Agent -->|stderr| Errors
    Errors -->|prefixed lines| Manager
```

### Input/Output Protocol

**Input Messages (stdin)**
```json
{"type":"message","content":"Implement feature X"}
{"type":"stop"}
{"type":"interrupt"}
{"type":"set_model","model":"claude-opus-4"}
{"type":"rewind_files","checkpointUuid":"chk_123"}
```

**Output Events (stdout)**
```json
{"type":"ready"}
{"type":"assistant_text","content":"I'll start by..."}
{"type":"tool_start","id":"t1","tool":"Read","params":{}}
{"type":"tool_end","id":"t1","success":true}
{"type":"result","success":true,"cost":0.02}
```

### Buffer Management

**File: `backend/agent/process.go:196-242`**

```go
// Output channel buffer
outputChan := make(chan OutputLine, 1000)

// Large JSON support
const maxLineSize = 10 * 1024 * 1024  // 10MB

// Consumer timeout
const consumerTimeout = 5 * time.Second
```

## Session Resume & Fork

### Resume vs Fork

```mermaid
flowchart TB
    subgraph Original["Original Session"]
        S1[Session abc123]
        M1[Message 1]
        M2[Message 2]
        M3[Message 3]
        C1[Checkpoint]
    end

    subgraph Resume["Resume (same session)"]
        S1R[Session abc123]
        M1R[Message 1]
        M2R[Message 2]
        M3R[Message 3]
        M4R[Message 4 - new]
    end

    subgraph Fork["Fork (new session)"]
        S2[Session def456]
        M1F[Message 1 - copied]
        M2F[Message 2 - copied]
        M3F[Message 3 - copied]
        M5F[Message 4 - divergent]
    end

    Original -->|Resume| Resume
    Original -->|Fork| Fork
```

### Resume Implementation

**File: `agent-runner/src/index.ts:42-52, 530-531`**

```typescript
// CLI argument parsing
const resumeIndex = args.indexOf("--resume");
const resumeSessionId = resumeIndex !== -1 ? args[resumeIndex + 1] : undefined;

// Query configuration
const result = await query(stream, {
  resume: resumeSessionId,
  // ...other options
});
```

### Fork Implementation

```typescript
// CLI argument parsing
const forkIndex = args.indexOf("--fork");
const forkSession = forkIndex !== -1;

// Query configuration (fork requires resume ID)
const result = await query(stream, {
  resume: resumeSessionId,
  forkSession: forkSession && !!resumeSessionId,
  // ...other options
});
```

### Session Source Types

**File: `agent-runner/src/index.ts:422`**

```typescript
type SessionSource =
  | "startup"   // New session
  | "resume"    // Resumed existing session
  | "clear"     // Session cleared/reset
  | "compact";  // Context compaction created new session
```

## File Checkpointing

### Checkpoint Flow

```mermaid
sequenceDiagram
    participant Claude
    participant SDK as Claude SDK
    participant Agent as Agent Runner
    participant Backend
    participant Git as Git (worktree)
    participant UI as Frontend

    Claude->>SDK: File modification (Write/Edit)
    SDK->>SDK: Track file changes
    SDK->>Agent: checkpoint_created hook

    Agent-->>Backend: {"type":"checkpoint_created",...}
    Backend->>Git: git stash create
    Git-->>Backend: Checkpoint hash

    Backend-->>UI: WebSocket: checkpoint_created

    Note over UI: User can rewind to this point

    UI->>Backend: POST /conversations/{id}/rewind
    Backend->>Agent: {"type":"rewind_files","checkpointUuid":"..."}
    Agent->>SDK: queryRef.rewindFiles(uuid)
    SDK->>Git: Restore file states
    Agent-->>Backend: {"type":"files_rewound"}
```

### Checkpoint Event Structure

```typescript
{
  type: "checkpoint_created",
  uuid: "chk_01ABC123",
  timestamp: "2025-01-15T10:30:00Z",
  files: [
    { path: "src/app.ts", action: "modified" },
    { path: "src/utils.ts", action: "created" },
    { path: "old-file.ts", action: "deleted" }
  ]
}
```

### Rewind Implementation

**File: `agent-runner/src/index.ts:207-214`**

```typescript
// Handle rewind request from stdin
if (parsed.type === "rewind_files") {
  if (queryRef && parsed.checkpointUuid) {
    await queryRef.rewindFiles(parsed.checkpointUuid);
    emit({ type: "files_rewound", checkpointUuid: parsed.checkpointUuid });
  }
  return;
}
```

**Backend Handler: `backend/server/handlers.go:2048-2079`**

```go
func (h *Handlers) RewindConversation(w http.ResponseWriter, r *http.Request) {
    convID := chi.URLParam(r, "convId")

    var req struct {
        CheckpointUuid string `json:"checkpointUuid"`
    }
    json.NewDecoder(r.Body).Decode(&req)

    err := h.agentManager.RewindConversationFiles(convID, req.CheckpointUuid)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    w.WriteHeader(http.StatusOK)
}
```

## MCP Integration

### Conductor MCP Server

**File: `agent-runner/src/mcp/server.ts:12-114`**

```mermaid
flowchart TB
    subgraph MCPServer["Conductor MCP Server"]
        GSS[get_session_status]
        GWD[get_workspace_diff]
        GRA[get_recent_activity]
        Linear[Linear Tools]
        Comments[Comment Tools]
    end

    subgraph Context["WorkspaceContext"]
        Git[Git State]
        Issue[Linear Issue]
        CWD[Working Directory]
    end

    subgraph Backend["Go Backend"]
        API[REST API]
    end

    GSS --> Context
    GWD --> Git
    GRA --> Git
    Linear --> API
    Comments --> API
```

### MCP Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `get_session_status` | Current session info | - |
| `get_workspace_diff` | Git diff from base | `detailed: boolean` |
| `get_recent_activity` | Recent commits | `limit: number` |
| `add_review_comment` | Add code comment | `file`, `line`, `content` |
| `list_review_comments` | List comments | `file?: string` |
| `get_review_comment_stats` | Comment statistics | - |

### Workspace Context

**File: `agent-runner/src/mcp/context.ts:30-46`**

```typescript
class WorkspaceContext {
  readonly cwd: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  private _linearIssue: LinearIssue | null = null;
  private _gitState: GitState | null = null;

  get gitState(): GitState {
    return {
      branch: string,           // Current branch
      baseBranch: string,       // main/origin/main
      uncommittedChanges: bool, // Dirty state
      aheadBy: number,          // Commits ahead
      behindBy: number          // Commits behind
    };
  }
}
```

### Linear Issue Resolution

**File: `agent-runner/src/mcp/context.ts:104-148`**

```mermaid
flowchart TB
    Start[Resolve Linear Issue]
    CLI{CLI argument?}
    Branch{Branch pattern?}
    Commits{Recent commits?}
    Found[Issue found]
    NotFound[No issue]

    Start --> CLI
    CLI -->|Yes| Found
    CLI -->|No| Branch
    Branch -->|Match LIN-123| Found
    Branch -->|No match| Commits
    Commits -->|Match [A-Z]+-\d+| Found
    Commits -->|No match| NotFound
```

Priority order:
1. Explicit CLI: `--linear-issue LIN-123`
2. Branch name: `feat/LIN-123-description`
3. Recent commits: `git log -5` matches `[A-Z]+-\d+`

## Graceful Shutdown

### Shutdown Flow

**File: `agent-runner/src/index.ts:869-928`**

```mermaid
sequenceDiagram
    participant Signal as OS Signal
    participant Agent as Agent Runner
    participant SDK as Claude SDK
    participant Backend as Go Backend

    Signal->>Agent: SIGTERM/SIGINT
    activate Agent

    Agent->>Agent: Set isShuttingDown = true

    alt Query active
        Agent->>SDK: abortController.abort()
        Agent->>SDK: queryRef.interrupt()
        SDK-->>Agent: Interrupted
    end

    Agent->>Agent: Close readline

    Agent-->>Backend: {"type":"shutdown","reason":"SIGTERM"}

    Agent->>Agent: process.exit(0)
    deactivate Agent
```

### Cleanup Implementation

```typescript
let cleanupCalled = false;
let isShuttingDown = false;

async function cleanup(reason: string): Promise<void> {
  if (cleanupCalled) return;
  cleanupCalled = true;

  // 1. Abort pending operations
  if (abortControllerRef) {
    abortControllerRef.abort();
  }

  // 2. Interrupt SDK query
  if (queryRef) {
    try {
      await queryRef.interrupt();
    } catch {
      // Ignore shutdown errors
    }
  }

  // 3. Close readline
  closeReadline();

  // 4. Emit shutdown event
  emit({ type: "shutdown", reason });
}

// Signal handlers
process.on("SIGTERM", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanup("SIGTERM").finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanup("SIGINT").finally(() => process.exit(0));
});
```

### Backend Process Termination

**File: `backend/agent/manager.go`**

```go
func (m *Manager) StopConversation(convID string) error {
    m.mu.Lock()
    proc, exists := m.convProcesses[convID]
    m.mu.Unlock()

    if !exists {
        return nil
    }

    // Send stop message
    proc.SendMessage(InputMessage{Type: "stop"})

    // Wait for graceful shutdown (with timeout)
    select {
    case <-proc.Done():
        // Process exited cleanly
    case <-time.After(5 * time.Second):
        // Force kill
        proc.Kill()
    }

    return nil
}
```

## Tool Presets

### Preset Configurations

**File: `agent-runner/src/index.ts:28-40`**

```typescript
function resolveToolPreset(preset: string): ToolConfig {
  switch (preset) {
    case "read-only":
      return {
        allowedTools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"]
      };
    case "no-bash":
      return {
        disallowedTools: ["Bash"]
      };
    case "safe-edit":
      return {
        allowedTools: ["Read", "Glob", "Grep", "Edit", "WebFetch", "WebSearch"]
      };
    case "full":
    default:
      return {};  // All tools enabled
  }
}
```

### Preset Comparison

```mermaid
graph TB
    subgraph Full["full (default)"]
        F1[Read] & F2[Write] & F3[Edit] & F4[Bash]
        F5[Glob] & F6[Grep] & F7[WebSearch] & F8[WebFetch]
        F9[Task] & F10[TodoWrite]
    end

    subgraph ReadOnly["read-only"]
        R1[Read] & R2[Glob] & R3[Grep]
        R4[WebFetch] & R5[WebSearch]
    end

    subgraph NoBash["no-bash"]
        N1[Read] & N2[Write] & N3[Edit]
        N4[Glob] & N5[Grep] & N6[WebSearch] & N7[WebFetch]
        N8[Task] & N9[TodoWrite]
    end

    subgraph SafeEdit["safe-edit"]
        S1[Read] & S2[Edit] & S3[Glob]
        S4[Grep] & S5[WebFetch] & S6[WebSearch]
    end
```

## Related Documentation

- [Conversation Architecture Overview](./conversation-architecture.md)
- [Data Models & Persistence](./data-models-persistence.md)
- [Claude SDK Events](./claude-sdk-events.md)
- [WebSocket Streaming](./websocket-streaming.md)
