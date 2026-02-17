# WebSocket Events Reference

This document provides a complete reference of all WebSocket events in ChatML, including connection setup, event structure, and payload types for each event.

## Connection

### URL

```
ws://localhost:9876/ws?token=<auth-token>
```

In the Tauri desktop app, the port is discovered dynamically (range 9876-9899).

### Connection Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `token` | Yes | Auth token from Tauri shell |

### Connection Lifecycle

1. Client sends WebSocket upgrade request with token
2. Server validates token via `TokenAuthMiddleware`
3. Server registers client with the Hub
4. Client receives events via the send channel
5. Ping/pong heartbeats maintain connection health
6. On disconnect, auto-reconnect after `WEBSOCKET_RECONNECT_DELAY_MS`

### Health Parameters

| Parameter | Value |
|-----------|-------|
| Ping interval | ~54 seconds |
| Pong timeout | 60 seconds |
| Write deadline | 10 seconds per message |
| Client send buffer | 256 messages |
| Hub broadcast buffer | 1024 messages |

---

## Event Structure

Every WebSocket event follows this envelope:

```typescript
interface WebSocketEvent {
  type: string;                    // Event type identifier
  agentId?: string;                // Legacy agent ID
  sessionId?: string;              // Session context
  conversationId?: string;         // Conversation context
  payload?: any;                   // Event-specific data
}
```

The `type` field determines which handler processes the event. The `conversationId` field routes events to the correct conversation's streaming state.

---

## Event Catalog

### Session Events

#### `conversation_status`

Conversation execution status changed.

**Source:** Agent Manager
**Payload:**
```typescript
{
  type: "conversation_status";
  conversationId: string;
  payload: "active" | "idle" | "completed";
}
```

#### `session_name_update`

Session display name changed (via auto-naming or user edit).

**Source:** Agent Manager
**Payload:**
```typescript
{
  type: "session_name_update";
  sessionId: string;
  payload: {
    type: "session_name_update";
    name: string;
  };
}
```

#### `session_stats_update`

Session statistics updated (additions/deletions).

**Source:** Agent Manager
**Payload:**
```typescript
{
  type: "session_stats_update";
  sessionId: string;
  payload: {
    type: "session_stats_update";
    additions: number;
    deletions: number;
  };
}
```

#### `session_pr_update`

Session PR status changed.

**Source:** Agent Manager
**Payload:**
```typescript
{
  type: "session_pr_update";
  sessionId: string;
  payload: {
    type: "session_pr_update";
    prStatus: "none" | "open" | "merged" | "closed";
    prUrl?: string;
    prNumber?: number;
  };
}
```

---

### Initialization Events

#### `init`

Agent SDK initialized with model and capability information.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "init";
  conversationId: string;
  payload: {
    type: "init";
    model: string;              // e.g., "claude-sonnet-4-6"
    tools: string[];            // Available tool names
    system: string;             // System prompt (truncated)
    permissionMode: string;     // "default" | "plan" | "bypassPermissions" | etc.
    mcpServers: Array<{
      name: string;
      status: string;
    }>;
  };
}
```

#### `session_start`

A new session or resumed session started.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "session_start";
  payload: {
    type: "session_start";
    sessionId: string;
    source: "startup" | "resume" | "clear" | "compact";
  };
}
```

---

### Text Streaming Events

#### `assistant_text`

A chunk of the assistant's response text.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "assistant_text";
  conversationId: string;
  payload: {
    type: "assistant_text";
    content: string;           // Text chunk (may be partial word/sentence)
  };
}
```

**Frontend handling:** Appended to the streaming text buffer. Clears any active thinking indicator.

#### `thinking_start`

Extended thinking has begun.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "thinking_start";
  conversationId: string;
  payload: {
    type: "thinking_start";
  };
}
```

#### `thinking_delta`

A chunk of thinking text.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "thinking_delta";
  conversationId: string;
  payload: {
    type: "thinking_delta";
    content: string;
  };
}
```

#### `thinking`

A complete thinking block.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "thinking";
  conversationId: string;
  payload: {
    type: "thinking";
    content: string;           // Full thinking text
  };
}
```

---

### Tool Events

#### `tool_start`

A tool execution has started.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "tool_start";
  conversationId: string;
  payload: {
    type: "tool_start";
    id: string;                // Tool use ID
    tool: string;              // Tool name (e.g., "Read", "Write", "Bash")
    params: Record<string, any>; // Tool parameters
    startTime?: string;        // ISO timestamp
  };
}
```

#### `tool_end`

A tool execution completed.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "tool_end";
  conversationId: string;
  payload: {
    type: "tool_end";
    id: string;                // Must match tool_start id
    tool: string;
    success: boolean;
    result?: string;           // Tool output (may be truncated)
    error?: string;            // Error message if success=false
    endTime?: string;
  };
}
```

