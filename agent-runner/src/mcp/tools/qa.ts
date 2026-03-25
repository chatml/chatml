// agent-runner/src/mcp/tools/qa.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WorkspaceContext } from "../context.js";
import { fetchWithRetry, formatFetchError, buildHeaders, BACKEND_URL } from "./fetch-utils.js";

export function createQATools(context: WorkspaceContext) {
  return [
    tool(
      "request_user_browser_action",
      "Request the user to perform an action in a browser that requires human interaction (e.g., logging in, completing OAuth flow, solving a CAPTCHA). " +
      "The agent will pause until the user completes the action and clicks Done. " +
      "Use this when automated testing hits an authentication wall or other human-required interaction.",
      {
        url: z.string().describe("The URL the user should navigate to"),
        instructions: z.string().describe("Clear instructions for what the user needs to do (e.g., 'Log in with your credentials and navigate to the dashboard')"),
        testCase: z.string().optional().describe("The test case context — what you're trying to test after the user completes this action"),
      },
      async ({ url, instructions, testCase }) => {
        try {
          // The agent-runner will receive this as a pending QA handoff via the streaming snapshot.
          // The frontend will display a QAHandoffPrompt to the user.
          // When the user responds, the backend sends the response back through the process channel.
          const response = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}/qa-handoff`,
            {
              method: "POST",
              headers: buildHeaders(true),
              body: JSON.stringify({ url, instructions, testCase }),
            }
          );

          if (!response.ok) {
            // If the endpoint doesn't exist yet, return a helpful message
            return {
              content: [{
                type: "text" as const,
                text: `QA handoff requested. Please ask the user to:\n\n1. Open: ${url}\n2. ${instructions}\n\nOnce done, they can continue the conversation.\n\n${testCase ? `Test context: ${testCase}` : ''}`,
              }],
            };
          }

          const result = await response.json();
          if (result.completed) {
            return {
              content: [{
                type: "text" as const,
                text: `User completed the browser action.${result.notes ? `\n\nUser notes: ${result.notes}` : ''}\n\nYou can now continue with: ${testCase || 'the test'}`,
              }],
            };
          } else {
            return {
              content: [{
                type: "text" as const,
                text: `User skipped the browser action.${result.notes ? `\n\nUser notes: ${result.notes}` : ''}\n\nYou may need to adjust your test approach.`,
              }],
            };
          }
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: `Error requesting QA handoff: ${formatFetchError(error)}.\n\nFallback: Please ask the user directly to open ${url} and ${instructions}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }
    ),
  ];
}
