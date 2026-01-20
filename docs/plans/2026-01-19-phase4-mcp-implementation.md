# Phase 4: MCP & Custom Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add custom workspace tools, deep Linear integration, MCP server status visibility, and tool allowlist/blocklist to the Claude Agent SDK integration.

**Architecture:** SDK MCP Server pattern - tools run in the agent-runner Node.js process using `createSdkMcpServer()` and `tool()` from the SDK. Tools share a `WorkspaceContext` object for consistent state access.

**Tech Stack:** TypeScript, Claude Agent SDK ^0.1.50, Zod for schemas, React for frontend panel

---

## Task 1: Create WorkspaceContext Foundation

**Files:**
- Create: `agent-runner/src/mcp/context.ts`

**Step 1: Create the mcp directory**

```bash
mkdir -p agent-runner/src/mcp/tools
```

**Step 2: Write the WorkspaceContext class**

```typescript
// agent-runner/src/mcp/context.ts
import { execSync } from "child_process";

export interface LinearIssue {
  id: string;
  identifier: string;  // "LIN-123"
  title: string;
  description: string;
  state: string;
  labels: string[];
  assignee?: string;
  project?: string;
}

export interface GitState {
  branch: string;
  baseBranch: string;
  uncommittedChanges: boolean;
  aheadBy: number;
  behindBy: number;
}

export interface WorkspaceContextOptions {
  cwd: string;
  workspaceId: string;
  sessionId: string;
  linearIssue?: string; // CLI arg like "LIN-123"
}

export class WorkspaceContext {
  readonly cwd: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  private _linearIssue: LinearIssue | null = null;
  private _gitState: GitState | null = null;

  constructor(options: WorkspaceContextOptions) {
    this.cwd = options.cwd;
    this.workspaceId = options.workspaceId;
    this.sessionId = options.sessionId;

    // Resolve Linear issue from CLI arg or other sources
    if (options.linearIssue) {
      this._linearIssue = this.resolveLinearIssue(options.linearIssue);
    }
  }

  get linearIssue(): LinearIssue | null {
    return this._linearIssue;
  }

  setLinearIssue(issue: LinearIssue | null): void {
    this._linearIssue = issue;
  }

  get gitState(): GitState {
    if (!this._gitState) {
      this._gitState = this.fetchGitState();
    }
    return this._gitState;
  }

  refreshGitState(): GitState {
    this._gitState = this.fetchGitState();
    return this._gitState;
  }

  private fetchGitState(): GitState {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: this.cwd, encoding: "utf-8" }).trim();
      const baseBranch = this.detectBaseBranch();
      const status = execSync("git status --porcelain", { cwd: this.cwd, encoding: "utf-8" });
      const uncommittedChanges = status.trim().length > 0;

      let aheadBy = 0;
      let behindBy = 0;
      try {
        const counts = execSync(`git rev-list --left-right --count ${baseBranch}...HEAD`, { cwd: this.cwd, encoding: "utf-8" }).trim();
        const [behind, ahead] = counts.split("\t").map(Number);
        aheadBy = ahead || 0;
        behindBy = behind || 0;
      } catch {
        // Branch might not have upstream
      }

      return { branch, baseBranch, uncommittedChanges, aheadBy, behindBy };
    } catch {
      return { branch: "unknown", baseBranch: "main", uncommittedChanges: false, aheadBy: 0, behindBy: 0 };
    }
  }

  private detectBaseBranch(): string {
    try {
      // Check for common base branch names
      const branches = execSync("git branch -r", { cwd: this.cwd, encoding: "utf-8" });
      if (branches.includes("origin/main")) return "origin/main";
      if (branches.includes("origin/master")) return "origin/master";
      return "main";
    } catch {
      return "main";
    }
  }

  private resolveLinearIssue(identifier: string): LinearIssue | null {
    // Placeholder - will be implemented with Linear MCP integration
    // For now, return a minimal issue structure
    return {
      id: identifier,
      identifier,
      title: `Issue ${identifier}`,
      description: "",
      state: "unknown",
      labels: [],
    };
  }

  // Resolve Linear issue from multiple sources (priority order)
  static resolveFromSources(options: WorkspaceContextOptions): string | null {
    // 1. Explicit CLI arg (highest priority)
    if (options.linearIssue) {
      return options.linearIssue;
    }

    // 2. Branch name pattern (feat/LIN-123-description)
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: options.cwd, encoding: "utf-8" }).trim();
      const match = branch.match(/([A-Z]+-\d+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // Ignore git errors
    }

    // 3. Recent commit messages
    try {
      const logs = execSync("git log -5 --oneline", { cwd: options.cwd, encoding: "utf-8" });
      const match = logs.match(/([A-Z]+-\d+)/);
      if (match) {
        return match[1];
      }
    } catch {
      // Ignore git errors
    }

    return null;
  }
}
```

