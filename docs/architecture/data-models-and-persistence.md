# Data Models & Persistence

ChatML uses a hierarchical data model persisted in SQLite. This document explains the data hierarchy, each model's structure, the database schema, and the persistence patterns that keep data consistent under concurrent access.

## Data Hierarchy

ChatML organizes data in four levels:

```
Workspace (repository)
  └── Session (git worktree + branch)
       └── Conversation (chat thread)
            └── Message (user/assistant/system)
```

Each level contains the next: a workspace has many sessions, a session has many conversations, a conversation has many messages. This hierarchy mirrors how developers think about work — you have a project (workspace), you work on tasks (sessions), each task involves discussions (conversations), and each discussion has back-and-forth exchanges (messages).

In addition to the main hierarchy, conversations also track tool actions (a summary of tools used) and review comments are attached at the session level.

## Core Data Structures

### Workspace (Repo)

**Go: `backend/models/types.go:5-14` | TypeScript: `src/lib/types.ts:8-17`**

A workspace represents a registered git repository on disk.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Repository name (derived from path) |
| `path` | string | Absolute path on disk |
| `branch` | string | Default branch (e.g., "main") |
| `remote` | string | Git remote name (default: "origin") |
| `branchPrefix` | string | Branch naming strategy: "github", "custom", "none", or "" |
| `customPrefix` | string | Custom prefix value when branchPrefix is "custom" |
| `createdAt` | datetime | When the workspace was added |

The `branchPrefix` field controls how session branches are named. When set to "github", branches are prefixed with the user's GitHub username. When "custom", the `customPrefix` value is used.

### Session

**Go: `backend/models/types.go:17-43` | TypeScript: `src/lib/types.ts:20-47`**

A session is an isolated development context with its own git worktree and branch.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `workspaceId` | string | Parent workspace |
| `name` | string | Display name (auto-named or user-set) |
| `branch` | string | Git branch name |
| `worktreePath` | string | Absolute path to the worktree directory |
| `baseCommitSha` | string | Commit SHA the session was branched from |
| `targetBranch` | string | Per-session target branch override |
| `task` | string | Task description |
| `status` | string | `active`, `idle`, `done`, `error` |
| `agentId` | string | Currently running agent process ID |
| `stats` | object | Additions/deletions count |
| `prStatus` | string | `none`, `open`, `merged`, `closed` |
| `prUrl` | string | GitHub PR URL |
| `prNumber` | int | GitHub PR number |
| `hasMergeConflict` | bool | Whether the PR has merge conflicts |
| `hasCheckFailures` | bool | Whether CI checks are failing |
| `priority` | int | 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low |
| `taskStatus` | string | `backlog`, `in_progress`, `in_review`, `done`, `cancelled` |
| `pinned` | bool | Whether pinned to top of list |
| `archived` | bool | Whether archived |
| `archiveSummary` | string | AI-generated summary at archive time |
| `archiveSummaryStatus` | string | `""`, `generating`, `completed`, `failed` |
| `autoNamed` | bool | Whether auto-named by AI |
| `createdAt` | datetime | Creation time |
| `updatedAt` | datetime | Last update time |

Sessions have two distinct status systems. The `status` field tracks agent execution state (is the agent running?), while `taskStatus` tracks the user's workflow state (what stage is this work in?). These are independent — a session can be `idle` (no agent running) but `in_progress` (the task is being worked on).

### Conversation

**Go: `backend/models/types.go:106-119` | TypeScript: `src/lib/types.ts:50-62`**

A conversation is a chat thread within a session.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `sessionId` | string | Parent session |
| `type` | string | `task`, `review`, `chat` |
| `name` | string | AI-updatable display name |
| `status` | string | `active`, `idle`, `completed` |
| `model` | string | Last-used model |
| `agentSessionId` | string | Claude SDK session ID (for resume) |
| `messages` | array | Message history |
| `messageCount` | int | Total message count (for lazy loading) |
| `toolSummary` | array | Summary of tool actions |
| `createdAt` | datetime | Creation time |
| `updatedAt` | datetime | Last update time |

