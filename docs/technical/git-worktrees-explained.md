# Git Worktrees Explained

Git worktrees are the core isolation mechanism in ChatML. They solve a fundamental problem: how do you run multiple AI agents working on different tasks in the same repository without them interfering with each other? This document explains the problem, the solution, and ChatML's implementation.

## The Problem

Traditional git workflows use a single working directory per repository. If you want to work on two tasks simultaneously, you either:

1. **Stash and switch branches** — Tedious, error-prone, and impossible when both tasks need to run build processes
2. **Clone the repository twice** — Wastes disk space (full history duplicated) and creates git remote management complexity
3. **Use separate branches but one directory** — Impossible. Git can only have one branch checked out per working directory.

For AI-assisted development, this problem is acute. You might want one agent refactoring the authentication system while another adds a new API endpoint. These tasks modify different files but exist in the same repository. Without isolation, they'd overwrite each other's changes.

## The Solution: Git Worktrees

Git worktrees (`git worktree add`) create additional working directories that share the same `.git` repository. Each worktree has its own checked-out branch and its own working copy of the files, but they all share the same commit history, objects, and refs.

```
Repository (.git)
├── main worktree (main branch)
├── Session A worktree (feature/auth-refactor branch)
├── Session B worktree (feature/new-api-endpoint branch)
└── Session C worktree (fix/login-bug branch)
```

Benefits:
- **Shared history** — No duplicate objects, minimal disk overhead
- **Full isolation** — Each worktree has independent file state
- **Independent builds** — Each worktree can run its own dev server, test suite, etc.
- **Branch safety** — Git prevents the same branch from being checked out in multiple worktrees

## ChatML's Implementation

### Directory Layout

**File: `backend/git/worktree.go`**

Session worktrees are stored under `~/.chatml/workspaces/` by default (configurable via settings):

```
~/.chatml/workspaces/
├── my-project/
│   ├── sparkling-nebula/          # Session A worktree
│   │   ├── src/
│   │   ├── backend/
│   │   └── ...
│   ├── crimson-aurora/            # Session B worktree
│   │   ├── src/
│   │   ├── backend/
│   │   └── ...
│   └── midnight-cascade/          # Session C worktree
│       └── ...
└── other-project/
    └── ...
```

Session names use constellation-inspired names (e.g., "sparkling-nebula", "crimson-aurora") generated from a naming system with adjectives and nouns.

### Worktree Creation Flow

When a user creates a new session:

1. **Atomic directory creation** — `CreateSessionDirectoryAtomic()` uses `os.Mkdir()` (which is atomic at the filesystem level) to create the session directory. If the name collides with an existing directory, it returns `ErrDirectoryExists` and a new name is tried.

2. **Branch base selection** — The worktree is based on a target branch, typically `origin/main`. Per-session overrides allow targeting other branches (e.g., `origin/develop`).

3. **Git worktree add** — `git worktree add -b <branch-name> <path> <target-branch>` creates the worktree with a new branch. The branch name follows the configured prefix pattern.

4. **Base commit capture** — Before creating the worktree, the target branch's HEAD commit SHA is captured via `git rev-parse`. This becomes the session's `baseCommitSha`, used later for diff generation and PR creation.

```go
func (wm *WorktreeManager) CreateInExistingDir(ctx context.Context, repoPath, worktreePath, branchName, targetBranch string) (string, string, string, error) {
    // Capture target branch commit
    cmd, cancel := gitCmdWithContext(ctx, repoPath, "rev-parse", targetBranch)
    out, err := cmd.Output()
    baseCommit := strings.TrimSpace(string(out))

    // Create worktree in the existing directory
    cmd, cancel = gitCmdWithContext(ctx, repoPath, "worktree", "add", "-b", branchName, worktreePath, targetBranch)
    // ...
    return worktreePath, branchName, baseCommit, nil
}
```

### Branch Naming

Branch names are constructed based on the workspace's `branchPrefix` setting:

| Setting | Branch Name Example |
|---------|-------------------|
| `"github"` | `username/sparkling-nebula` |
| `"custom"` (prefix: `feat`) | `feat/sparkling-nebula` |
| `"none"` or `""` | `sparkling-nebula` |

### Checking Out Existing Branches

For "create session from PR" flows, ChatML can check out an existing remote branch:

```go
func (wm *WorktreeManager) CheckoutExistingBranchInDir(ctx context.Context, repoPath, worktreePath, remoteBranch string) (string, string, string, error) {
    // Reject protected branches
    if IsProtectedBranch(remoteBranch) {
        return "", "", "", fmt.Errorf("cannot create session on protected branch '%s'", remoteBranch)
    }
    // Fetch the specific branch
    gitCmdWithContext(ctx, repoPath, "fetch", "origin", remoteBranch)
    // Create worktree with tracking branch
    gitCmdWithContext(ctx, repoPath, "worktree", "add", "-b", remoteBranch, "--track", worktreePath, remoteRef)
}
```

Protected branches (`main`, `master`, `develop`) are rejected to prevent sessions from directly modifying shared branches.

### Error Handling

The worktree manager handles several error conditions:

| Error | Cause | Recovery |
|-------|-------|----------|
| `ErrDirectoryExists` | Name collision during directory creation | Retry with a new name |
| `ErrBranchAlreadyCheckedOut` | Branch is in use by another worktree | User must use a different branch |
| `ErrLocalBranchExists` | Local branch exists but isn't checked out | User must delete or rename the branch |

### Worktree Removal

When a session is deleted:

1. **Remove worktree** — `git worktree remove <path> --force` removes the working directory
2. **Prune** — `git worktree prune` cleans up stale worktree entries from git's internal tracking
3. **Delete branch** — `git branch -D <branch>` removes the session's branch

```go
func (wm *WorktreeManager) RemoveAtPath(ctx context.Context, repoPath, worktreePath, branchName string) error {
    // Remove the worktree
    gitCmdWithContext(ctx, repoPath, "worktree", "remove", worktreePath, "--force")
    // Prune stale entries
    gitCmdWithContext(ctx, repoPath, "worktree", "prune")
    // Delete the branch if specified
    if branchName != "" {
        gitCmdWithContext(ctx, repoPath, "branch", "-D", branchName)
    }
}
```

## Integration with Features

### Code Review

Review conversations examine the diff between the session branch and the target branch. Because each session has its own worktree, the diff is always isolated to that session's changes.

### PR Creation

When creating a PR from a session, the branch is already pushed and isolated. The PR targets the session's configured target branch (defaulting to the workspace's default branch).

### File Checkpointing

File checkpoints use `git stash create` within the session's worktree to capture file state. Because worktrees are independent, checkpoints from one session don't affect others.

### Branch Sync

Sessions can fall behind `origin/main` as other work gets merged. The branch sync feature detects this (via `git rev-list --count`) and allows syncing via rebase or merge, all within the session's isolated worktree.

### File Watching

The Tauri file watcher registers each session's worktree path. File changes within a worktree trigger events specific to that session, enabling real-time file change detection per session.

## Related Documentation

- [Session Lifecycle Management](./session-lifecycle-management.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
- [Pull Request Workflow](../workflows/pull-request-workflow.md)
