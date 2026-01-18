# Agent Execution & Chat Design

## Overview

Enable conversational agent interactions where users can chat back-and-forth with an AI agent working in an isolated git worktree.

## Architecture

```
┌──────────────┐     HTTP/WS      ┌──────────────┐    stdin/stdout   ┌──────────────┐
│   Frontend   │ ◄──────────────► │  Go Backend  │ ◄───────────────► │ Node Agent   │
│   (Next.js)  │                  │  (existing)  │                   │   Runner     │
└──────────────┘                  └──────────────┘                   └──────────────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │ Git Worktree │
                                  │  (isolated)  │
                                  └──────────────┘
```

**Components:**

1. **Node Agent Runner** - Lightweight Node.js script using `@anthropic-ai/claude-code` SDK. One process per active session. Handles conversation state, tool execution, and streaming.

2. **Go Backend** - Spawns agent processes, pipes user messages to stdin, reads structured events from stdout, broadcasts to frontend via WebSocket.

3. **Frontend** - Chat input sends messages via HTTP. WebSocket receives streaming events. Conversation area shows back-and-forth messages.

## Node Agent Runner

**Location:** `agent-runner/` at project root

**Structure:**
```
agent-runner/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

**Spawned with:**
```bash
node agent-runner/dist/index.js --cwd /path/to/worktree --session-id abc123
```

**stdin protocol (Go → Node):**
```json
{"type": "message", "content": "Add a login button to the header"}
{"type": "stop"}
```

**stdout protocol (Node → Go):**
```json
{"type": "assistant_text", "content": "I'll add a login button..."}
{"type": "tool_use", "tool": "read_file", "params": {"path": "src/App.tsx"}}
{"type": "tool_result", "tool": "read_file", "success": true}
{"type": "user_input_request", "question": "Which auth provider?", "options": ["OAuth", "JWT"]}
{"type": "complete", "summary": "Added login button with OAuth"}
{"type": "error", "message": "Failed to read file"}
```

**Behaviors:**
- Runs in worktree directory (isolated from main repo)
- Maintains conversation history internally
- Streams events as they happen
- Graceful shutdown on `stop` message or SIGTERM
- Passes through Agent SDK's tool execution

## Go Backend Modifications

**process.go - Keep stdin pipe:**
```go
type AgentProcess struct {
    cmd     *exec.Cmd
    stdin   io.WriteCloser  // for sending messages
    stdout  io.ReadCloser
    cancel  context.CancelFunc
}

func (p *AgentProcess) SendMessage(msg string) error {
    event := map[string]string{"type": "message", "content": msg}
    data, _ := json.Marshal(event)
    _, err := p.stdin.Write(append(data, '\n'))
    return err
}
```

**New endpoint:**
```
POST /api/sessions/{id}/message
Body: {"content": "Follow-up message here"}
```

**WebSocket events:**
```json
{"type": "assistant_text", "sessionId": "...", "payload": "I'll add..."}
{"type": "tool_use", "sessionId": "...", "payload": {...}}
{"type": "user_input_request", "sessionId": "...", "payload": {...}}
```

## Frontend Changes

**ChatInput:**
- First message: Creates session + spawns agent
- Subsequent messages: POST to `/api/sessions/{id}/message`
- Disable when agent requests user input (show options instead)

**ConversationArea:**
- Display `user_input_request` as interactive prompts
- Show tool usage inline (collapsible)
- Stream assistant text as it arrives
- Show typing indicator while processing

**useWebSocket - New event handlers:**
```typescript
case 'assistant_text':
  appendToMessage(sessionId, payload.content);
  break;
case 'tool_use':
  addToolUsage(sessionId, payload);
  break;
case 'user_input_request':
  setInputRequest(sessionId, payload);
  break;
case 'complete':
  completeMessage(sessionId);
  break;
```

**appStore - New state:**
- `pendingInputRequest` per session
- `streamingMessage` for in-progress assistant responses
- Actions: `appendToStreamingMessage`, `setInputRequest`, `clearInputRequest`

## Implementation Phases

**Phase 1: Node Agent Runner**
1. Create `agent-runner/` with package.json and TypeScript
2. Implement stdin/stdout protocol
3. Integrate Agent SDK with tool execution
4. Test standalone

**Phase 2: Go Backend Integration**
1. Update process.go to spawn Node runner, keep stdin open
2. Add `SendMessage` method
3. Update parser for new event format
4. Add `POST /sessions/{id}/message` endpoint
5. Test via curl

**Phase 3: Frontend Wiring**
1. Update useWebSocket for new events
2. Add streaming message state
3. Modify ChatInput for follow-ups
4. Add typing indicator and tool usage display
5. Implement user input request UI

**Phase 4: Polish**
1. Error handling and reconnection
2. Session persistence
3. Stop/cancel mid-conversation
4. Loading states and edge cases