The `type` field determines the conversation's behavior. Task conversations have full tool access, review conversations focus on code review with comment tools, and chat conversations are for general discussion.

### Message

**Go: `backend/models/types.go:174-187` | TypeScript: `src/lib/types.ts:186-207`**

A message is an individual exchange in a conversation.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `role` | string | `user`, `assistant`, `system` |
| `content` | string | Text content (Markdown) |
| `setupInfo` | object | For system messages: session name, branch, origin |
| `runSummary` | object | For assistant messages: cost, turns, duration, stats |
| `attachments` | array | File/image attachments |
| `toolUsage` | array | Per-message tool usage details |
| `thinkingContent` | string | Extended thinking/reasoning text |
| `durationMs` | int | Turn duration in milliseconds |
| `timeline` | array | Interleaved text/tool ordering |
| `timestamp` | datetime | When the message was created |

The `timeline` field preserves the exact order in which text and tool calls appeared during streaming. Each entry is either `{type: "text", content: "..."}` or `{type: "tool", toolId: "..."}`, allowing the UI to reconstruct the interleaved display.

### RunSummary

**Go: `backend/models/types.go:150-157` | TypeScript: `src/lib/types.ts:107-116`**

Attached to assistant messages at the end of an agent turn.

| Field | Type | Description |
|-------|------|-------------|
| `success` | bool | Whether the turn completed successfully |
| `cost` | float | Cost in USD |
| `turns` | int | Number of agent turns |
| `durationMs` | int | Total duration in milliseconds |
| `stats` | RunStats | Detailed tool statistics |
| `errors` | array | Error details if failed |
| `usage` | TokenUsage | Aggregate token usage |
| `modelUsage` | map | Per-model token/cost breakdown |

### ToolAction

**Go: `backend/models/types.go:209-215` | TypeScript: `src/lib/types.ts:78-83`**

A summary-level record of a tool invocation, stored in the conversation's `toolSummary`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `tool` | string | Tool name (Read, Write, Edit, Bash, etc.) |
| `target` | string | File path or command |
| `success` | bool | Whether the tool succeeded |

### ReviewComment

**Go: `backend/models/types.go:332-347` | TypeScript: `src/lib/types.ts:605-619`**

An inline code review comment attached at the session level.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `sessionId` | string | Parent session |
| `filePath` | string | File the comment is on |
| `lineNumber` | int | Line number |
| `title` | string | Optional comment title |
| `content` | string | Comment text |
| `source` | string | `claude` or `user` |
| `author` | string | Display name |
| `severity` | string | `error`, `warning`, `suggestion`, `info` |
| `createdAt` | datetime | When created |
| `resolved` | bool | Whether resolved |
| `resolvedAt` | datetime | When resolved |
| `resolvedBy` | string | Who resolved it |

### FileTab

**Go: `backend/models/types.go:319-330` | TypeScript: `src/lib/types.ts:558-584`**

An open file tab in the editor, persisted to survive page reloads.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `workspaceId` | string | Parent workspace |
| `sessionId` | string | Parent session (all tabs are session-scoped) |
| `path` | string | File path relative to worktree |
| `viewMode` | string | `file` or `diff` |
| `isPinned` | bool | Prevents auto-closing |
| `position` | int | Tab ordering |
| `openedAt` | datetime | When opened |
| `lastAccessedAt` | datetime | For LRU eviction |

## SQLite Schema

### Database Configuration

**File: `backend/store/sqlite.go:30-70`**

ChatML uses SQLite with these settings:
- **WAL mode** — Write-Ahead Logging enables concurrent readers while a writer is active
- **Busy timeout** — 5-second timeout for lock contention
- **Foreign keys** — Enabled for referential integrity
- **Connection pool** — 10 max open connections, 5 idle

### Table Definitions

