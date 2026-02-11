# Pull Request Workflow

ChatML integrates with GitHub for pull request creation, tracking, and management directly from sessions.

## Creating a PR

### From a Session

1. **Generate description** — `GET /api/repos/{id}/sessions/{sessionId}/pr/generate` asks Claude to generate a title and body based on the session's changes
2. **Create PR** — `POST /api/repos/{id}/sessions/{sessionId}/pr/create` pushes the branch and creates a GitHub PR
3. **Update session** — The session's `prStatus`, `prUrl`, and `prNumber` are updated

### PR Description Generation

Claude generates PR descriptions by examining:
- The git diff between the session branch and target branch
- Commit messages on the session branch
- The PR template (global or per-workspace)

### PR Templates

PR templates can be configured at two levels:
- **Global** — `GET/PUT /api/settings/pr-template`
- **Per-workspace** — `GET/PUT /api/repos/{id}/settings/pr-template`

## PR Status Tracking

### Status Polling

A background `PRWatcher` polls GitHub for PR status updates every 30 seconds. Tracked fields include:

| Field | Description |
|-------|-------------|
| `prStatus` | `none`, `open`, `merged`, `closed` |
| `prUrl` | GitHub PR URL |
| `prNumber` | PR number |
| `hasMergeConflict` | Whether the PR has merge conflicts |
| `hasCheckFailures` | Whether CI checks are failing |

### Status Events

When PR status changes, the backend broadcasts a `session_pr_update` event via WebSocket, so the frontend updates in real-time.

## Branch Sync

Sessions can fall behind the target branch as other PRs get merged. The sync system detects and resolves this.

### Detecting Drift

`GET /api/repos/{id}/sessions/{sessionId}/branch-sync` returns:

```typescript
interface BranchSyncStatus {
  behindBy: number;          // Commits behind target
  commits: SyncCommit[];     // The commits we're behind
  baseBranch: string;        // e.g., "origin/main"
  lastChecked: string;       // ISO timestamp
}
```

### Syncing

`POST /api/repos/{id}/sessions/{sessionId}/branch-sync` with operation type:

| Operation | Description |
|-----------|-------------|
| `rebase` | Rebase session branch onto target (linear history) |
| `merge` | Merge target into session branch (merge commit) |

### Abort

If a sync operation results in conflicts: `POST /api/repos/{id}/sessions/{sessionId}/branch-sync/abort` cancels the operation.

### Sync Result

```typescript
interface BranchSyncResult {
  success: boolean;
  newBaseSha?: string;         // New base after sync
  conflictFiles?: string[];    // Files with conflicts
  errorMessage?: string;
}
```

## Branch Management

### Branch Listing

`GET /api/repos/{id}/branches` returns all branches with metadata:

```typescript
interface BranchInfo {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  lastCommitSHA: string;
  lastCommitDate: string;
  lastCommitSubject: string;
  lastAuthor: string;
  aheadMain: number;
  behindMain: number;
  prefix: string;            // e.g., "feature", "fix"
}
```

Branches are returned in two groups:
- **Session branches** — Branches linked to existing sessions
- **Other branches** — All other branches

### Branch Cleanup

For stale branch management:
- `POST /api/repos/{id}/branches/analyze-cleanup` — Analyze which branches can be cleaned up
- `POST /api/repos/{id}/branches/cleanup` — Execute the cleanup (delete stale branches)

## Related Documentation

- [Code Review Workflow](./code-review-workflow.md)
- [CI/CD Monitoring](./ci-cd-monitoring.md)
- [Git Worktrees Explained](../technical/git-worktrees-explained.md)
