// agent-runner/src/mcp/tools/pr.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WorkspaceContext } from "../context.js";
import { fetchWithRetry, formatFetchError, buildHeaders, BACKEND_URL } from "./fetch-utils.js";

// Matches GitHub PR URLs: https://github.com/owner/repo/pull/123
const PR_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

export function createPRTools(context: WorkspaceContext) {
  return [
    tool(
      "report_pr_created",
      "Report that a pull request was created for this session. Call this AFTER successfully creating a PR with `gh pr create` or any other method. This ensures the PR is immediately tracked in the ChatML UI.",
      {
        prNumber: z.coerce.number().int().positive().describe("The PR number (e.g., 123)"),
        prUrl: z.string().describe("The full PR URL (e.g., https://github.com/owner/repo/pull/123)"),
      },
      async ({ prNumber, prUrl }) => {
        if (!PR_URL_PATTERN.test(prUrl)) {
          return {
            content: [{
              type: "text" as const,
              text: `Invalid PR URL: expected a GitHub PR URL like https://github.com/owner/repo/pull/123, got: ${prUrl}`,
            }],
          };
        }

        try {
          const response = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/pr/report`,
            {
              method: "POST",
              headers: buildHeaders(true),
              body: JSON.stringify({ prNumber, prUrl }),
            }
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [{
                type: "text" as const,
                text: `Failed to report PR: ${response.status} ${error}`,
              }],
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: `Reported PR #${prNumber} to ChatML. The PR badge will appear in the sidebar.`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: `Error reporting PR: ${formatFetchError(error)}. The PR may not appear in the ChatML sidebar immediately, but the PR watcher will pick it up.`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: false } }
    ),

    tool(
      "report_pr_merged",
      "Report that a pull request was merged for this session. Call this AFTER successfully merging a PR with `gh pr merge` or any other method. This updates the session status in ChatML.",
      {
        prNumber: z.coerce.number().int().positive().optional().describe("The PR number that was merged (optional if the session already has a PR associated)"),
      },
      async ({ prNumber }) => {
        try {
          const response = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/pr/report-merge`,
            {
              method: "POST",
              headers: buildHeaders(true),
              body: JSON.stringify({ prNumber }),
            }
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [{
                type: "text" as const,
                text: `Failed to report PR merge: ${response.status} ${error}`,
              }],
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: prNumber
                ? `Reported PR #${prNumber} merge to ChatML. Session status will update shortly.`
                : `Reported PR merge to ChatML. Session status will update shortly.`,
            }],
          };
        } catch (error) {
          // Best-effort notification — the PR watcher will detect merges via polling.
          return {
            content: [{
              type: "text" as const,
              text: prNumber
                ? `Failed to report PR #${prNumber} merge to backend (${formatFetchError(error)}), but the PR watcher will detect the merge automatically.`
                : `Failed to report PR merge to backend (${formatFetchError(error)}), but the PR watcher will detect the merge automatically.`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: false } }
    ),
  ];
}
