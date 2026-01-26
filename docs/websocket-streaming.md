# WebSocket Streaming Architecture

This document covers the real-time WebSocket streaming system, including the backend Hub architecture, frontend connection handling, event flow, and backpressure management.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [WebSocket Hub](#websocket-hub)
3. [Event Types](#event-types)
4. [Frontend Connection](#frontend-connection)
5. [Backpressure Management](#backpressure-management)
6. [Error Handling](#error-handling)

## Architecture Overview

ChatML uses a hub-and-spoke WebSocket architecture where a central Hub broadcasts events to all connected clients.

```mermaid
graph TB
    subgraph Backend
        AgentMgr[Agent Manager]
        Hub[WebSocket Hub]
        Client1[Client 1]
        Client2[Client 2]
        Client3[Client N]
    end

    subgraph Frontend
        WS1[WebSocket Hook]
        WS2[WebSocket Hook]
        WS3[WebSocket Hook]
    end

    AgentMgr -->|Events| Hub
    Hub -->|Broadcast| Client1
    Hub -->|Broadcast| Client2
    Hub -->|Broadcast| Client3
    Client1 <-->|WebSocket| WS1
    Client2 <-->|WebSocket| WS2
    Client3 <-->|WebSocket| WS3
```

## WebSocket Hub

### Hub Structure

**File: `backend/server/websocket.go:107-127`**

```go
type Hub struct {
    clients         map[*Client]bool        // Connected clients
    broadcast       chan []byte             // Pre-serialized JSON (buffer: 1024)
    register        chan *Client            // New client registration
    unregister      chan *Client            // Client disconnection (buffer: 64)
    mu              sync.RWMutex
    metrics         *HubMetrics
    lastWarningTime atomic.Int64            // Rate-limit warning emissions
}

type Client struct {
    hub  *Hub
    conn *websocket.Conn
    send chan []byte     // Buffered channel (256 messages)
}
```

### Event Structure

**File: `backend/server/websocket.go:42-48`**

```go
type Event struct {
    Type           string      `json:"type"`
    AgentID        string      `json:"agentId,omitempty"`
    SessionID      string      `json:"sessionId,omitempty"`
    ConversationID string      `json:"conversationId,omitempty"`
    Payload        interface{} `json:"payload,omitempty"`
}
```

### Hub Run Loop

```mermaid
flowchart TB
    subgraph HubRun["Hub.Run() - Main Loop"]
        Start([Start])
        Wait{Select on channels}

        subgraph Register
            R1[Add client to map]
            R2[Update metrics]
        end

        subgraph Unregister
            U1[Remove from map]
            U2[Close send channel]
            U3[Update metrics]
        end

        subgraph Broadcast
            B1[Check buffer utilization]
            B2{> 75% full?}
            B3[Log warning]
            B4[Send to all clients]
            B5{Client buffer full?}
            B6[Spawn eviction goroutine]
            B7[Queue message]
        end
    end

    Start --> Wait
    Wait -->|register| R1 --> R2 --> Wait
    Wait -->|unregister| U1 --> U2 --> U3 --> Wait
    Wait -->|broadcast| B1 --> B2
    B2 -->|Yes| B3 --> B4
    B2 -->|No| B4
    B4 --> B5
    B5 -->|Yes| B6 --> Wait
    B5 -->|No| B7 --> Wait
```

### Broadcast Flow

**File: `backend/server/websocket.go:203-262`**

```mermaid
sequenceDiagram
    participant Mgr as Agent Manager
    participant Hub
    participant Broadcast as Broadcast Channel
    participant Client as Client Buffers

    Mgr->>Hub: Broadcast(Event)
    Hub->>Hub: JSON Marshal event

    Hub->>Hub: Check buffer utilization
    alt Buffer > 75%
        Hub->>Hub: Log backpressure warning
    end

    Hub->>Broadcast: Send with 2s timeout
    alt Timeout
        Hub->>Hub: Emit rate-limited warning
        Hub-->>Mgr: Return timeout result
    end

    Broadcast->>Hub: Hub.Run receives

    loop For each client
        Hub->>Client: Non-blocking send
        alt Client buffer full
            Hub->>Hub: Spawn eviction goroutine
            Hub->>Client: Close and unregister
        end
    end
```

## Event Types

### Complete Event Catalog

| Event Type | Source | Direction | Description |
|------------|--------|-----------|-------------|
| `init` | Agent | Hub → Client | SDK initialization with model/tools info |
| `assistant_text` | Agent | Hub → Client | Streamed response text |
| `thinking_start` | Agent | Hub → Client | Extended thinking began |
| `thinking_delta` | Agent | Hub → Client | Thinking text chunk |
| `thinking` | Agent | Hub → Client | Complete thinking block |
| `tool_start` | Agent | Hub → Client | Tool execution started |
| `tool_end` | Agent | Hub → Client | Tool execution completed |
| `tool_progress` | Agent | Hub → Client | Tool still executing |
| `todo_update` | Agent | Hub → Client | TodoWrite tool executed |
| `name_suggestion` | Agent | Hub → Client | AI-suggested conversation name |
| `result` | Agent | Hub → Client | Final result with stats |
| `complete` | Agent | Hub → Client | Stream completed |
| `error` | Agent | Hub → Client | Execution error |
| `conversation_status` | Manager | Hub → Client | Status change (active/idle/completed) |
| `checkpoint_created` | Agent | Hub → Client | File checkpoint saved |
| `permission_mode_changed` | Agent | Hub → Client | Permission mode changed |
| `session_name_update` | Manager | Hub → Client | Session name changed |
| `session_stats_update` | Manager | Hub → Client | Session stats updated |
| `session_pr_update` | Manager | Hub → Client | PR status changed |
| `streaming_warning` | Hub | Hub → Client | Backpressure warning |

### Event Flow Diagram

```mermaid
flowchart LR
    subgraph Agent["Agent Runner (stdout)"]
        A1[assistant_text]
        A2[tool_start]
        A3[tool_end]
        A4[result]
        A5[thinking]
    end

    subgraph Parser["Agent Parser"]
        P[ParseAgentLine]
    end

    subgraph Manager["Agent Manager"]
        M1[handleConversationOutput]
        M2[ConversationEventHandler]
    end

    subgraph Hub["WebSocket Hub"]
        H[Broadcast]
    end

    subgraph Clients["All Clients"]
        C1[Client 1]
        C2[Client 2]
        C3[Client N]
    end

    A1 --> P
    A2 --> P
    A3 --> P
    A4 --> P
    A5 --> P
    P --> M1
    M1 --> M2
    M2 --> H
    H --> C1
    H --> C2
    H --> C3
```

## Frontend Connection

### WebSocket Hook

**File: `src/hooks/useWebSocket.ts`**

```typescript
// URL Construction (Lines 54-60)
const wsUrl = isTauri
  ? `ws://localhost:${port}/ws`
  : process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:9876/ws';

// Auth token appended (Line 351)
const urlWithAuth = `${wsUrl}?token=${authToken}`;
```

### Connection State Machine

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: Connect attempt
    Connecting --> Connected: WebSocket open
    Connecting --> Disconnected: Connection failed
    Connected --> Disconnected: Connection lost
    Disconnected --> Connecting: Auto-reconnect (after delay)
    Connected --> Connected: Message received

    note right of Connecting
        WebSocket upgrade
        Token validation
    end note

    note right of Connected
        Messages flow
        Ping/pong active
    end note

    note right of Disconnected
        Reconnect scheduled
        WEBSOCKET_RECONNECT_DELAY_MS
    end note
```

### Frontend Event Handling

**File: `src/hooks/useWebSocket.ts:104-314`**

```mermaid
flowchart TB
    WS[WebSocket onmessage]
    Parse[JSON.parse]
    Type{Event Type?}

    subgraph TextEvents["Text Events"]
        AT[assistant_text]
        AT --> AppendText[appendStreamingText]
        AT --> ClearThink[clearThinking]
    end

    subgraph ThinkEvents["Thinking Events"]
        TS[thinking_start]
        TD[thinking_delta]
        TH[thinking]
        TS --> SetThink[setThinking true]
        TD --> AppendThink[appendThinkingText]
        TH --> AppendThink
    end

    subgraph ToolEvents["Tool Events"]
        TST[tool_start]
        TEN[tool_end]
        TST --> AddTool[addActiveTool]
        TEN --> CompTool[completeActiveTool]
    end

    subgraph ResultEvents["Result Events"]
        RES[result]
        COM[complete]
        RES --> Finalize[finalizeStreamingMessage]
        COM --> Clear[clearStreamingText]
    end

    WS --> Parse --> Type
    Type -->|assistant_text| TextEvents
    Type -->|thinking_*| ThinkEvents
    Type -->|tool_*| ToolEvents
    Type -->|result/complete| ResultEvents
```

## Backpressure Management

### Three-Level Protection

```mermaid
flowchart TB
    subgraph Level1["Level 1: Hub Broadcast Channel"]
        L1A[1024-message buffer]
        L1B[2-second send timeout]
        L1C[Graceful timeout handling]
    end

    subgraph Level2["Level 2: Client Send Buffer"]
        L2A[256-message per-client buffer]
        L2B[Non-blocking send check]
        L2C[Slow client detection]
    end

    subgraph Level3["Level 3: Client Eviction"]
        L3A[Async eviction goroutine]
        L3B[Connection close]
        L3C[Metrics tracking]
    end

    L1A --> L1B --> L1C
    L1C -->|Buffer OK| L2A
    L1C -->|Timeout| Warning1[Rate-limited warning]
    L2A --> L2B --> L2C
    L2C -->|Buffer OK| Deliver[Deliver message]
    L2C -->|Buffer Full| L3A
    L3A --> L3B --> L3C
```

### Warning Rate Limiting

**File: `backend/server/websocket.go`**

```go
// Backend: max 1 warning per 5 seconds
const warningCooldown = 5 * time.Second

func (h *Hub) emitBackpressureWarning() {
    now := time.Now().Unix()
    last := h.lastWarningTime.Load()
    if now-last < int64(warningCooldown.Seconds()) {
        return // Rate limited
    }
    if h.lastWarningTime.CompareAndSwap(last, now) {
        // Emit warning event
    }
}
```

**File: `src/components/StreamingWarningHandler.tsx:15-22`**

```typescript
// Frontend: max 1 toast per 10 seconds
const TOAST_COOLDOWN_MS = 10000;
let lastToastTime = 0;

function showWarning() {
    const now = Date.now();
    if (now - lastToastTime < TOAST_COOLDOWN_MS) return;
    lastToastTime = now;
    toast.warning('Streaming data may have been lost');
}
```

### Metrics Tracking

**File: `backend/server/websocket.go:59-105`**

```go
type HubMetrics struct {
    messagesDelivered     atomic.Uint64  // Successful transmissions
    messagesDropped       atomic.Uint64  // Clients removed due to slowness
    messagesTimedOut      atomic.Uint64  // Broadcast channel timeouts
    clientsDropped        atomic.Uint64  // Slow client disconnections
    broadcastBackpressure atomic.Uint64  // High buffer utilization events
    peakClients           atomic.Uint64  // Maximum concurrent connections
    currentClients        atomic.Uint64  // Active connections
}
```

## Error Handling

### Connection Error Recovery

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant WS as WebSocket
    participant Hub as Hub

    FE->>WS: Connect
    WS->>Hub: Upgrade request
    Hub-->>WS: Connection established
    WS-->>FE: onopen

    Note over FE,Hub: Normal operation...

    WS-xHub: Connection lost
    WS-->>FE: onclose

    FE->>FE: Schedule reconnect
    Note over FE: Wait RECONNECT_DELAY_MS

    FE->>WS: Reconnect
    WS->>Hub: Upgrade request
    Hub-->>WS: Connection established
    WS-->>FE: onopen

    FE->>FE: Clear reconnect timeout
```

### Client Write Pump

**File: `backend/server/websocket.go:312-351`**

```mermaid
flowchart TB
    Start([Start writePump])
    Wait{Wait on channel}

    subgraph Message["Message Received"]
        M1[Set 10s write deadline]
        M2{Write to WebSocket}
        M3[Continue]
        M4[Close connection]
    end

    subgraph Ticker["Ping Ticker ~54s"]
        T1[Set write deadline]
        T2{Send ping}
        T3[Continue]
        T4[Close connection]
    end

    Start --> Wait
    Wait -->|send channel| M1
    M1 --> M2
    M2 -->|Success| M3 --> Wait
    M2 -->|Error| M4

    Wait -->|ticker| T1
    T1 --> T2
    T2 -->|Success| T3 --> Wait
    T2 -->|Error| T4
```

### Client Read Pump

**File: `backend/server/websocket.go:355-381`**

```go
func (c *Client) readPump() {
    defer func() {
        c.hub.unregister <- c
        c.conn.Close()
    }()

    c.conn.SetReadLimit(512)  // Small limit - only pongs expected
    c.conn.SetReadDeadline(time.Now().Add(pongWait))  // 60 seconds
    c.conn.SetPongHandler(func(string) error {
        c.conn.SetReadDeadline(time.Now().Add(pongWait))
        return nil
    })

    for {
        if _, _, err := c.conn.ReadMessage(); err != nil {
            break  // Connection closed
        }
    }
}
```

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Hub broadcast buffer | 1024 messages | Pre-serialized JSON |
| Client send buffer | 256 messages | Per-client |
| Broadcast timeout | 2 seconds | Before warning |
| Ping interval | ~54 seconds | 90% of pong wait |
| Pong timeout | 60 seconds | Connection health |
| Write deadline | 10 seconds | Per message |
| Warning cooldown (backend) | 5 seconds | Rate limiting |
| Warning cooldown (frontend) | 10 seconds | Toast rate limiting |

## Related Documentation

- [Conversation Architecture Overview](./conversation-architecture.md)
- [Claude SDK Events](./claude-sdk-events.md)
- [Frontend Rendering Pipeline](./frontend-rendering.md)
