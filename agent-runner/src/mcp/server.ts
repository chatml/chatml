// agent-runner/src/mcp/server.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { WorkspaceContext } from "./context.js";
import { createLinearTools } from "./tools/linear.js";
import { createCommentTools } from "./tools/comments.js";
import { createPRTools } from "./tools/pr.js";
import { createScriptTools } from "./tools/scripts.js";
import { createSprintTools } from "./tools/sprint.js";

const BACKEND_URL = process.env.CHATML_BACKEND_URL || "http://127.0.0.1:9876";
const AUTH_TOKEN = process.env.CHATML_AUTH_TOKEN || "";

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return headers;
}

function sessionApiUrl(context: WorkspaceContext, path: string): string {
  return `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}${path}`;
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

interface BranchCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  timestamp: string;
  files: FileChange[];
}

interface BranchChangesResponse {
  commits: BranchCommit[];
  branchStats?: { totalFiles: number; totalAdditions: number; totalDeletions: number };
}

export interface McpServerOptions {
  context: WorkspaceContext;
}

export function createChatMLMcpServer(options: McpServerOptions) {
  const { context } = options;

  return createSdkMcpServer({
    name: "chatml",
    version: "1.0.0",
    tools: [
      // Session status tool
      tool(
        "get_session_status",
        "Get current session status including branch, worktree, and active Linear issue",
        {},
        async () => {
          const issue = context.linearIssue;

          try {
            const res = await fetch(sessionApiUrl(context, "/git-status"), { headers: buildHeaders() });
            if (!res.ok) {
              const text = await res.text();
              throw new Error(`Backend error ${res.status}: ${text}`);
            }
            const gitStatus = await res.json();

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  sessionId: context.sessionId,
                  workspaceId: context.workspaceId,
                  cwd: context.cwd,
                  git: gitStatus,
                  linearIssue: issue ? {
                    identifier: issue.identifier,
                    title: issue.title,
                    state: issue.state,
                  } : null,
                }, null, 2),
              }],
            };
          } catch (error) {
            // Fall back to local git state if backend is unavailable
            const git = context.refreshGitState();
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
        },
        { annotations: { readOnlyHint: true } }
      ),

      // Workspace diff tool
      tool(
        "get_workspace_diff",
        "Get a summary of all changes in the workspace compared to the base branch, including uncommitted changes",
        {
          detailed: z.boolean().optional().describe("Include full diff output instead of summary"),
          file: z.string().optional().describe("Get diff for a specific file path"),
        },
        async ({ detailed, file }) => {
          const MAX_DIFF_BYTES = 120000;

          try {
            // Single file unified diff
            if (file) {
              const res = await fetch(
                sessionApiUrl(context, `/diff-summary?path=${encodeURIComponent(file)}&maxBytes=${MAX_DIFF_BYTES}`),
                { headers: buildHeaders() }
              );
              if (!res.ok) {
                const text = await res.text();
                throw new Error(`Backend error ${res.status}: ${text}`);
              }
              const diff = await res.text();
              return {
                content: [{ type: "text", text: diff || "No changes for this file" }],
              };
            }

            // Detailed mode: unified diff for the whole workspace
            if (detailed) {
              const res = await fetch(
                sessionApiUrl(context, `/diff-summary?maxBytes=${MAX_DIFF_BYTES}`),
                { headers: buildHeaders() }
              );
              if (!res.ok) {
                const text = await res.text();
                throw new Error(`Backend error ${res.status}: ${text}`);
              }
              const diff = await res.text();
              return {
                content: [{ type: "text", text: diff || "No changes" }],
              };
            }

            // Fetch uncommitted changes + branch commits in parallel
            const [changesRes, branchRes] = await Promise.all([
              fetch(sessionApiUrl(context, "/changes"), { headers: buildHeaders() }),
              fetch(sessionApiUrl(context, "/branch-commits"), { headers: buildHeaders() }),
            ]);

            if (!changesRes.ok) {
              const text = await changesRes.text();
              throw new Error(`Backend error ${changesRes.status}: ${text}`);
            }
            if (!branchRes.ok) {
              const text = await branchRes.text();
              throw new Error(`Backend error ${branchRes.status}: ${text}`);
            }

            const uncommitted: FileChange[] = await changesRes.json();
            const branch: BranchChangesResponse = await branchRes.json();

            const hasCommits = branch.commits && branch.commits.length > 0;
            const hasUncommitted = uncommitted && uncommitted.length > 0;

            if (!hasCommits && !hasUncommitted) {
              return { content: [{ type: "text", text: "No changes" }] };
            }

            // Stat mode: format a concise summary
            const lines: string[] = [];

            if (branch.branchStats) {
              const s = branch.branchStats;
              lines.push(`Branch: ${s.totalFiles} file(s) changed, +${s.totalAdditions} -${s.totalDeletions}`);
            }

            if (hasCommits) {
              lines.push(`\nCommits (${branch.commits.length}):`);
              for (const c of branch.commits) {
                lines.push(`  ${c.shortSha} ${c.message}`);
              }
            }

            if (hasUncommitted) {
              lines.push(`\nUncommitted changes (${uncommitted.length}):`);
              for (const f of uncommitted) {
                const stats = f.additions || f.deletions ? ` (+${f.additions} -${f.deletions})` : "";
                lines.push(`  ${f.status.padEnd(10)} ${f.path}${stats}`);
              }
            }

            return {
              content: [{ type: "text", text: lines.join("\n") }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting diff: ${error}` }],
            };
          }
        },
        { annotations: { readOnlyHint: true } }
      ),

      // Recent activity tool
      tool(
        "get_recent_activity",
        "Get recent commits and file changes in the workspace",
        {},
        async () => {
          try {
            const res = await fetch(sessionApiUrl(context, "/branch-commits"), { headers: buildHeaders() });
            if (!res.ok) {
              const text = await res.text();
              throw new Error(`Backend error ${res.status}: ${text}`);
            }
            const branch: BranchChangesResponse = await res.json();

            if (!branch.commits || branch.commits.length === 0) {
              return { content: [{ type: "text", text: "No commits on this branch" }] };
            }

            const lines: string[] = [];
            for (const c of branch.commits) {
              lines.push(`${c.shortSha} ${c.message} (${c.author})`);
              if (c.files && c.files.length > 0) {
                for (const f of c.files) {
                  lines.push(`  ${f.status.padEnd(10)} ${f.path} (+${f.additions} -${f.deletions})`);
                }
              }
            }

            return {
              content: [{ type: "text", text: lines.join("\n") }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting activity: ${error}` }],
            };
          }
        },
        { annotations: { readOnlyHint: true } }
      ),

      // Linear integration tools
      ...createLinearTools(context),

      // Review comment tools
      ...createCommentTools(context),

      // PR lifecycle tools
      ...createPRTools(context),

      // Script config tools
      ...createScriptTools(context),

      // Sprint phase tools
      ...createSprintTools(context),
    ],
  });
}