#### `tool_progress`

A tool is still executing (heartbeat for long-running tools).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "tool_progress";
  conversationId: string;
  payload: {
    type: "tool_progress";
    id: string;
    tool: string;
    progress?: string;         // Progress description
  };
}
```

---

### Hook Events

#### `ask_user_question`

The agent is asking the user a question (via the AskUserQuestion hook).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "ask_user_question";
  conversationId: string;
  payload: {
    type: "ask_user_question";
    question: string;
  };
}
```

**User response:** `POST /api/conversations/{convId}/answer-question`

#### `plan_mode_response`

The agent has entered plan mode and is requesting approval.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "plan_mode_response";
  conversationId: string;
  payload: {
    type: "plan_mode_response";
    planFile?: string;         // Path to plan file
  };
}
```

**User response:** `POST /api/conversations/{convId}/approve-plan`

#### `permission_mode_changed`

The permission mode for the conversation changed.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "permission_mode_changed";
  conversationId: string;
  payload: {
    type: "permission_mode_changed";
    mode: string;              // "default" | "plan" | "bypassPermissions" | etc.
  };
}
```

---

### Completion Events

#### `result`

The agent completed its turn with a final result.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "result";
  conversationId: string;
  payload: {
    type: "result";
    success: boolean;
    cost?: number;             // Cost in USD
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    duration?: number;         // Duration in milliseconds
    turnCount?: number;
    modelUsage?: Record<string, {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
    }>;
    sessionId?: string;        // SDK session ID
  };
}
```

**Frontend handling:** Finalizes the streaming message, updates conversation status, stores cost/token data.

#### `complete`

The stream is fully complete (all data flushed).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "complete";
  conversationId: string;
  payload: {
    type: "complete";
  };
}
```

**Frontend handling:** Clears all streaming state for the conversation.

#### `error`

An error occurred during agent execution.

**Source:** Agent Runner / Agent Manager
**Payload:**
```typescript
{
  type: "error";
  conversationId: string;
  payload: {
    type: "error";
    error: string;             // Error message
    code?: string;             // Error code
    fatal?: boolean;           // Whether the error is unrecoverable
  };
}
```

---

### Sub-Agent Events

#### `subagent_start`

A sub-agent was spawned by the main agent (via the Task tool).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "subagent_start";
  conversationId: string;
  payload: {
    type: "subagent_start";
    agentId: string;           // Sub-agent identifier
    description: string;       // Short task description
    model?: string;
  };
}
```

#### `subagent_end`

A sub-agent completed its work.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "subagent_end";
  conversationId: string;
  payload: {
    type: "subagent_end";
    agentId: string;
    success: boolean;
    result?: string;
  };
}
```

#### `subagent_tool_start` / `subagent_tool_end`

Tool events from within a sub-agent.

**Source:** Agent Runner
**Payload:** Same as `tool_start`/`tool_end` but with an additional `agentId` field identifying the sub-agent.

---

### Control Events

#### `name_suggestion`

The agent suggests a name for the conversation (based on content).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "name_suggestion";
  conversationId: string;
  payload: {
    type: "name_suggestion";
    name: string;
  };
}
```

#### `todo_update`

The agent updated its todo list (via the TodoWrite tool).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "todo_update";
  conversationId: string;
  payload: {
    type: "todo_update";
    todos: Array<{
      id: string;
      content: string;
      status: "pending" | "in_progress" | "completed";
    }>;
  };
}
```

---

### Checkpoint Events

#### `checkpoint_created`

A file checkpoint was created after file modifications.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "checkpoint_created";
  conversationId: string;
  payload: {
    type: "checkpoint_created";
    uuid: string;
    timestamp: string;
    files: Array<{
      path: string;
      action: "modified" | "created" | "deleted";
    }>;
  };
}
```

#### `files_rewound`

Files were rewound to a previous checkpoint.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "files_rewound";
  conversationId: string;
  payload: {
    type: "files_rewound";
    checkpointUuid: string;
  };
}
```

---

### Budget & Context Events

#### `budget_status`

