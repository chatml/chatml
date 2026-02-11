# WebSocket Streaming

ChatML uses a hub-and-spoke WebSocket architecture for real-time event delivery. This document explains the broadcast system, event types, backpressure management, and connection resilience.

## Why WebSockets?

ChatML considered four options for real-time communication:

| Option | Rejected Because |
|--------|-----------------|
| **Polling** | Too much latency for streaming text; wasteful when idle |
| **Server-Sent Events (SSE)** | Unidirectional; ChatML needs bidirectional capability for future features |
| **GraphQL Subscriptions** | Over-engineered for this use case; adds dependency complexity |
| **WebSockets** | Selected — low latency, bidirectional, well-supported |

## Hub-and-Spoke Architecture

**File: `backend/server/websocket.go`**

The Go backend runs a single WebSocket Hub that all clients connect to. When an agent event occurs, the Hub broadcasts it to every connected client. The frontend filters events by `conversationId` to display only relevant updates.

### Hub Structure

```go
type Hub struct {
    clients         map[*Client]bool        // Connected clients
    broadcast       chan []byte             // Pre-serialized JSON (buffer: 4096)
    register        chan *Client            // New client registration
    unregister      chan *Client            // Client disconnection (buffer: 64)
    mu              sync.RWMutex
    metrics         *HubMetrics
    lastWarningTime atomic.Int64            // Rate-limit warning emissions
}
```

### Client Structure

```go
type Client struct {
    hub      *Hub
    conn     *websocket.Conn
    send     chan []byte      // Buffered channel (2048 messages)
    closeOnce sync.Once
    evicting  atomic.Bool
    writeMu   sync.Mutex
}
```

### Event Structure

Every event broadcast through the Hub follows this structure:

```go
type Event struct {
    Type           string      `json:"type"`
    AgentID        string      `json:"agentId,omitempty"`
    SessionID      string      `json:"sessionId,omitempty"`
    ConversationID string      `json:"conversationId,omitempty"`
    Payload        interface{} `json:"payload,omitempty"`
}
```

The `Type` field identifies the event, and `ConversationID` or `SessionID` enables frontend filtering.

## Broadcast Flow

When an agent event needs to reach the frontend:

1. **Agent Manager** receives an event from an agent process's stdout
2. **Agent Manager** calls `hub.Broadcast(event)` which JSON-marshals the event once
3. **Hub** checks the broadcast channel buffer utilization (warning at >75% capacity)
4. **Hub** sends the serialized bytes into the broadcast channel with a 2-second timeout
5. **Hub.Run()** goroutine receives from the broadcast channel
6. **For each connected client**, Hub attempts a non-blocking send into the client's send channel
7. If a client's send buffer is full, the Hub spawns an eviction goroutine to disconnect that slow client
8. Each client's **writePump** goroutine reads from the send channel and writes to the WebSocket connection

### Event Routing

Events are wired in `router.go`:

```go
// Agent stdout events → WebSocket broadcast
agentMgr.SetConversationEventHandler(func(conversationID string, event *agent.AgentEvent) {
    hub.Broadcast(Event{
        Type:           event.Type,
        ConversationID: conversationID,
        Payload:        event,
    })
})

// Conversation status changes → WebSocket broadcast
agentMgr.SetConversationStatusHandler(func(conversationID string, status string) {
    hub.Broadcast(Event{
        Type:           "conversation_status",
        ConversationID: conversationID,
        Payload:        status,
    })
})

// Session-level events → WebSocket broadcast
agentMgr.SetSessionEventHandler(func(sessionID string, event map[string]interface{}) {
    eventType, _ := event["type"].(string)
    hub.Broadcast(Event{
        Type:      eventType,
        SessionID: sessionID,
        Payload:   event,
    })
})
```

## Event Types

ChatML defines 47+ event types organized into categories:

### Core Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `ready` | Agent runner initialized | — |
| `init` | SDK provides configuration | `model`, `tools`, `mcpServers`, `budgetConfig`, `permissionMode` |
| `assistant_text` | Claude produces text | `content` |
| `result` | Agent turn completes | `success`, `cost`, `turns`, `stats`, `usage`, `durationMs` |
| `complete` | Stream finished | — |
| `error` | Unhandled error | `message` |
| `shutdown` | Agent process exiting | `reason` |

### Thinking Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `thinking_start` | Extended thinking begins | — |
| `thinking_delta` | Thinking text chunk | `content` |
| `thinking` | Complete thinking block | `content` |

### Tool Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `tool_start` | Tool execution begins | `id`, `tool`, `params` |
| `tool_end` | Tool execution completes | `id`, `tool`, `success`, `summary`, `duration` |
| `tool_progress` | Long-running tool update | `id`, `tool`, `elapsedTimeSeconds` |
| `hook_pre_tool` | Before tool execution | `id`, `tool`, `params` |
| `hook_post_tool` | After tool execution | `id`, `tool`, result |
| `hook_tool_failure` | Tool failed | `id`, `tool`, error |

### Session Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `session_started` | SDK session initialized | `sessionId`, `source`, `cwd` |
| `session_ended` | SDK session completed | `sessionId`, `reason` |
| `session_id_update` | Session ID changed | `sessionId` |
| `conversation_status` | Status changed | `status` (active/idle/completed) |

### Sub-Agent Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `subagent_started` | Sub-agent spawned | `agentId`, `agentType`, `parentToolUseId` |
| `subagent_stopped` | Sub-agent completed | `agentId` |

