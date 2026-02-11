# Code Review Workflow

ChatML provides a structured code review workflow where Claude examines session changes and provides feedback through inline comments with severity levels and resolution tracking.

## Starting a Review

Review conversations are created within a session. When you create a conversation with type `review`, the AI agent focuses on analyzing the code changes in that session's worktree.

The agent has access to:
- The workspace diff via the `get_workspace_diff` MCP tool
- File contents via Read/Glob/Grep tools
- The review prompt configured in settings

### Review Prompts

Review behavior is customized through review prompts at two levels:
- **Global** — `GET/PUT /api/settings/review-prompts` (applies to all workspaces)
- **Per-workspace** — `GET/PUT /api/repos/{id}/settings/review-prompts` (overrides global)

## Inline Comments

### Creating Comments

Comments are attached to specific file lines within a session:

```typescript
interface ReviewComment {
  id: string;
  sessionId: string;
  filePath: string;
  lineNumber: number;
  title?: string;
  content: string;
  source: 'claude' | 'user';
  author: string;
  severity?: 'error' | 'warning' | 'suggestion' | 'info';
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}
```

Comments can come from two sources:
- **Claude** (`source: 'claude'`) — Created by the AI during review via the `add_review_comment` MCP tool
- **User** (`source: 'user'`) — Created manually by the developer

### Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| `error` | Bug, security issue, or correctness problem | Must fix before merging |
| `warning` | Potential issue or anti-pattern | Should fix |
| `suggestion` | Improvement idea | Optional |
| `info` | Informational note | No action needed |

### Resolution

Comments can be resolved with attribution:
- `PATCH /api/repos/{id}/sessions/{sessionId}/comments/{commentId}` with `resolved: true` and `resolvedBy`
- Resolution time is automatically recorded

## Comment API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/repos/{id}/sessions/{sessionId}/comments` | List all comments for a session |
| `POST` | `/api/repos/{id}/sessions/{sessionId}/comments` | Create a new comment |
| `GET` | `/api/repos/{id}/sessions/{sessionId}/comments/stats` | Get per-file comment statistics |
| `PATCH` | `/api/repos/{id}/sessions/{sessionId}/comments/{commentId}` | Update (resolve/unresolve) |
| `DELETE` | `/api/repos/{id}/sessions/{sessionId}/comments/{commentId}` | Delete a comment |

Rate limit: 60 comments per minute.

### Comment Statistics

The stats endpoint returns per-file counts:

```typescript
interface CommentStats {
  filePath: string;
  total: number;
  unresolved: number;
}
```

## MCP Tools for Review

The agent's built-in MCP server provides review-specific tools:

| Tool | Parameters | Purpose |
|------|-----------|---------|
| `add_review_comment` | `file`, `line`, `content`, `severity` | Add an inline comment |
| `list_review_comments` | `file?` | List comments, optionally filtered by file |
| `get_review_comment_stats` | — | Get per-file statistics |
| `get_workspace_diff` | `detailed: boolean` | View the session's changes |

## Related Documentation

- [Pull Request Workflow](./pull-request-workflow.md)
- [Session Lifecycle Management](../technical/session-lifecycle-management.md)
