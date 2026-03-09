// agent-runner/src/mcp/tools/comments.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WorkspaceContext } from "../context.js";
import { fetchWithRetry } from "./fetch-utils.js";

// Backend URL from environment. This matches the default port used by the Go backend.
// TODO: Consider adding backendUrl to WorkspaceContext for consistency with other tools
const BACKEND_URL = process.env.CHATML_BACKEND_URL || "http://127.0.0.1:9876";
const AUTH_TOKEN = process.env.CHATML_AUTH_TOKEN || "";

function buildHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return headers;
}

export function createCommentTools(context: WorkspaceContext) {
  return [
    // Add a review comment to a specific line in a file
    tool(
      "add_review_comment",
      "Add a code review comment to a specific line in a file. Use this to leave feedback, suggestions, or highlight issues during code review.",
      {
        filePath: z.string().describe("Relative path to the file being reviewed"),
        lineNumber: z.coerce.number().int().min(1).describe("Line number for the comment (1-based)"),
        title: z.string().optional().describe("Short title summarizing the issue (e.g., 'Potential memory leak', 'Missing error handling')"),
        content: z.string().describe("The review comment content with details (supports markdown)"),
        severity: z.enum(["error", "warning", "suggestion", "info"]).optional().describe("Optional severity level: 'error' for bugs/critical issues, 'warning' for potential problems, 'suggestion' for improvements, 'info' for informational notes"),
      },
      async ({ filePath, lineNumber, title, content, severity }) => {
        try {
          const response = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/comments`,
            {
              method: "POST",
              headers: buildHeaders(true),
              body: JSON.stringify({
                filePath,
                lineNumber,
                title,
                content,
                severity,
                source: "claude",
                author: "Claude",
              }),
            }
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [{
                type: "text",
                text: `Failed to add review comment: ${response.status} ${error}`,
              }],
            };
          }

          await response.json();
          return {
            content: [{
              type: "text",
              text: `Added ${severity || "review"} comment to ${filePath}:${lineNumber}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error adding review comment: ${error}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: false, openWorldHint: true } }
    ),

    // List review comments for the current session
    tool(
      "list_review_comments",
      "List all review comments for the current session, optionally filtered by file",
      {
        filePath: z.string().optional().describe("Optional file path to filter comments"),
      },
      async ({ filePath }) => {
        try {
          let url = `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/comments`;
          if (filePath) {
            url += `?filePath=${encodeURIComponent(filePath)}`;
          }

          const response = await fetchWithRetry(url, { headers: buildHeaders() });
          if (!response.ok) {
            const error = await response.text();
            return {
              content: [{
                type: "text",
                text: `Failed to list review comments: ${response.status} ${error}`,
              }],
            };
          }

          const comments = await response.json();
          if (comments.length === 0) {
            return {
              content: [{
                type: "text",
                text: filePath
                  ? `No review comments found for ${filePath}`
                  : "No review comments found in this session",
              }],
            };
          }

          // Format comments for display
          interface CommentResponse {
            filePath: string;
            lineNumber: number;
            content: string;
            severity?: string;
            resolved?: boolean;
          }
          const formatted = comments.map((c: CommentResponse) => {
            const severityTag = c.severity ? `[${c.severity.toUpperCase()}] ` : "";
            const resolved = c.resolved ? " (resolved)" : "";
            return `${c.filePath}:${c.lineNumber} - ${severityTag}${c.content}${resolved}`;
          }).join("\n\n");

          return {
            content: [{
              type: "text",
              text: `Found ${comments.length} review comment(s):\n\n${formatted}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error listing review comments: ${error}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    // Resolve a review comment (mark as fixed or ignored)
    tool(
      "resolve_review_comment",
      "Mark a review comment as fixed or ignored after addressing it. Use this after you've made the code changes to address a review comment.",
      {
        commentId: z.string().describe("The ID of the review comment to resolve"),
        resolutionType: z.enum(["fixed", "ignored"]).default("fixed")
          .describe("How the comment was resolved: 'fixed' if code was changed, 'ignored' if intentionally skipped"),
      },
      async ({ commentId, resolutionType }) => {
        try {
          const response = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/comments/${commentId}`,
            {
              method: "PATCH",
              headers: buildHeaders(true),
              body: JSON.stringify({
                resolved: true,
                resolvedBy: "Claude",
                resolutionType,
              }),
            }
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [{
                type: "text" as const,
                text: `Failed to resolve review comment: ${response.status} ${error}`,
              }],
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: `Marked review comment ${commentId} as ${resolutionType}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: `Error resolving review comment: ${error}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }
    ),

    // Get comment statistics for the session
    tool(
      "get_review_comment_stats",
      "Get statistics about review comments including per-file counts of unresolved comments",
      {},
      async () => {
        try {
          const response = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/comments/stats`,
            { headers: buildHeaders() }
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [{
                type: "text",
                text: `Failed to get comment stats: ${response.status} ${error}`,
              }],
            };
          }

          const stats = await response.json();
          if (stats.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No review comments in this session",
              }],
            };
          }

          interface StatResponse {
            filePath: string;
            total: number;
            unresolved: number;
          }
          const formatted = stats.map((s: StatResponse) =>
            `${s.filePath}: ${s.unresolved}/${s.total} unresolved`
          ).join("\n");

          const totalUnresolved = stats.reduce((sum: number, s: StatResponse) => sum + s.unresolved, 0);
          const totalComments = stats.reduce((sum: number, s: StatResponse) => sum + s.total, 0);

          return {
            content: [{
              type: "text",
              text: `Review Comment Stats (${totalUnresolved}/${totalComments} unresolved):\n\n${formatted}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting comment stats: ${error}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: true } }
    ),
  ];
}