### Control Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `permission_mode_changed` | Permission mode updated | `mode` |
| `model_changed` | Model switched | `model` |
| `interrupted` | Agent interrupted | — |
| `compact_boundary` | Context compacted | `trigger`, `preTokens` |

### Checkpoint Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `checkpoint_created` | File state saved | `checkpointUuid`, `messageIndex` |
| `files_rewound` | Files reverted to checkpoint | `checkpointUuid` |

### Information Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `supported_models` | Model list requested | `models` |
| `supported_commands` | Command list requested | `commands` |
| `mcp_status` | MCP status requested | `servers` |
| `account_info` | Account info requested | `info` |
| `name_suggestion` | AI suggests name | `name` |
| `todo_update` | TodoWrite tool used | `todos` |
| `status_update` | Agent status update | `status` |
| `auth_status` | Auth state changed | `isAuthenticating`, `output` |
| `agent_notification` | Agent notification | `title`, `message` |
| `agent_stop` | Stop hook fired | `stopHookActive` |
| `agent_stderr` | Agent stderr output | `data` |
| `hook_response` | Hook execution result | `hookName`, `hookEvent`, `stdout`, `stderr`, `exitCode` |
| `user_question_request` | AskUserQuestion tool | `requestId`, `questions` |

## Frontend Event Handling

**File: `src/hooks/useWebSocket.ts`**

The frontend WebSocket hook connects to `ws://localhost:9876/ws?token=...` and processes incoming events:

1. **Parse** — JSON.parse the incoming message
2. **Extract** — Pull `type`, `conversationId`, `sessionId`, and `payload` from the event
3. **Route** — Switch on event type and dispatch to the appropriate store action

Key routing logic:

| Event Type | Store Action |
|-----------|-------------|
| `assistant_text` | `appendStreamingText(conversationId, content)` then `clearThinking(conversationId)` |
| `thinking_start` | `setThinking(conversationId, true)` |
| `thinking_delta` | `appendThinkingText(conversationId, content)` |
| `tool_start` | `addActiveTool(conversationId, {id, tool, params})` |
| `tool_end` | `completeActiveTool(conversationId, {id, success, summary})` |
| `result` | `finalizeStreamingMessage(conversationId, text, runSummary, toolUsage)` |
| `complete` | `clearStreamingText(conversationId)` |
| `todo_update` | `setAgentTodos(conversationId, todos)` |
| `conversation_status` | Update conversation status in store |
| `permission_mode_changed` | Update plan mode state |
| `name_suggestion` | Update conversation name |
| `user_question_request` | Show user question dialog |

### Connection State Machine

The WebSocket connection follows this lifecycle:

1. **Disconnected** — Initial state
2. **Connecting** — WebSocket upgrade in progress, token validation
3. **Connected** — Messages flowing, ping/pong heartbeat active
4. **Disconnected** — Connection lost, auto-reconnect scheduled after delay

On reconnection, the frontend re-subscribes to events and can request a streaming snapshot for any active conversations.

## Backpressure Management

High-throughput agent operations (e.g., rapid tool execution, large file reads) can produce events faster than clients consume them. ChatML implements three levels of protection:

### Level 1: Hub Broadcast Channel

The broadcast channel has a 4096-message buffer. When the buffer exceeds 75% utilization, the Hub logs a backpressure warning. If the channel is full, sends time out after 2 seconds.

### Level 2: Client Send Buffer

Each client has a 2048-message send buffer. When the Hub tries to send an event and the client's buffer is full, the Hub knows the client is too slow.

### Level 3: Client Eviction

When a client's buffer is full, the Hub spawns an asynchronous goroutine to disconnect and clean up that client. This prevents a single slow client from blocking event delivery to all other clients.

### Warning Rate Limiting

Backpressure warnings are rate-limited to prevent log spam:
- **Backend**: Maximum 1 warning per 5 seconds (using atomic compare-and-swap)
- **Frontend**: Maximum 1 toast notification per 10 seconds

The frontend warning is displayed more conservatively because user-facing notifications should be less frequent.

## Metrics

The Hub tracks operational metrics via atomic counters:

| Metric | Description |
|--------|-------------|
| `messagesDelivered` | Successful event transmissions |
| `messagesDropped` | Events not delivered (slow clients) |
| `messagesTimedOut` | Broadcast channel timeouts |
| `clientsDropped` | Slow clients disconnected |
| `broadcastBackpressure` | High buffer utilization events |
| `peakClients` | Maximum concurrent connections |
| `currentClients` | Active connections right now |

These metrics are available via `GET /ws/stats` for monitoring.

## Connection Health

### Ping/Pong Heartbeat

The WebSocket connection uses ping/pong frames to detect dead connections:

| Parameter | Value |
|-----------|-------|
| Ping interval | ~54 seconds (90% of pong timeout) |
| Pong timeout | 60 seconds |
| Write deadline | 10 seconds per message |
| Read limit | 512 bytes (only pongs expected) |
| Client send timeout | 100ms (non-blocking send check) |

If a client fails to respond to a ping within 60 seconds, the server closes the connection. If a write takes longer than 10 seconds, the connection is also closed.

### Reconnection

When the frontend loses its WebSocket connection:

1. The `onclose` handler fires
2. A reconnect timer is scheduled with `WEBSOCKET_RECONNECT_DELAY_MS`
3. The frontend attempts to reconnect
4. On successful reconnection, the `onopen` handler fires and clears the reconnect timer

## Related Documentation

- [Polyglot Architecture](./polyglot-architecture.md)
- [Streaming Events System](../technical/streaming-events-system.md)
- [Frontend State & Rendering](./frontend-state-and-rendering.md)
