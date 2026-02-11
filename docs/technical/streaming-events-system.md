# Streaming Events System

ChatML uses an event-driven architecture where 47+ event types flow from the agent runner through the Go backend to the frontend. This document catalogs every event, explains the processing pipeline, and describes how events are consumed.

## Event Pipeline Overview

Events travel through four stages:

1. **Agent Runner** — The Node.js process emits events as JSON lines to stdout
2. **Go Backend** — The agent parser reads stdout, deserializes events, and routes them to handlers
3. **WebSocket Hub** — Events are broadcast to all connected clients
4. **Frontend** — The WebSocket hook receives events and dispatches them to Zustand stores

Each event is a JSON object with at minimum a `type` field. The Go backend wraps it in an `Event` envelope with `conversationId` or `sessionId` before broadcasting.

## Complete Event Catalog

### Session Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `session_started` | SDK session initialized | `sessionId`, `source` ("startup", "resume", "clear", "compact"), `cwd` |
| `session_ended` | SDK session completed | `sessionId`, `reason` |
| `session_id_update` | Session ID changed (after compact) | `sessionId` |

The `source` field in `session_started` indicates how the session was created. "startup" means a new session, "resume" means an existing session was restored, "clear" means the session was reset, and "compact" means context compaction created a new session.

### Initialization Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `ready` | Agent runner is initialized and ready for input | — |
| `init` | SDK provides its configuration | `model`, `tools`, `mcpServers`, `slashCommands`, `skills`, `plugins`, `agents`, `permissionMode`, `claudeCodeVersion`, `apiKeySource`, `betas`, `outputStyle`, `sessionId`, `cwd`, `budgetConfig` |

The `init` event is rich in metadata. The frontend uses it to display the model name, available tools, MCP server status, and budget configuration.

### Text Streaming Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `assistant_text` | Claude produces response text | `content` (paragraph-buffered) |
| `thinking_start` | Extended thinking begins | — |
| `thinking_delta` | Thinking text chunk | `content` |
| `thinking` | Complete thinking block | `content` |

Text is buffered at paragraph boundaries (double newlines) before emission, so each `assistant_text` event contains at least one complete paragraph.

### Tool Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `tool_start` | Tool execution begins | `id` (tool_use_id), `tool`, `params` |
| `tool_end` | Tool execution completes | `id`, `tool`, `success`, `summary`, `duration` (ms) |
| `tool_progress` | Long-running tool update | `id`, `toolName`, `elapsedTimeSeconds`, `parentToolUseId` |

The `id` field is the Claude API's `tool_use_id`, which uniquely identifies each tool invocation. The frontend uses this to track tools from start to end.

### Hook Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `hook_pre_tool` | Before tool execution (PreToolUse hook) | `id`, `tool`, `params` |
| `hook_post_tool` | After tool execution (PostToolUse hook) | `id`, `tool`, result |
| `hook_tool_failure` | Tool failed (PostToolUseFailure hook) | `id`, `tool`, error |
| `hook_response` | Hook script executed | `hookName`, `hookEvent`, `stdout`, `stderr`, `exitCode` |

### Completion Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `result` | Agent turn completes | `success`, `subtype`, `cost`, `turns`, `durationMs`, `durationApiMs`, `usage`, `modelUsage`, `stats`, `errors`, `sessionId`, `structuredOutput` |
| `complete` | Stream fully finished | — |

The `result` event is the most data-rich event. It includes:
- **Cost and timing** — USD cost, total duration, API-only duration
- **Token usage** — Input, output, cache read, and cache creation tokens
- **Per-model breakdown** — Usage stats broken down by model
- **Tool statistics** — Total tool calls, calls by type, files read/written, bash commands
- **Structured output** — JSON output if a schema was specified
- **Error details** — Error type and message if the turn failed

### Sub-Agent Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `subagent_started` | Task tool spawns a sub-agent | `agentId`, `agentType`, `parentToolUseId` |
| `subagent_stopped` | Sub-agent completes | `agentId`, `transcriptPath` |

Sub-agents are independent AI agents spawned by the `Task` tool for parallel work. Each has its own ID and type (e.g., "Explore", "Bash", "general-purpose").

### Control Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `permission_mode_changed` | Permission mode updated | `mode` ("default", "plan", "bypassPermissions", etc.) |
| `model_changed` | Model switched | `model` |
| `interrupted` | Agent was interrupted | `isInterrupt` |
| `compact_boundary` | Context was compacted | `trigger` ("manual", "auto"), `preTokens` |

### Checkpoint Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `checkpoint_created` | File state was saved | `checkpointUuid`, `messageIndex`, `isResult` |
| `files_rewound` | Files reverted to checkpoint | `checkpointUuid` |

### Information Query Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `supported_models` | Model list requested | `models` (array of ModelInfo) |
| `supported_commands` | Command list requested | `commands` (array of SlashCommand) |
| `mcp_status` | MCP status requested | `servers` (array of McpServerStatus) |
| `account_info` | Account info requested | `info` (AccountInfo object) |

