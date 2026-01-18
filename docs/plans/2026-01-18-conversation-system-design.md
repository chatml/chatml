# Conversation System Design

## Overview

Enable multi-turn conversational interactions with AI agents working in isolated git worktrees. Users can have multiple conversations per session (task, review, chat), with full conversation persistence and tool usage tracking.

## Architecture

```
┌──────────────┐     HTTP/WS      ┌──────────────┐    stdin/stdout   ┌──────────────┐
│   Frontend   │ ◄──────────────► │  Go Backend  │ ◄───────────────► │ Node Agent   │
│   (Next.js)  │                  │              │                   │   Runner     │
└──────────────┘                  └──────────────┘                   └──────────────┘
                                         │                                  │
                                         ▼                                  ▼
                                  ┌──────────────┐                   ┌──────────────┐
                                  │   SQLite     │                   │ Claude Code  │
                                  │ (persist)    │                   │     SDK      │
                                  └──────────────┘                   └──────────────┘
```

**Relationship model:**
```
Workspace → Session (worktree) → Multiple Conversations
```

## Data Model

### Conversation

```go
type Conversation struct {
    ID          string       `json:"id"`
    SessionID   string       `json:"sessionId"`
    Type        string       `json:"type"`        // "task", "review", "chat"
    Name        string       `json:"name"`        // AI-updatable
    Status      string       `json:"status"`      // "active", "idle", "completed"
    Messages    []Message    `json:"messages"`
    ToolSummary []ToolAction `json:"toolSummary"`
    CreatedAt   time.Time    `json:"createdAt"`
    UpdatedAt   time.Time    `json:"updatedAt"`
}

type Message struct {
    Role      string    `json:"role"`      // "user", "assistant"
    Content   string    `json:"content"`
    Timestamp time.Time `json:"timestamp"`
}

type ToolAction struct {
    Tool    string `json:"tool"`    // "read_file", "write_file", "bash"
    Target  string `json:"target"`  // file path or command
    Success bool   `json:"success"`
}
```

### Conversation Types

| Type | Purpose | Auto-name example |
|------|---------|-------------------|
| `task` | Main development work | "Add login button" |
| `review` | Code review conversations | "Review: auth changes" |
| `chat` | General questions/exploration | "Chat #1" |

## Node Agent Runner

**Location:** `agent-runner/`

**Structure:**
```
agent-runner/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

**Spawned by Go:**
```bash
node agent-runner/dist/index.js \
  --cwd /path/to/worktree \
  --conversation-id abc123
```

### Protocol

**stdin (Go → Node):**
```json
{"type": "message", "content": "Add a login button"}
{"type": "stop"}
```

**stdout (Node → Go):**
```json
{"type": "assistant_text", "content": "I'll add a login button to the header.\n"}
{"type": "tool_start", "tool": "read_file", "id": "t1", "params": {"path": "src/App.tsx"}}
{"type": "tool_end", "id": "t1", "success": true, "summary": "Read 150 lines"}
{"type": "name_suggestion", "name": "Add login button"}
{"type": "complete"}
{"type": "error", "message": "SDK connection failed"}
```

### Behaviors

- Uses `@anthropic-ai/claude-code` SDK with `acceptAllPermissions: true`
- Buffers text output, emits on newlines (line-level streaming)
- Emits `name_suggestion` after understanding the task
- Graceful shutdown on `stop` message or SIGTERM
- Full tool access (read, write, bash, web search)

## Go Backend

### File Changes

| File | Changes |
|------|---------|
| `models/types.go` | Add `Conversation`, `Message`, `ToolAction` types |
| `store/store.go` | Add conversation CRUD methods |
| `agent/process.go` | Spawn Node runner instead of Claude CLI |
| `agent/parser.go` | Parse new event format |
| `agent/manager.go` | Track process per conversation (not per session) |
| `server/handlers.go` | Add conversation endpoints |
| `server/router.go` | Wire up new routes |

### New Endpoints

```
GET    /api/sessions/{id}/conversations           # List conversations
POST   /api/sessions/{id}/conversations           # Create conversation
GET    /api/conversations/{id}                    # Get conversation
POST   /api/conversations/{id}/messages           # Send message
DELETE /api/conversations/{id}                    # Delete conversation
```

### WebSocket Events

```json
{"type": "assistant_text", "conversationId": "...", "content": "..."}
{"type": "tool_start", "conversationId": "...", "tool": "read_file", "id": "t1"}
{"type": "tool_end", "conversationId": "...", "id": "t1", "success": true}
{"type": "name_suggestion", "conversationId": "...", "name": "Add login button"}
{"type": "conversation_complete", "conversationId": "..."}
```

## Frontend

### State (appStore)

```typescript
// Per-session conversation list
conversations: Map<sessionId, Conversation[]>

// Active conversation per session (tab selection)
activeConversationId: Map<sessionId, conversationId>

// Streaming state per conversation
streamingText: Map<conversationId, string>
activeTools: Map<conversationId, ToolProgress[]>
```

### Components

| Component | Purpose |
|-----------|---------|
| `ConversationTabs` | Tab bar showing conversations. "+" to create new. |
| `ConversationArea` | Messages list with inline tool displays |
| `ChatInput` | Sends to active conversation. Creates on first message. |
| `ToolUsageBlock` | Collapsible inline showing tool name, target, status |

### WebSocket Handlers

```typescript
case 'assistant_text':
  appendStreamingText(conversationId, content);
  break;
case 'tool_start':
  addActiveTool(conversationId, { id, tool, params });
  break;
case 'tool_end':
  completeActiveTool(conversationId, id, success, summary);
  break;
case 'name_suggestion':
  updateConversationName(conversationId, name);
  break;
case 'conversation_complete':
  finalizeMessage(conversationId);
  break;
```

### UI Flow

1. User types in `ChatInput` → creates conversation (if none) + sends message
2. `assistant_text` events append to streaming message
3. `tool_start`/`tool_end` show inline collapsible progress
4. `conversation_complete` finalizes the message
5. `name_suggestion` updates the tab label

## Implementation Phases

### Phase 1: Node Agent Runner
1. Create `agent-runner/` with package.json, tsconfig
2. Implement stdin/stdout protocol
3. Integrate Claude Code SDK with `acceptAllPermissions: true`
4. Line-buffered text output, emit `name_suggestion` after first response
5. Test standalone with manual stdin

### Phase 2: Backend - Data Model
1. Add `Conversation`, `Message`, `ToolAction` to `models/types.go`
2. Add conversation CRUD to `store/store.go`
3. Update `process.go` to spawn Node runner
4. Update `parser.go` for new event format
5. Update `manager.go` to track per-conversation processes

### Phase 3: Backend - API
1. Add conversation endpoints to `handlers.go`
2. Wire routes in `router.go`
3. Update WebSocket hub for new event types
4. Test via curl

### Phase 4: Frontend
1. Add conversation state to appStore
2. Create `ConversationTabs` component
3. Update `ConversationArea` for message streaming
4. Create `ToolUsageBlock` component
5. Update `ChatInput` for conversation creation
6. Wire WebSocket handlers

### Phase 5: Polish
1. Error handling and reconnection
2. Conversation status indicators
3. Stop/cancel mid-conversation
4. Loading states

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agent runner | Node.js with Claude Code SDK | More control than CLI, SDK features |
| Permissions | Auto-accept all | Isolated worktree, simpler UX |
| Persistence | Backend (SQLite) | Multiple conversations, survives restarts |
| Streaming | Line-level | Balance between smoothness and simplicity |
| Tool display | Inline collapsible | Context preserved, details available |
| Naming | AI-suggested | Better UX than manual naming |