Budget consumption update.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "budget_status";
  conversationId: string;
  payload: {
    type: "budget_status";
    currentCostUsd: number;
    maxBudgetUsd: number;
    currentTurns: number;
    maxTurns: number;
    percentUsed: number;
  };
}
```

#### `context_usage`

Context window usage information.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "context_usage";
  conversationId: string;
  payload: {
    type: "context_usage";
    usedTokens: number;
    maxTokens: number;
    percentUsed: number;
  };
}
```

---

### Notification Events

#### `notification`

A notification from the agent (displayed as a toast).

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "notification";
  conversationId: string;
  payload: {
    type: "notification";
    title?: string;
    message: string;
    level: "info" | "warning" | "error";
  };
}
```

---

### System Events

#### `streaming_warning`

Backpressure detected — streaming data may have been lost.

**Source:** WebSocket Hub
**Payload:**
```typescript
{
  type: "streaming_warning";
  payload: {
    type: "streaming_warning";
    message: string;
    bufferUtilization: number;  // Percentage (0-100)
  };
}
```

**Rate limited:** Backend emits at most once per 5 seconds. Frontend shows toast at most once per 10 seconds.

#### `ready`

The agent process is initialized and ready to receive messages.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "ready";
  conversationId: string;
  payload: {
    type: "ready";
  };
}
```

#### `shutdown`

The agent process is shutting down.

**Source:** Agent Runner
**Payload:**
```typescript
{
  type: "shutdown";
  conversationId: string;
  payload: {
    type: "shutdown";
    reason: "SIGTERM" | "SIGINT" | "error" | "complete";
  };
}
```

---

## Frontend Event Routing

The `useWebSocket` hook routes events to store actions:

| Event Type | Store Action | Effect |
|------------|-------------|--------|
| `assistant_text` | `appendStreamingText` | Appends text to streaming buffer |
| `thinking_start` | `setThinking(true)` | Shows thinking indicator |
| `thinking_delta` | `appendThinkingText` | Appends thinking text |
| `thinking` | `appendThinkingText` | Sets complete thinking block |
| `tool_start` | `addActiveTool` | Adds tool to active tools list |
| `tool_end` | `completeActiveTool` | Marks tool as complete |
| `tool_progress` | `updateToolProgress` | Updates tool progress indicator |
| `result` | `finalizeStreamingMessage` | Converts streaming to stored message |
| `complete` | `clearStreamingText` | Clears all streaming state |
| `error` | `setStreamingError` | Shows error in conversation |
| `conversation_status` | `setConversationStatus` | Updates status badge |
| `checkpoint_created` | `addCheckpoint` | Adds to checkpoint timeline |
| `name_suggestion` | `updateConversationName` | Renames conversation |
| `todo_update` | `updateTodos` | Updates todo list display |
| `ask_user_question` | `setPendingQuestion` | Shows question input |
| `plan_mode_response` | `setPlanModeActive` | Shows plan approval UI |
| `subagent_start` | `addSubAgent` | Adds sub-agent to tracking |
| `subagent_end` | `completeSubAgent` | Marks sub-agent complete |
| `budget_status` | `setBudgetStatus` | Updates budget indicator |
| `context_usage` | `setContextUsage` | Updates context meter |
| `streaming_warning` | `showWarningToast` | Shows backpressure toast |
| `session_name_update` | `updateSessionName` | Updates sidebar name |
| `session_stats_update` | `updateSessionStats` | Updates stats display |
| `session_pr_update` | `updateSessionPR` | Updates PR badge |

---

## Client Implementation

### Connecting

```typescript
const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);

ws.onopen = () => {
  console.log('Connected to WebSocket');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleEvent(data);
};

ws.onclose = () => {
  // Schedule reconnect
  setTimeout(connect, RECONNECT_DELAY_MS);
};
```

### Event Filtering

Events include `conversationId` for routing to the correct conversation's state. Filter events by checking this field:

```typescript
function handleEvent(event: WebSocketEvent) {
  if (event.conversationId && event.conversationId !== activeConversationId) {
    // Event for a different conversation — update in background
    return;
  }
  // Handle event for active conversation
}
```

### Reconnection

The frontend auto-reconnects on disconnect. During reconnection:
1. The streaming snapshot endpoint (`GET /api/conversations/{convId}/streaming-snapshot`) can recover missed state
2. Active streaming conversations are re-fetched to restore UI state

---

## Related Documentation

- [REST API Reference](./rest-api-reference.md)
- [WebSocket Streaming Architecture](../architecture/websocket-streaming.md)
- [Streaming Events System](../technical/streaming-events-system.md)
- [Frontend State & Rendering](../architecture/frontend-state-and-rendering.md)
