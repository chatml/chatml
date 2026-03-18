# Conversation Architecture Overview

This document provides a comprehensive overview of the Chat/Conversation feature architecture in ChatML, covering the full stack from frontend rendering to backend persistence.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Component Overview](#component-overview)
3. [Data Flow](#data-flow)
4. [Key Files Reference](#key-files-reference)

## High-Level Architecture

ChatML uses a polyglot architecture with four primary components working together to deliver real-time AI conversations:

```mermaid
graph TB
    subgraph Frontend["Frontend (Next.js 16 / React 19)"]
        UI[Conversation UI]
        Store[Zustand Stores]
        WS[WebSocket Hook]
    end

    subgraph Backend["Backend (Go 1.25)"]
        API[REST API]
        Hub[WebSocket Hub]
        Manager[Agent Manager]
        SQLite[(SQLite DB)]
    end

    subgraph AgentRunner["Agent Runner (Node.js)"]
        SDK[Claude Agent SDK]
        MCP[MCP Server]
        Hooks[Hook System]
    end

    subgraph External["External Services"]
        Claude[Claude API]
        Linear[Linear API]
    end

    UI --> Store
    Store <--> WS
    WS <-->|WebSocket| Hub
    UI -->|HTTP| API
    API --> Manager
    API --> SQLite
    Manager <-->|stdio| SDK
    Hub --> Manager
    SDK --> Claude
    MCP --> Linear
    SDK --> MCP
    Hooks --> SDK
```

## Component Overview

### Frontend Layer

| Component | File | Purpose |
|-----------|------|---------|
| ConversationArea | `src/components/ConversationArea.tsx` | Main chat container, message rendering, search |
| StreamingMessage | `src/components/StreamingMessage.tsx` | Real-time streaming content display |
| MessageBlock | `src/components/ConversationArea.tsx:976` | Individual message rendering |
| appStore | `src/stores/appStore.ts` | Zustand state management |
| useWebSocket | `src/hooks/useWebSocket.ts` | WebSocket connection and event handling |

### Backend Layer

| Component | File | Purpose |
|-----------|------|---------|
| Handlers | `backend/server/handlers.go` | REST API endpoints |
| WebSocket Hub | `backend/server/websocket.go` | Real-time event broadcasting |
| Agent Manager | `backend/agent/manager.go` | Agent process lifecycle |
| SQLite Store | `backend/store/sqlite.go` | Data persistence |
| Event Parser | `backend/agent/parser.go` | Agent event parsing |

### Agent Runner Layer

| Component | File | Purpose |
|-----------|------|---------|
| Main Entry | `agent-runner/src/index.ts` | SDK integration and event emission |
| MCP Server | `agent-runner/src/mcp/server.ts` | Custom tool definitions |
| Context | `agent-runner/src/mcp/context.ts` | Workspace and git state |

## Data Flow

### Complete Request-Response Flow

```mermaid
sequenceDiagram
    participant User
    participant UI as Frontend UI
    participant Store as Zustand Store
    participant WS as WebSocket
    participant API as Go Backend
    participant Hub as WS Hub
    participant Mgr as Agent Manager
    participant Agent as Agent Runner
    participant Claude as Claude API

    User->>UI: Type message
    UI->>API: POST /conversations/{id}/messages
    API->>Mgr: SendConversationMessage()
    Mgr->>Agent: Write to stdin (JSON)
    Agent->>Claude: SDK query()

    loop Streaming Response
        Claude-->>Agent: Assistant text chunks
        Agent-->>Mgr: stdout: {"type":"assistant_text",...}
        Mgr-->>Hub: Broadcast event
        Hub-->>WS: Send to all clients
        WS-->>Store: appendStreamingText()
        Store-->>UI: Re-render StreamingMessage
    end

    Claude-->>Agent: Result message
    Agent-->>Mgr: stdout: {"type":"result",...}
    Mgr->>API: Store message to DB
    Mgr-->>Hub: Broadcast result
    Hub-->>WS: Send result event
    WS-->>Store: finalizeStreamingMessage()
    Store-->>UI: Render final MessageBlock
```

### Tool Execution Flow

```mermaid
sequenceDiagram
    participant Claude as Claude API
    participant Agent as Agent Runner
    participant Mgr as Agent Manager
    participant DB as SQLite
    participant Hub as WS Hub
    participant UI as Frontend

    Claude->>Agent: Tool use request
    Agent->>Agent: PreToolUse hook
    Agent-->>Mgr: {"type":"tool_start", "tool":"Read",...}
    Mgr-->>Hub: Broadcast tool_start
    Hub-->>UI: addActiveTool()

    Agent->>Agent: Execute tool
    Agent->>Agent: PostToolUse hook

    Agent-->>Mgr: {"type":"tool_end", "success":true,...}
    Mgr->>DB: AddToolActionToConversation()
    Mgr-->>Hub: Broadcast tool_end
    Hub-->>UI: completeActiveTool()
```

## Key Files Reference

### Frontend

```
src/
├── components/
│   ├── ConversationArea.tsx     # Main conversation view
│   ├── StreamingMessage.tsx     # Real-time streaming display
│   ├── ToolUsageBlock.tsx       # Tool execution display
│   ├── ToolUsageHistory.tsx     # Tool history list
│   └── ConversationTabs.tsx     # Tab management
├── stores/
│   ├── appStore.ts              # Main Zustand store
│   └── selectors.ts             # Optimized selectors
├── hooks/
│   └── useWebSocket.ts          # WebSocket connection
└── lib/
    └── types.ts                 # TypeScript definitions
```

### Backend

```
backend/
├── server/
│   ├── router.go                # API route definitions
│   ├── handlers.go              # Request handlers
│   └── websocket.go             # WebSocket hub
├── agent/
│   ├── manager.go               # Agent lifecycle
│   ├── process.go               # Process spawning
│   └── parser.go                # Event parsing
├── store/
│   └── sqlite.go                # SQLite persistence
└── models/
    └── types.go                 # Data structures
```

### Agent Runner

```
agent-runner/
├── src/
│   ├── index.ts                 # Main entry, SDK integration
│   └── mcp/
│       ├── server.ts            # MCP server definition
│       ├── context.ts           # Workspace context
│       └── tools/
│           ├── linear.ts        # Linear integration
│           └── comments.ts      # Review comments
└── package.json
```

## Related Documentation

- [Data Models & Persistence](./data-models-persistence.md)
- [WebSocket Streaming](./websocket-streaming.md)
- [Claude SDK Events](./claude-sdk-events.md)
- [Frontend Rendering Pipeline](./frontend-rendering.md)
- [Session Management](./session-management.md)