**Step 3: Build to verify no TypeScript errors**

Run: `cd agent-runner && npm run build`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add agent-runner/src/mcp/context.ts
git commit -m "feat(mcp): add WorkspaceContext foundation"
```

---

## Task 2: Create SDK MCP Server Setup

**Files:**
- Create: `agent-runner/src/mcp/server.ts`

**Step 1: Write the MCP server setup**

```typescript
// agent-runner/src/mcp/server.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { WorkspaceContext } from "./context.js";

export interface McpServerOptions {
  context: WorkspaceContext;
}

export function createConductorMcpServer(options: McpServerOptions) {
  const { context } = options;

  return createSdkMcpServer({
    name: "conductor",
    version: "1.0.0",
    tools: [
      // Session status tool
      tool(
        "get_session_status",
        "Get current session status including branch, worktree, and active Linear issue",
        {},
        async () => {
          const git = context.refreshGitState();
          const issue = context.linearIssue;

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                sessionId: context.sessionId,
                workspaceId: context.workspaceId,
                cwd: context.cwd,
                git: {
                  branch: git.branch,
                  baseBranch: git.baseBranch,
                  uncommittedChanges: git.uncommittedChanges,
                  aheadBy: git.aheadBy,
                  behindBy: git.behindBy,
                },
                linearIssue: issue ? {
                  identifier: issue.identifier,
                  title: issue.title,
                  state: issue.state,
                } : null,
              }, null, 2),
            }],
          };
        }
      ),

      // Workspace diff tool
      tool(
        "get_workspace_diff",
        "Get a summary of all changes in the workspace compared to the base branch",
        {
          detailed: z.boolean().optional().describe("Include full diff output instead of summary"),
        },
        async ({ detailed }) => {
          const git = context.gitState;
          const { execSync } = await import("child_process");

          try {
            if (detailed) {
              const diff = execSync(`git diff ${git.baseBranch}...HEAD`, { cwd: context.cwd, encoding: "utf-8" });
              return {
                content: [{ type: "text", text: diff || "No changes" }],
              };
            }

            const stat = execSync(`git diff ${git.baseBranch}...HEAD --stat`, { cwd: context.cwd, encoding: "utf-8" });
            return {
              content: [{ type: "text", text: stat || "No changes" }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting diff: ${error}` }],
            };
          }
        }
      ),

      // Recent activity tool
      tool(
        "get_recent_activity",
        "Get recent commits and file changes in the workspace",
        {
          limit: z.number().optional().default(10).describe("Number of commits to show"),
        },
        async ({ limit }) => {
          const { execSync } = await import("child_process");

          try {
            const logs = execSync(`git log -${limit} --oneline --decorate`, { cwd: context.cwd, encoding: "utf-8" });
            return {
              content: [{ type: "text", text: logs || "No commits" }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting logs: ${error}` }],
            };
          }
        }
      ),
    ],
  });
}
```

**Step 2: Build to verify no TypeScript errors**

Run: `cd agent-runner && npm run build`
Expected: Compilation succeeds

**Step 3: Commit**

```bash
git add agent-runner/src/mcp/server.ts
git commit -m "feat(mcp): add SDK MCP server with workspace tools"
```

---

## Task 3: Wire MCP Server into Agent Runner

**Files:**
- Modify: `agent-runner/src/index.ts`

**Step 1: Add imports at the top of index.ts (after existing imports)**

Find line with existing imports and add:

```typescript
import { WorkspaceContext } from "./mcp/context.js";
import { createConductorMcpServer } from "./mcp/server.js";
```

**Step 2: Parse new CLI arguments (after line ~37)**

Find:
```typescript
const forkSession = forkIndex !== -1;
```

Add after:
```typescript
const linearIssueIndex = args.indexOf("--linear-issue");
const toolPresetIndex = args.indexOf("--tool-preset");

