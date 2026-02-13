// agent-runner/src/mcp/server.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { WorkspaceContext } from "./context.js";
import { createLinearTools } from "./tools/linear.js";
import { createCommentTools } from "./tools/comments.js";
import { createScriptTools } from "./tools/scripts.js";

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
        },
        { annotations: { readOnlyHint: true } }
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
          const { execFileSync } = await import("child_process");

          try {
            const execOpts = { cwd: context.cwd, encoding: "utf-8" as const };
            if (detailed) {
              const diff = execFileSync("git", ["diff", `${git.baseBranch}...HEAD`], execOpts);
              return {
                content: [{ type: "text", text: diff || "No changes" }],
              };
            }

            const stat = execFileSync("git", ["diff", `${git.baseBranch}...HEAD`, "--stat"], execOpts);
            return {
              content: [{ type: "text", text: stat || "No changes" }],
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
        {
          limit: z.number().optional().default(10).describe("Number of commits to show"),
        },
        async ({ limit }) => {
          const { execFileSync } = await import("child_process");

          try {
            const logs = execFileSync("git", ["log", `-${limit}`, "--oneline", "--decorate"], { cwd: context.cwd, encoding: "utf-8" as const });
            return {
              content: [{ type: "text", text: logs || "No commits" }],
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: `Error getting logs: ${error}` }],
            };
          }
        },
        { annotations: { readOnlyHint: true } }
      ),

      // Linear integration tools
      ...createLinearTools(context),

      // Review comment tools
      ...createCommentTools(context),

      // Script config tools
      ...createScriptTools(context),
    ],
  });
}
