// agent-runner/src/mcp/server.ts
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { WorkspaceContext } from "./context.js";
import { createLinearTools } from "./tools/linear.js";

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

      // Linear integration tools
      ...createLinearTools(context),
    ],
  });
}