const linearIssue = linearIssueIndex !== -1 ? args[linearIssueIndex + 1] : undefined;
const toolPreset = toolPresetIndex !== -1 ? args[toolPresetIndex + 1] as "full" | "read-only" | "no-bash" | "safe-edit" : "full";
```

**Step 3: Create workspace context before query (around line ~415)**

Find:
```typescript
const result = query({
```

Add before:
```typescript
// Create workspace context for MCP tools
const workspaceContext = new WorkspaceContext({
  cwd,
  workspaceId: conversationId, // Use conversation ID as workspace ID for now
  sessionId: currentSessionId || "pending",
  linearIssue,
});

// Create conductor MCP server
const conductorMcp = createConductorMcpServer({ context: workspaceContext });
```

**Step 4: Add mcpServers to query options**

Find:
```typescript
options: {
  cwd,
  permissionMode: "bypassPermissions",
```

Add inside options object:
```typescript
mcpServers: [conductorMcp],
```

**Step 5: Build and verify**

Run: `cd agent-runner && npm run build`
Expected: Compilation succeeds

**Step 6: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(mcp): wire conductor MCP server into agent runner"
```

---

## Task 4: Add CLI Arguments to Backend

**Files:**
- Modify: `backend/agent/process.go`

**Step 1: Update ProcessOptions struct (around line 19)**

Find:
```go
type ProcessOptions struct {
	ID             string
	Workdir        string
	ConversationID string
	ResumeSession  string // Session ID to resume
	ForkSession    bool   // Whether to fork the session
}
```

Replace with:
```go
type ProcessOptions struct {
	ID             string
	Workdir        string
	ConversationID string
	ResumeSession  string // Session ID to resume
	ForkSession    bool   // Whether to fork the session
	LinearIssue    string // Linear issue identifier (e.g., "LIN-123")
	ToolPreset     string // Tool preset: full, read-only, no-bash, safe-edit
}
```

**Step 2: Add CLI arguments in NewProcessWithOptions (around line 109)**

Find:
```go
// Add fork flag if specified
if opts.ForkSession && opts.ResumeSession != "" {
	args = append(args, "--fork")
}
```

Add after:
```go
// Add Linear issue if specified
if opts.LinearIssue != "" {
	args = append(args, "--linear-issue", opts.LinearIssue)
}

// Add tool preset if specified
if opts.ToolPreset != "" {
	args = append(args, "--tool-preset", opts.ToolPreset)
}
```

**Step 3: Build and verify**

Run: `cd backend && go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add backend/agent/process.go
git commit -m "feat(agent): add linear-issue and tool-preset CLI args"
```

---

## Task 5: Add MCP Servers Tab to Right Sidebar

**Files:**
- Create: `src/components/McpServersPanel.tsx`
- Modify: `src/components/ChangesPanel.tsx`

**Step 1: Create McpServersPanel component**

```typescript
// src/components/McpServersPanel.tsx
'use client';

import { useAppStore } from '@/stores/appStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Server, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { McpServerStatus } from '@/lib/types';

const STATUS_CONFIG = {
  connected: {
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    label: 'Connected',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    label: 'Failed',
  },
  'needs-auth': {
    icon: AlertCircle,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    label: 'Needs Auth',
  },
  pending: {
    icon: Clock,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    label: 'Connecting...',
  },
} as const;

export function McpServersPanel() {
  const { mcpServers } = useAppStore();

  if (!mcpServers || mcpServers.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Server className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No MCP servers</p>
          <p className="text-xs mt-1">Servers will appear when agent starts</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        {mcpServers.map((server) => (
          <McpServerRow key={server.name} server={server} />
        ))}
      </div>
    </ScrollArea>
  );
}

function McpServerRow({ server }: { server: McpServerStatus }) {
  const config = STATUS_CONFIG[server.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md',
        config.bgColor
      )}
    >
      <Icon className={cn('w-3.5 h-3.5 shrink-0', config.color)} />
      <span className="text-sm font-medium flex-1 truncate">{server.name}</span>
      <span className={cn('text-xs', config.color)}>{config.label}</span>
    </div>
  );
}
```

**Step 2: Add mcpServers to appStore (if not already there)**

Check `src/stores/appStore.ts` for `mcpServers` state. If missing, add:

```typescript
// In the store state
mcpServers: [] as McpServerStatus[],

// In the actions
setMcpServers: (servers: McpServerStatus[]) => set({ mcpServers: servers }),
```

**Step 3: Update ChangesPanel to include MCP Servers tab**

Find in `src/components/ChangesPanel.tsx` around line 68:

```typescript
const [outputTab, setOutputTab] = useState<'setup' | 'run'>('setup');
```

Replace with:
```typescript
const [outputTab, setOutputTab] = useState<'setup' | 'run' | 'mcp'>('setup');
```

**Step 4: Add import for McpServersPanel**

Find imports at top and add:
```typescript
import { McpServersPanel } from '@/components/McpServersPanel';
```

**Step 5: Add MCP Servers button in the bottom tabs section**

Find around line 440 (the Setup/Run buttons section):

```typescript
<Button
  variant={outputTab === 'run' ? 'secondary' : 'ghost'}
  size="sm"
  className="h-6 text-xs px-2"
  onClick={() => setOutputTab('run')}
>
  Run
</Button>
```

Add after the Run button:
```typescript
<Button
  variant={outputTab === 'mcp' ? 'secondary' : 'ghost'}
  size="sm"
  className="h-6 text-xs px-2"
  onClick={() => setOutputTab('mcp')}
>
  MCP
</Button>
```

**Step 6: Add MCP panel rendering**

Find around line 450 (after the Run terminal output):

```typescript
{outputTab === 'run' && selectedSessionId && (
  <TerminalOutput sessionId={selectedSessionId} type="run" />
)}
```

Add after:
```typescript
{outputTab === 'mcp' && (
  <McpServersPanel />
)}
```

**Step 7: Build frontend**

Run: `npm run build`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add src/components/McpServersPanel.tsx src/components/ChangesPanel.tsx
git commit -m "feat(ui): add MCP Servers panel to right sidebar"
```

---

## Task 6: Add Linear Tools (Placeholder)

**Files:**
- Create: `agent-runner/src/mcp/tools/linear.ts`
- Modify: `agent-runner/src/mcp/server.ts`

**Step 1: Create Linear tools file**

```typescript
// agent-runner/src/mcp/tools/linear.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WorkspaceContext, LinearIssue } from "../context.js";

export function createLinearTools(context: WorkspaceContext) {
  return [
    // Get current Linear issue context
    tool(
      "get_linear_context",
      "Get details about the current Linear issue being worked on",
      {},
      async () => {
        const issue = context.linearIssue;
        if (!issue) {
          return {
            content: [{ type: "text", text: "No Linear issue currently associated with this session." }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              state: issue.state,
              labels: issue.labels,
              assignee: issue.assignee,
              project: issue.project,
            }, null, 2),
          }],
        };
      }
    ),

    // Start working on a Linear issue
    tool(
      "start_linear_issue",
      "Start working on a Linear issue. Creates a git branch and associates the issue with this session. Note: Actual Linear API integration requires the Linear MCP server.",
      {
        issueId: z.string().describe("Issue identifier like 'LIN-123'"),
      },
      async ({ issueId }) => {
        const { execSync } = await import("child_process");

        // Create branch name from issue ID
        const branchName = `feat/${issueId.toLowerCase()}`;

        try {
          // Check if branch exists
          try {
            execSync(`git rev-parse --verify ${branchName}`, { cwd: context.cwd, encoding: "utf-8" });
            // Branch exists, checkout
            execSync(`git checkout ${branchName}`, { cwd: context.cwd, encoding: "utf-8" });
          } catch {
            // Branch doesn't exist, create it
            execSync(`git checkout -b ${branchName}`, { cwd: context.cwd, encoding: "utf-8" });
          }

          // Update context with issue (placeholder - real integration uses Linear MCP)
          context.setLinearIssue({
            id: issueId,
            identifier: issueId,
            title: `Working on ${issueId}`,
            description: "",
            state: "In Progress",
            labels: [],
          });

          context.refreshGitState();

          return {
            content: [{
              type: "text",
              text: `Started working on ${issueId}. Branch: ${branchName}\n\nNote: To update the issue status in Linear, use the Linear MCP server's update_issue tool.`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Error starting issue: ${error}` }],
          };
        }
      }
    ),

    // Update Linear issue status
    tool(
      "update_linear_status",
      "Update the status of the current Linear issue in the local context. Note: To actually update Linear, use the Linear MCP server.",
      {
        state: z.string().describe("New state (e.g., 'In Progress', 'In Review', 'Done')"),
      },
      async ({ state }) => {
        const issue = context.linearIssue;
        if (!issue) {
          return {
            content: [{ type: "text", text: "No Linear issue associated with this session." }],
          };
        }

        // Update local context
        context.setLinearIssue({
          ...issue,
          state,
        });

        return {
          content: [{
            type: "text",
            text: `Updated local status for ${issue.identifier} to "${state}".\n\nNote: To update Linear, use: mcp__linear__update_issue`,
          }],
        };
      }
    ),
  ];
}
```

**Step 2: Update server.ts to include Linear tools**

Add import at top of `agent-runner/src/mcp/server.ts`:
```typescript
import { createLinearTools } from "./tools/linear.js";
```

Find the tools array and spread in Linear tools:
```typescript
tools: [
  // ... existing tools ...
  ...createLinearTools(context),
],
```

**Step 3: Build and verify**

Run: `cd agent-runner && npm run build`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add agent-runner/src/mcp/tools/linear.ts agent-runner/src/mcp/server.ts
git commit -m "feat(mcp): add Linear integration tools"
```

---

## Task 7: Add Tool Preset Support

**Files:**
- Modify: `agent-runner/src/index.ts`

**Step 1: Add preset resolver function**

Add after imports:
```typescript
function resolveToolPreset(preset: string): { allowedTools?: string[]; disallowedTools?: string[] } {
  switch (preset) {
    case "read-only":
      return { allowedTools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"] };
    case "no-bash":
      return { disallowedTools: ["Bash"] };
    case "safe-edit":
      return { allowedTools: ["Read", "Glob", "Grep", "Edit", "WebFetch", "WebSearch"] };
    case "full":
    default:
      return {};
  }
}
```

**Step 2: Apply preset to query options**

Find where query options are defined and add:
```typescript
const presetConfig = resolveToolPreset(toolPreset);
```

Then in the options object, add:
```typescript
allowedTools: presetConfig.allowedTools,
disallowedTools: presetConfig.disallowedTools,
```

**Step 3: Build and verify**

Run: `cd agent-runner && npm run build`
Expected: Compilation succeeds

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(mcp): add tool preset support for allowlist/blocklist"
```

---

## Task 8: Integration Test

**Files:**
- None (manual testing)

**Step 1: Build everything**

```bash
cd agent-runner && npm run build
cd ../backend && go build ./...
npm run build
```

**Step 2: Run the app and verify**

1. Start the app
2. Start a conversation - verify "conductor" MCP server appears in status
3. Ask agent to use `get_session_status` tool
4. Check MCP Servers tab shows server status

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 4 MCP & Custom Tools implementation"
```

---

## Verification Checklist

- [ ] `conductor` MCP server connects when agent starts
- [ ] `get_session_status` returns correct git state
- [ ] `get_workspace_diff` returns diff summary
- [ ] `get_recent_activity` returns commit history
- [ ] MCP Servers tab visible in right sidebar
- [ ] Server status indicators work (green/yellow/red)
- [ ] Linear tools available (placeholder functionality)
- [ ] Tool presets restrict available tools
