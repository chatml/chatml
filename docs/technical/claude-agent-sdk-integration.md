# Claude Agent SDK Integration

ChatML integrates the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) through a Node.js process called the agent runner. Each conversation gets its own process, providing complete isolation. This document covers the SDK integration, event pipeline, hook system, and runtime controls.

## Why the Claude Agent SDK?

The Claude Agent SDK (also known as the Claude Code SDK) provides a high-level interface for building AI agents. Rather than making raw API calls and managing tool execution loops manually, the SDK handles:

- Tool execution with configurable presets
- Session management with resume and fork capabilities
- MCP (Model Context Protocol) server integration
- File checkpointing for undo/redo
- Extended thinking with configurable token budgets
- Automatic context compaction when the window fills up
- Permission modes for controlling tool access

ChatML wraps the SDK rather than calling the Claude API directly because the SDK handles the complex agent loop (user message → Claude response → tool execution → result → next message) automatically.

## Process Architecture

**File: `agent-runner/src/index.ts`**

Each conversation gets its own Node.js process. The Go backend spawns the process with CLI arguments:

```
node agent-runner/dist/index.js \
  --cwd /path/to/worktree \
  --conversation-id conv_123 \
  --permission-mode bypassPermissions \
  --tool-preset full \
  --enable-checkpointing \
  --max-budget-usd 10.0 \
  --max-turns 100 \
  --model claude-sonnet-4-20250514
```

### CLI Arguments

| Argument | Purpose | Default |
|----------|---------|---------|
| `--cwd` | Working directory (worktree path) | `process.cwd()` |
| `--conversation-id` | Conversation identifier | `"default"` |
| `--resume` | SDK session ID to resume from | — |
| `--fork` | Fork the resumed session | — |
| `--linear-issue` | Linear issue ID (e.g., "CHA-123") | — |
| `--tool-preset` | Tool permission level | `"full"` |
| `--enable-checkpointing` | Enable file checkpoints | false |
| `--max-budget-usd` | Cost limit in USD | — |
| `--max-turns` | Turn limit | — |
| `--max-thinking-tokens` | Extended thinking budget | — |
| `--structured-output` | JSON schema for output | — |
| `--setting-sources` | Settings to load | — |
| `--betas` | Beta features to enable | — |
| `--model` | Claude model to use | — |
| `--fallback-model` | Fallback model | — |
| `--permission-mode` | Permission mode | `"bypassPermissions"` |
| `--mcp-servers-file` | Path to MCP server configs | — |
| `--instructions-file` | Additional system prompt | — |
| `--target-branch` | Base branch for diffs | — |
| `--sdk-debug` | Enable SDK debug logging | false |

### Tool Presets

The agent runner supports four tool access levels:

| Preset | Allowed Tools | Use Case |
|--------|--------------|----------|
| `full` | All tools | Normal coding tasks |
| `read-only` | Read, Glob, Grep, WebFetch, WebSearch | Review-only analysis |
| `no-bash` | All except Bash | When shell access is dangerous |
| `safe-edit` | Read, Glob, Grep, Edit, WebFetch, WebSearch | Edit files but no create/delete |

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Normal permission checking |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | Skip all permission prompts (ChatML's default) |
| `plan` | Read-only planning mode |
| `dontAsk` | Never prompt for permissions |

ChatML defaults to `bypassPermissions` because the user has already consented to AI modifications within the session's isolated worktree.

## Event Emission

The agent runner communicates with the Go backend via JSON lines on stdout. Every event is emitted through a single function:

```typescript
function emit(event: OutputEvent): void {
  console.log(JSON.stringify(event));
}
```

The Go backend reads these lines, parses the JSON, and broadcasts them via the WebSocket hub.

### Text Streaming

Claude's text responses are streamed in real-time. The agent runner buffers text and emits on paragraph boundaries (double newlines) for smoother rendering:

```typescript
let blockBuffer = "";

function processTextChunk(text: string): void {
  blockBuffer += text;
  const blocks = blockBuffer.split("\n\n");
  blockBuffer = blocks.pop() || "";
  for (const block of blocks) {
    if (block.trim()) {
      emit({ type: "assistant_text", content: block + "\n\n" });
    }
  }
}

function flushBlockBuffer(): void {
  if (blockBuffer.trim()) {
    emit({ type: "assistant_text", content: blockBuffer });
    blockBuffer = "";
  }
}
```

This paragraph-based buffering prevents the UI from re-rendering on every single character while keeping latency low.

## Hook System

The agent runner registers 9 hooks with the SDK to intercept and report on operations:

### PreToolUse

Fires before every tool execution. The agent emits `hook_pre_tool` and `tool_start` events:

```typescript
emit({
  type: "tool_start",
  id: hookInput.tool_use_id,
  tool: hookInput.tool_name,
  params: hookInput.tool_input,
});
```

### PostToolUse

Fires after successful tool execution. Emits `hook_post_tool` and `tool_end`:

```typescript
const duration = trackToolEnd(hookInput.tool_use_id);
emit({
  type: "tool_end",
  id: hookInput.tool_use_id,
  tool: hookInput.tool_name,
  success: true,
  summary: extractSummary(hookInput.tool_result),
  duration: duration,
});
```

### PostToolUseFailure

Fires when a tool fails. Similar to PostToolUse but with `success: false`.

### Notification

Fires for agent notifications (e.g., requesting input). Emits `agent_notification`.

### SessionStart

Fires when the SDK initializes or resumes a session. Records the session ID and source:

```typescript
emit({
  type: "session_started",
  sessionId: hookInput.session_id,
  source: hookInput.source,  // "startup" | "resume" | "clear" | "compact"
  cwd: hookInput.cwd,
});
```

### SessionEnd

Fires when the session ends. Emits `session_ended` with the reason.

### Stop

Fires when the agent receives a stop signal. Handles graceful shutdown.

### SubagentStart / SubagentStop

Fires when the agent spawns or completes sub-agents via the `Task` tool. Tracks sub-agent lifecycle.

## Run Statistics

The agent runner tracks detailed statistics for each agent turn:

```typescript
interface RunStats {
  toolCalls: number;           // Total tool invocations
  toolsByType: Record<string, number>; // Count per tool type
  subAgents: number;           // Sub-agents spawned
  filesRead: number;           // Files read
  filesWritten: number;        // Files written or edited
  bashCommands: number;        // Shell commands run
  webSearches: number;         // Web searches performed
  totalToolDurationMs: number; // Total time spent in tools
}
```

Tool timing is tracked via a `Map<string, {tool, startTime}>` that records when each tool starts and calculates duration on completion.

## MCP Integration

**Files: `agent-runner/src/mcp/server.ts`, `agent-runner/src/mcp/context.ts`**

The agent runner hosts a built-in MCP server named `chatml` that provides workspace-aware tools:

| Tool | Purpose |
|------|---------|
| `get_session_status` | Returns current session info, git state, Linear issue |
| `get_workspace_diff` | Returns `git diff` from base branch |
| `get_recent_activity` | Returns recent commits (`git log`) |
| `add_review_comment` | Adds an inline code review comment |
| `list_review_comments` | Lists review comments, optionally filtered by file |
| `get_review_comment_stats` | Returns per-file comment statistics |

### Workspace Context

The `WorkspaceContext` class provides git state and Linear issue information:

```typescript
class WorkspaceContext {
  readonly cwd: string;          // Worktree path
  readonly workspaceId: string;
  readonly sessionId: string;

  get gitState() {
    return {
      branch: string,           // Current branch
      baseBranch: string,       // e.g., "origin/main"
      uncommittedChanges: bool,
      aheadBy: number,
      behindBy: number
    };
  }
}
```

### Linear Issue Resolution

The context resolves Linear issues in priority order:
1. **CLI argument** — `--linear-issue CHA-123`
2. **Branch name** — Pattern match `LIN-123` in branch name
3. **Recent commits** — Pattern match `[A-Z]+-\d+` in last 5 commits

### User MCP Servers

In addition to the built-in `chatml` server, users can configure custom MCP servers per workspace. The Go backend writes server configs to a temporary JSON file and passes its path via `--mcp-servers-file`.

## Input Protocol

The Go backend sends messages to the agent runner via stdin JSON lines:

| Type | Fields | Purpose |
|------|--------|---------|
| `message` | `content`, `attachments` | User message |
| `stop` | — | Request graceful stop |
| `interrupt` | — | Interrupt current operation |
| `set_model` | `model` | Switch Claude model |
| `set_permission_mode` | `permissionMode` | Change permission mode |
| `rewind_files` | `checkpointUuid` | Revert to checkpoint |
| `user_question_response` | `questionRequestId`, `answers` | Answer AskUserQuestion |
| `plan_approval_response` | `planApprovalRequestId`, `planApproved` | Approve/reject plan |
| `get_supported_models` | — | Query available models |
| `get_supported_commands` | — | Query slash commands |
| `get_mcp_status` | — | Query MCP server status |
| `get_account_info` | — | Query account details |

## Graceful Shutdown

When the agent runner receives SIGTERM or SIGINT:

1. Set `isShuttingDown = true` to prevent new operations
2. Abort the current SDK query via `abortController.abort()`
3. Interrupt the query via `queryRef.interrupt()`
4. Close the readline interface
5. Emit a `shutdown` event with the reason
6. Exit the process

The Go backend sends a `stop` message first and waits up to 5 seconds for graceful exit before force-killing the process.

## Related Documentation

- [Streaming Events System](./streaming-events-system.md)
- [Session Lifecycle Management](./session-lifecycle-management.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
