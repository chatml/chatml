# Phase 4: MCP & Custom Tools Design

## Overview

This design extends the Claude Agent SDK integration to add custom workspace tools, deep Linear integration, MCP server status visibility, and tool allowlist/blocklist capabilities.

## Architecture

### Approach: SDK MCP Server

Tools run in the same Node.js process as the agent-runner using `createSdkMcpServer()` and `tool()` from the SDK. This gives direct access to workspace state, session metadata, and git information without inter-process communication.

### File Structure

```
agent-runner/src/mcp/
├── server.ts      # SDK MCP server setup
├── context.ts     # Shared workspace context
└── tools/
    ├── workspace.ts  # Session/PR/diff tools
    ├── linear.ts     # Linear integration
    └── release.ts    # Release notes generation
```

### Connection Flow

```
agent-runner process
├── query() with mcpServers config
│   └── "conductor": createSdkMcpServer()
│       ├── Tools registered via tool()
│       └── Shared WorkspaceContext
└── MCP status events emitted to frontend
```

## Shared Context System

All tools share a `WorkspaceContext` object that provides consistent access to workspace state:

```typescript
interface WorkspaceContext {
  cwd: string;
  workspaceId: string;
  sessionId: string;
  linearIssue: LinearIssue | null;
  gitState: GitState;
}

interface LinearIssue {
  id: string;
  identifier: string;  // "LIN-123"
  title: string;
  description: string;
  state: string;
  labels: string[];
  assignee?: string;
  project?: string;
}

interface GitState {
  branch: string;
  baseBranch: string;
  uncommittedChanges: boolean;
  aheadBy: number;
  behindBy: number;
}
```

### Linear Issue Resolution Priority

When determining the current Linear issue:

1. Explicit (highest): `--linear-issue LIN-123` CLI argument
2. Metadata: Stored in session/worktree metadata
3. Branch name: Parse `feat/LIN-123-description` patterns
4. Commit messages: Scan recent commits for issue references (lowest)

## Custom Tools

### Workspace Tools (`workspace.ts`)

| Tool | Description |
|------|-------------|
| `get_session_status` | Current session info (branch, worktree, active issue) |
| `get_pr_status` | PR state, checks, review status |
| `get_workspace_diff` | Summarized diff against base branch |
| `get_recent_activity` | Recent commits, tool usage, file changes |

### Linear Tools (`linear.ts`)

| Tool | Description |
|------|-------------|
| `get_linear_context` | Inject current issue details into conversation |
| `start_linear_issue` | Create branch, mark In Progress |
| `complete_linear_issue` | Create PR, transition to Review |
| `update_linear_issue` | Update status, add comments |
| `link_pr_to_issue` | Attach PR URL to Linear issue |

### Release Tools (`release.ts`)

| Tool | Description |
|------|-------------|
| `generate_release_notes` | Create release notes from commits/PRs since last tag |

### Example Tool Implementation

```typescript
tool("start_linear_issue",
  "Start working on a Linear issue. Creates a branch and marks it In Progress.",
  { issueId: z.string().describe("Issue identifier like 'LIN-123'") },
  async ({ issueId }) => {
    const issue = await linearClient.getIssue(issueId);
    const branchName = `feat/${issue.identifier}-${slugify(issue.title)}`;
    await git.createBranch(branchName);
    await linearClient.updateIssue(issue.id, { state: "In Progress" });
    context.setLinearIssue(issue);
    return {
      content: [{ type: "text", text: `Started ${issue.identifier}: ${issue.title}` }]
    };
  }
);
```

## Tool Control

### Allowlist/Blocklist Configuration

Pass via CLI or query options:

```typescript
interface ToolControlConfig {
  preset?: 'full' | 'read-only' | 'no-bash' | 'safe-edit';
  allowedTools?: string[];
  disallowedTools?: string[];
}
```

### Presets

| Preset | Description |
|--------|-------------|
| `full` | All tools enabled (default) |
| `read-only` | Only Read, Glob, Grep, WebFetch |
| `no-bash` | All except Bash |
| `safe-edit` | Read + Edit, no Write/Bash |

### Implementation

```typescript
// In query options
allowedTools: preset === 'read-only'
  ? ['Read', 'Glob', 'Grep', 'WebFetch']
  : undefined,
disallowedTools: preset === 'no-bash'
  ? ['Bash']
  : undefined
```

## MCP Status Visibility

### Frontend Component

New **MCP Servers** tab in the right sidebar bottom section (alongside Setup/Run tabs):

```
┌─────────────────────────────┐
│ [Setup] [Run] [MCP Servers] │
├─────────────────────────────┤
│ 🟢 conductor     connected  │
│ 🟢 linear        connected  │
│ 🟡 github        needs-auth │
│ 🔴 postgres      failed     │
└─────────────────────────────┘
```

### Status Indicators

| Status | Indicator |
|--------|-----------|
| `connected` | 🟢 Green |
| `pending` | 🟡 Yellow |
| `needs-auth` | 🟡 Yellow |
| `failed` | 🔴 Red |

### Event Flow

1. Agent emits `mcp_status` events with server statuses
2. Backend parses and forwards via WebSocket
3. Frontend `McpServersPanel.tsx` displays in sidebar

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `agent-runner/src/mcp/server.ts` | SDK MCP server setup with createSdkMcpServer() |
| `agent-runner/src/mcp/context.ts` | WorkspaceContext class and LinearIssue resolution |
| `agent-runner/src/mcp/tools/workspace.ts` | Workspace status tools |
| `agent-runner/src/mcp/tools/linear.ts` | Linear integration tools |
| `agent-runner/src/mcp/tools/release.ts` | Release notes generation tool |
| `src/components/McpServersPanel.tsx` | MCP status panel component |

### Files to Modify

| File | Changes |
|------|---------|
| `agent-runner/src/index.ts` | Wire MCP server into query, add tool control options |
| `backend/agent/process.go` | Add --linear-issue, --tool-preset CLI args |
| `src/components/RightSidebar.tsx` | Add MCP Servers tab |

### Implementation Order

1. **Context System** (`context.ts`) - Foundation for all tools
2. **MCP Server** (`server.ts`) - Server setup with tool registration
3. **Workspace Tools** - Session/PR/diff tools
4. **Linear Tools** - Deep Linear integration
5. **Tool Control** - Allowlist/blocklist support
6. **Frontend** - MCP Servers panel in right sidebar
7. **Release Tools** - Release notes generation

## Verification

- Start agent and verify `conductor` MCP server connects
- Test workspace tools return correct session/git state
- Test Linear tools create branches and update issues
- Verify MCP status displays in right sidebar
- Test tool presets restrict available tools correctly