### Notification Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `agent_notification` | Agent sends a notification | `title`, `message`, `notificationType` |
| `status_update` | Agent status changed | `status` |
| `agent_stop` | Stop hook fired | `stopHookActive` |
| `agent_stderr` | Agent stderr output | `data` |
| `auth_status` | Auth state changed | `isAuthenticating`, `output` |
| `user_question_request` | AskUserQuestion tool invoked | `requestId`, `questions` |

### Metadata Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `name_suggestion` | AI suggests conversation name | `name` |
| `todo_update` | TodoWrite tool executed | `todos` (array of AgentTodoItem) |

### Error Events

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `error` | Unhandled error | `message`, error details |
| `shutdown` | Agent process exiting | `reason` |

### Backend-Generated Events

These events are generated by the Go backend, not the agent runner:

| Event | When Emitted | Key Fields |
|-------|-------------|------------|
| `conversation_status` | Conversation status changed | `status` (active/idle/completed) |
| `session_name_update` | Session name changed | session metadata |
| `session_stats_update` | Session stats updated | stats object |
| `session_pr_update` | PR status changed | PR metadata |
| `streaming_warning` | Backpressure detected | warning message |

## Frontend Event Handling

**File: `src/hooks/useWebSocket.ts`**

The WebSocket hook routes each event type to a specific store action:

### Text Events
- `assistant_text` → `appendStreamingText(conversationId, content)` then `clearThinking(conversationId)`
- The `clearThinking` call is important — it ensures the thinking indicator disappears as soon as actual response text starts arriving

### Thinking Events
- `thinking_start` → `setThinking(conversationId, true)`
- `thinking_delta` → `appendThinkingText(conversationId, content)`
- `thinking` → `appendThinkingText(conversationId, content)`

### Tool Events
- `tool_start` → `addActiveTool(conversationId, {id, tool, params, startTime})`
- `tool_end` → `completeActiveTool(conversationId, {id, success, summary, endTime})`
- `tool_progress` → Updates the tool's `elapsedSeconds` field

### Completion Events
- `result` → `finalizeStreamingMessage(conversationId, text, runSummary, toolUsage, timeline)` — This atomically creates a Message and clears streaming state
- `complete` → `clearStreamingText(conversationId)` — Final cleanup

### Status Events
- `conversation_status` → Updates conversation status in the store
- `permission_mode_changed` → Updates `planModeActive` and `pendingPlanApproval` flags

### User Interaction Events
- `user_question_request` → Stores the pending question for UI display

## Event Processing in the Backend

**File: `backend/agent/parser.go`**

The Go backend parses agent events and performs additional processing:

1. **Parse JSON** — Each stdout line is parsed as an `AgentEvent` struct
2. **Route by type** — Events are routed to the conversation event handler
3. **Side effects** — Some events trigger database operations:
   - `result` → Store the assistant message with run summary
   - `tool_end` → Add tool action to conversation
   - `name_suggestion` → Update conversation name
   - `checkpoint_created` → Store checkpoint metadata
4. **Broadcast** — All events are broadcast via the WebSocket hub

## TypeScript Event Type Constants

**File: `src/lib/types.ts`**

The frontend defines event type constants for type safety:

```typescript
export const AgentEventTypes = {
  READY: 'ready',
  INIT: 'init',
  ASSISTANT_TEXT: 'assistant_text',
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  NAME_SUGGESTION: 'name_suggestion',
  TODO_UPDATE: 'todo_update',
  RESULT: 'result',
  COMPLETE: 'complete',
  ERROR: 'error',
  SHUTDOWN: 'shutdown',
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
  SESSION_ID_UPDATE: 'session_id_update',
  HOOK_PRE_TOOL: 'hook_pre_tool',
  HOOK_POST_TOOL: 'hook_post_tool',
  HOOK_TOOL_FAILURE: 'hook_tool_failure',
  AGENT_NOTIFICATION: 'agent_notification',
  AGENT_STOP: 'agent_stop',
  HOOK_RESPONSE: 'hook_response',
  SUBAGENT_STARTED: 'subagent_started',
  SUBAGENT_STOPPED: 'subagent_stopped',
  COMPACT_BOUNDARY: 'compact_boundary',
  STATUS_UPDATE: 'status_update',
  TOOL_PROGRESS: 'tool_progress',
  AUTH_STATUS: 'auth_status',
  AGENT_STDERR: 'agent_stderr',
  INTERRUPTED: 'interrupted',
  MODEL_CHANGED: 'model_changed',
  PERMISSION_MODE_CHANGED: 'permission_mode_changed',
  SUPPORTED_MODELS: 'supported_models',
  SUPPORTED_COMMANDS: 'supported_commands',
  MCP_STATUS: 'mcp_status',
  ACCOUNT_INFO: 'account_info',
  THINKING: 'thinking',
  THINKING_DELTA: 'thinking_delta',
  THINKING_START: 'thinking_start',
  CHECKPOINT_CREATED: 'checkpoint_created',
  FILES_REWOUND: 'files_rewound',
  USER_QUESTION_REQUEST: 'user_question_request',
} as const;
```

## Related Documentation

- [Claude Agent SDK Integration](./claude-agent-sdk-integration.md)
- [WebSocket Streaming](../architecture/websocket-streaming.md)
- [Frontend State & Rendering](../architecture/frontend-state-and-rendering.md)
