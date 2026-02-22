# Agent Runner Protocol

The Go backend communicates with agent-runner processes via JSON messages over **stdin** (backend → agent) and **stdout** (agent → backend). Each message is a single line of JSON.

This protocol defines the contract that any agent-runner implementation must fulfill. The current implementation wraps the Claude Agent SDK, but alternative providers can implement their own agent-runner that speaks this same protocol.

## Starting an Agent Runner

The backend spawns the agent-runner as a child process with these CLI arguments:

| Argument | Description |
|----------|-------------|
| `--model <id>` | Model identifier (e.g., `claude-sonnet-4-6`) |
| `--fallback-model <id>` | Fallback model if primary is unavailable |
| `--max-thinking-tokens <n>` | Extended thinking token budget |
| `--effort <level>` | Reasoning effort: `low`, `medium`, `high`, `max` |
| `--permission-mode <mode>` | Permission mode: `default`, `acceptEdits`, `bypassPermissions`, `plan` |
| `--tool-preset <preset>` | Tool preset: `read-only`, `no-bash`, `safe-edit`, `full` |
| `--max-budget-usd <n>` | Maximum cost in USD |
| `--max-turns <n>` | Maximum conversation turns |
| `--resume <sessionId>` | Resume an existing session |
| `--cwd <path>` | Working directory (session worktree) |
| `--mcp-servers-file <path>` | Path to JSON file with MCP server configs |
| `--system-prompt <text>` | Additional system prompt content |
| `--structured-output <schema>` | JSON schema for structured output |
| `--betas <features>` | Comma-separated beta feature flags |

## Input Messages (stdin → agent-runner)

All messages have a `type` field.

### Core Messages

| Type | Fields | Description |
|------|--------|-------------|
| `message` | `content`, `attachments[]` | Send user text to the agent |
| `stop` | — | Gracefully stop the agent process |
| `interrupt` | — | Cancel the current operation |

### Runtime Configuration

| Type | Fields | Description |
|------|--------|-------------|
| `set_model` | `model` | Change model at runtime |
| `set_permission_mode` | `permissionMode` | Change permission mode |
| `set_max_thinking_tokens` | `maxThinkingTokens` | Change thinking budget |

### Queries

| Type | Fields | Description |
|------|--------|-------------|
| `get_supported_models` | — | Request list of available models |
| `get_supported_commands` | — | Request list of slash commands |
| `get_mcp_status` | — | Request MCP server health |
| `get_account_info` | — | Request provider account info |

### Interactive Responses

| Type | Fields | Description |
|------|--------|-------------|
| `user_question_response` | `questionRequestId`, `answers` | Answer to AskUserQuestion tool |
| `plan_approval_response` | `planApprovalRequestId`, `planApproved`, `planApprovalReason` | Approve/reject a plan |
| `rewind_files` | `checkpointUuid` | Rewind files to a checkpoint |

### MCP Management

| Type | Fields | Description |
|------|--------|-------------|
| `reconnect_mcp_server` | `serverName` | Reconnect a failed MCP server |
| `toggle_mcp_server` | `serverName`, `serverEnabled` | Enable/disable an MCP server |

## Output Events (agent-runner → stdout)

All events have a `type` field.

### Lifecycle

| Type | Key Fields | Description |
|------|-----------|-------------|
| `ready` | `conversationId`, `cwd`, `resuming`, `model`, `provider` | Process initialized and ready |
| `init` | `model`, `tools`, `mcpServers`, `permissionMode`, `budgetConfig` | Full SDK initialization data |
| `complete` | `sessionId` | Session completed |
| `shutdown` | `reason` | Process shutting down |
| `session_started` | `sessionId`, `cwd` | New session started |
| `session_ended` | `sessionId`, `reason` | Session ended |

### Streaming Content

| Type | Key Fields | Description |
|------|-----------|-------------|
| `assistant_text` | `content` | Streamed text chunk |
| `thinking` | `content` | Complete thinking block |
| `thinking_start` | — | Thinking block started |
| `thinking_delta` | `content` | Streaming thinking content |

### Tool Execution

| Type | Key Fields | Description |
|------|-----------|-------------|
| `tool_start` | `id`, `tool`, `params` | Tool execution started |
| `tool_end` | `id`, `tool`, `success`, `summary`, `duration` | Tool execution completed |
| `tool_progress` | `toolUseId`, `toolName`, `elapsedTimeSeconds` | Progress update |

### User Interaction

| Type | Key Fields | Description |
|------|-----------|-------------|
| `user_question_request` | `requestId`, `questions` | Waiting for user input (AskUserQuestion) |
| `plan_approval_request` | `requestId`, `planContent` | Waiting for plan approval (ExitPlanMode) |

### Sub-agents

| Type | Key Fields | Description |
|------|-----------|-------------|
| `subagent_started` | `agentId`, `agentType`, `parentToolUseId` | Sub-agent spawned |
| `subagent_stopped` | `agentId`, `stopHookActive` | Sub-agent finished |
| `subagent_output` | `agentId`, `agentOutput` | Sub-agent result |

### Results

| Type | Key Fields | Description |
|------|-----------|-------------|
| `result` | `success`, `cost`, `turns`, `usage`, `stats` | Turn result (success or error) |
| `turn_complete` | `sessionId` | Single turn finished |
| `context_usage` | `inputTokens`, `outputTokens`, `cacheReadInputTokens` | Per-message token usage |

### State Changes

| Type | Key Fields | Description |
|------|-----------|-------------|
| `model_changed` | `model` | Model successfully changed |
| `permission_mode_changed` | `mode`, `source` | Permission mode changed |
| `checkpoint_created` | `checkpointUuid`, `messageIndex` | File checkpoint created |
| `todo_update` | `todos[]` | Todo list updated |
| `files_rewound` | `checkpointUuid`, `success` | Checkpoint rewind result |

### Errors

| Type | Key Fields | Description |
|------|-----------|-------------|
| `error` | `message` | General error |
| `auth_error` | `message` | Authentication failure (fatal) |
| `command_error` | `command`, `error` | Command execution failed |
| `warning` | `message` | Non-fatal warning |

## Implementing a New Provider

To add support for a new AI provider:

1. Create an agent-runner that accepts the same CLI arguments
2. Read JSON messages from stdin and write JSON events to stdout
3. Emit a `ready` event with `provider: "your-provider-name"` on startup
4. Handle at minimum: `message`, `stop`, `interrupt`, `get_supported_models`
5. Emit at minimum: `ready`, `assistant_text`, `tool_start`, `tool_end`, `result`, `error`
6. Features like extended thinking, plan mode, and sub-agents are optional — the backend checks provider capabilities via `GET /api/provider/capabilities`