**Sessions table:**
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT '',
    worktree_path TEXT NOT NULL DEFAULT '',
    base_commit_sha TEXT NOT NULL DEFAULT '',
    target_branch TEXT NOT NULL DEFAULT '',
    task TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    agent_id TEXT NOT NULL DEFAULT '',
    stats TEXT DEFAULT NULL,
    pr_status TEXT NOT NULL DEFAULT 'none',
    pr_url TEXT NOT NULL DEFAULT '',
    pr_number INTEGER NOT NULL DEFAULT 0,
    has_merge_conflict INTEGER NOT NULL DEFAULT 0,
    has_check_failures INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    task_status TEXT NOT NULL DEFAULT 'backlog',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archive_summary TEXT NOT NULL DEFAULT '',
    archive_summary_status TEXT NOT NULL DEFAULT '',
    auto_named INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES repos(id) ON DELETE CASCADE
);
```

**Conversations table:**
```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'task',
    name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    model TEXT NOT NULL DEFAULT '',
    agent_session_id TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_conversations_session_id ON conversations(session_id);
```

**Messages table:**
```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    setup_info TEXT DEFAULT NULL,
    run_summary TEXT DEFAULT NULL,
    attachments TEXT DEFAULT NULL,
    tool_usage TEXT DEFAULT NULL,
    thinking_content TEXT DEFAULT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    timeline TEXT DEFAULT NULL,
    timestamp DATETIME NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
```

**Tool Actions table:**
```sql
CREATE TABLE tool_actions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    success INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX idx_tool_actions_conversation_id ON tool_actions(conversation_id);
```

**Review Comments table:**
```sql
CREATE TABLE review_comments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    author TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_at DATETIME,
    resolved_by TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

## Persistence Patterns

### Position-Based Ordering

Messages use a `position` column rather than relying on timestamps for ordering. When a new message is inserted, its position is calculated as one more than the current maximum:

```sql
INSERT INTO messages (..., position)
SELECT ..., COALESCE(MAX(position), -1) + 1
FROM messages WHERE conversation_id = ?
```

This ensures correct ordering even when multiple messages have identical timestamps.

### JSON Serialization

Complex nested objects (setupInfo, runSummary, attachments, toolUsage, timeline) are stored as JSON text in SQLite. On read, they're deserialized back into Go structs or TypeScript interfaces.

### Batch Loading (N+1 Prevention)

When loading conversations for multiple sessions, the store uses a 3-query batch pattern instead of N+1 individual queries:

1. **Query 1**: All conversations for all requested session IDs
2. **Query 2**: All messages for all those conversation IDs
3. **Query 3**: All tool actions for all those conversation IDs

The results are assembled in memory, matching messages and tool actions to their parent conversations via maps.

### Retry with Exponential Backoff

SQLite can return busy errors under concurrent access. The store wraps all write operations in a retry mechanism:

- **Max retries**: 3
- **Base delay**: 10ms
- **Max delay**: 100ms
- **Strategy**: Exponential backoff for SQLITE_BUSY errors

### Cascade Deletes

Foreign keys with `ON DELETE CASCADE` ensure that deleting a workspace removes all its sessions, which removes all their conversations, messages, tool actions, and review comments.

## Data Lifecycle

A typical data lifecycle:

1. **Workspace created** — User adds a repository
2. **Session created** — User starts a new task, worktree and branch are created
3. **Conversation created** — First message triggers conversation creation
4. **Messages flow** — User and assistant messages are stored with position ordering
5. **Tools tracked** — Each tool invocation is recorded in tool_actions
6. **Streaming snapshots** — Periodic snapshots of streaming state for recovery
7. **Finalization** — Agent turn completes, result message stored with RunSummary
8. **Archive** — User archives completed session, AI generates summary
9. **Cleanup** — Session deletion removes worktree, branch, and all associated data

## Related Documentation

- [Polyglot Architecture](./polyglot-architecture.md)
- [Frontend State & Rendering](./frontend-state-and-rendering.md)
- [Session Lifecycle Management](../technical/session-lifecycle-management.md)
