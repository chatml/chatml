// agent-runner/src/mcp/tools/linear.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
export function createLinearTools(context) {
    return [
        // Get current Linear issue context
        tool("get_linear_context", "Get details about the current Linear issue being worked on", {}, async () => {
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
        }),
        // Start working on a Linear issue
        tool("start_linear_issue", "Start working on a Linear issue. Creates a git branch and associates the issue with this session. Note: Actual Linear API integration requires the Linear MCP server.", {
            issueId: z.string().describe("Issue identifier like 'LIN-123'"),
        }, async ({ issueId }) => {
            const { execSync } = await import("child_process");
            // Create branch name from issue ID
            const branchName = `feat/${issueId.toLowerCase()}`;
            try {
                // Check if branch exists
                try {
                    execSync(`git rev-parse --verify ${branchName}`, { cwd: context.cwd, encoding: "utf-8" });
                    // Branch exists, checkout
                    execSync(`git checkout ${branchName}`, { cwd: context.cwd, encoding: "utf-8" });
                }
                catch {
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
            }
            catch (error) {
                return {
                    content: [{ type: "text", text: `Error starting issue: ${error}` }],
                };
            }
        }),
        // Update Linear issue status
        tool("update_linear_status", "Update the status of the current Linear issue in the local context. Note: To actually update Linear, use the Linear MCP server.", {
            state: z.string().describe("New state (e.g., 'In Progress', 'In Review', 'Done')"),
        }, async ({ state }) => {
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
        }),
    ];
}
