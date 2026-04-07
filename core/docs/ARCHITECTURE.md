# Core Engine Architecture

> Native Go agentic loop — replaces the Node.js agent-runner for full Claude Code parity.

## Package Structure

```
core/
├── agent/          Process options, conversation backend interface
├── cmd/nativeloop/ BubbleTea TUI (20+ slash commands, doctor diagnostics)
├── context/        Context management (compaction, micro-compact, delta tracking, restoration)
├── docs/           Architecture and roadmap documentation
├── hook/           Hook engine (30+ events, matchers, async, HTTP, multi-source config)
├── loop/           Main agentic loop (runner, factory, events, transcript persistence)
├── mcp/            MCP client (stdio transport, JSON-RPC 2.0, tool proxying, config)
├── paths/          Platform-specific paths (managed settings, user/project dirs)
├── permission/     Permission engine (7 modes, multi-source rules, bash AST, denial tracking)
├── prompt/         System prompt builder (parallel I/O, CLAUDE.md, multi-section)
├── provider/       LLM providers (Anthropic, OpenAI, Bedrock), streaming, cost, retry, cache detection
├── sandbox/        OS-level sandboxing (macOS Seatbelt profiles)
├── skills/         Skill catalog (bundled/user/project, YAML frontmatter, 6 bundled skills)
├── task/           Task manager (goroutine-based background tasks, blocking relationships)
└── tool/           Tool system (registry, executor, read tracker, result persister)
    └── builtin/    27 built-in tools
```

## Tool Inventory (27 tools)

### Always Loaded (15)
| Tool | Package | Concurrent | Description |
|------|---------|------------|-------------|
| Bash | builtin | No | Shell command execution with AST security |
| Read | builtin | Yes | File reading with line numbers |
| Write | builtin | No | File creation (read-before-write enforced) |
| Edit | builtin | No | File editing (read-before-edit enforced) |
| Glob | builtin | Yes | File pattern matching |
| Grep | builtin | Yes | Ripgrep-based content search |
| NotebookEdit | builtin | No | Jupyter notebook cell editing |
| WebFetch | builtin | Yes | URL fetching with HTML→markdown conversion |
| WebSearch | builtin | Yes | Brave Search API integration |
| TodoWrite | builtin | No | Task list management (v1) |
| AskUserQuestion | builtin | No | User interaction prompts |
| EnterPlanMode | builtin | No | Switch to planning mode |
| ExitPlanMode | builtin | No | Exit planning mode |
| Agent | builtin | No | Sub-agent spawning (fork mode, background, worktree) |
| ToolSearch | builtin | Yes | Deferred tool discovery |

### Deferred (12, discovered via ToolSearch)
| Tool | Package | Description |
|------|---------|-------------|
| EnterWorktree | builtin | Git worktree isolation |
| ExitWorktree | builtin | Exit worktree |
| Skill | builtin | Execute skills (/commit, /review, etc.) |
| TaskCreate | builtin | Create background task |
| TaskGet | builtin | Get task details |
| TaskUpdate | builtin | Update task fields |
| TaskList | builtin | List all tasks |
| TaskStop | builtin | Stop running task |
| TaskOutput | builtin | Get task output (blocking/non-blocking) |
| CronCreate | builtin | Schedule recurring cron job |
| CronList | builtin | List cron jobs |
| CronDelete | builtin | Delete cron job |

### MCP Proxy (unlimited)
MCP tools from connected servers are registered as `mcp__{server}__{tool}`.

## Execution Flow

```
User Message
  ↓
Runner.executeTurn()
  ↓
Hook: UserPromptSubmit
  ↓
System Prompt Builder (parallel I/O: CLAUDE.md + memory)
  ↓
Context Check → Auto-compact if needed → Post-compact restoration
  ↓
Provider.StreamChat() (with retry, fallback, cache break detection)
  ↓
Stream Processing (text deltas, thinking, tool_use blocks)
  ↓
Tool Execution:
  ├── Concurrent batch (Read, Glob, Grep, WebFetch, etc.)
  └── Serial batch (Write, Edit, Bash, Agent, etc.)
       ├── Hook: PreToolUse (can deny, modify input)
       ├── Permission Check (7 modes, multi-source rules, bash AST)
       ├── Tool.Execute()
       ├── Hook: PostToolUse / PostToolUseFailure
       └── Transcript persistence
  ↓
Loop until no tool calls or max turns
  ↓
Hook: SessionEnd
```

## Permission Flow

```
Tool Call
  ↓
Plan mode gate (deny Write/Edit/Bash/NotebookEdit)
  ↓
Safety checks (dangerous paths/commands via bash AST)
  ↓
Bypass mode → Allow (except safety)
  ↓
Read-only tools → Always Allow
  ↓
First-party MCP (mcp__chatml__*) → Always Allow
  ↓
Session approval cache → Allow/Deny
  ↓
Persistent rules (deny > ask > allow, multi-source)
  ↓
Dangerous command check (bash AST, fail-closed)
  ↓
AcceptEdits mode → Allow Write/Edit within workdir
  ↓
DontAsk mode → Deny
  ↓
Default → NeedApproval
```

## Key Design Decisions

1. **Pure Go, no CGO** — bash AST parser is pure Go (no tree-sitter C dependency), sandbox uses `sandbox-exec` subprocess
2. **Goroutine-per-agent** — sub-agents and background tasks are goroutines with `context.Context` cancellation
3. **Channel-based streaming** — `Runner.output chan string` emits JSON events matching agent-runner protocol
4. **Fork mode for cache sharing** — forked agents deep-copy parent messages for byte-identical API prefixes
5. **Fail-closed security** — bash AST rejects unrecognized constructs, sandbox denies by default
6. **Multi-source configuration** — rules, hooks, and settings merge from managed > user > project > local
7. **Deferred tool loading** — 12 tools are only loaded when the LLM uses ToolSearch, saving system prompt tokens
