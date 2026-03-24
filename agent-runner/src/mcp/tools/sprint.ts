// agent-runner/src/mcp/tools/sprint.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WorkspaceContext } from "../context.js";
import { fetchWithRetry, formatFetchError, buildHeaders, BACKEND_URL } from "./fetch-utils.js";

// Sprint phase definitions — keep in sync with:
//   backend/models/types.go (ValidSprintPhases)
//   backend/server/conversation_handlers.go (sprintPhaseInstructions)
//   src/lib/session-fields.ts (SPRINT_PHASE_OPTIONS)
//   src/lib/types.ts (SprintPhase, SPRINT_PHASES)
const SPRINT_PHASES = ["think", "plan", "build", "review", "test", "ship", "reflect"] as const;

const PHASE_DESCRIPTIONS: Record<string, string> = {
  think: "Challenge assumptions and explore alternatives before committing to an approach",
  plan: "Create a detailed implementation plan with clear steps and verification criteria",
  build: "Implement the approved plan — write code and tests, focus on correctness",
  review: "Review all changes critically — look for bugs, edge cases, and code quality issues",
  test: "Run the test suite, verify edge cases, and check coverage",
  ship: "Prepare for merge — commit changes, push to remote, and create a pull request",
  reflect: "Summarize what was accomplished, lessons learned, and potential follow-up work",
};

const NEXT_PHASE: Record<string, string | null> = {
  think: "plan",
  plan: "build",
  build: "review",
  review: "test",
  test: "ship",
  ship: "reflect",
  reflect: null,
};

export function createSprintTools(context: WorkspaceContext) {
  return [
    tool(
      "get_sprint_context",
      "Get the current sprint phase and expectations for this session. Use this to understand what phase you're in and what's expected.",
      {},
      async () => {
        try {
          const res = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}`,
            { headers: buildHeaders() }
          );

          if (!res.ok) {
            const text = await res.text();
            return {
              content: [{
                type: "text" as const,
                text: `Failed to get session: ${res.status} ${text}`,
              }],
            };
          }

          const session = await res.json();
          const phase = session.sprintPhase || null;

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                phase,
                description: phase ? PHASE_DESCRIPTIONS[phase] : "No sprint active",
                nextPhase: phase ? NEXT_PHASE[phase] : null,
                availablePhases: SPRINT_PHASES,
              }, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: `Error getting sprint context: ${formatFetchError(error)}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      "update_sprint_phase",
      "Propose advancing the sprint phase. Requires user approval. Use when you believe the current phase work is complete and it's time to move to the next phase.",
      {
        phase: z.enum(["think", "plan", "build", "review", "test", "ship", "reflect"])
          .describe("The sprint phase to advance to"),
        reason: z.string()
          .describe("Why this phase transition is appropriate — what work was completed"),
      },
      async ({ phase, reason }) => {
        // The PreToolUse hook handles approval. If we reach here, user approved.
        try {
          const res = await fetchWithRetry(
            `${BACKEND_URL}/api/repos/${context.workspaceId}/sessions/${context.sessionId}`,
            {
              method: "PATCH",
              headers: buildHeaders(true),
              body: JSON.stringify({ sprintPhase: phase }),
            }
          );

          if (!res.ok) {
            const text = await res.text();
            return {
              content: [{
                type: "text" as const,
                text: `Failed to update sprint phase: ${res.status} ${text}`,
              }],
            };
          }

          const description = PHASE_DESCRIPTIONS[phase] || "";
          const nextPhase = NEXT_PHASE[phase];
          return {
            content: [{
              type: "text" as const,
              text: `Sprint phase updated to "${phase}". ${reason}\n\n## Phase Instructions: ${phase}\n${description}\n${nextPhase ? `\nNext phase: ${nextPhase}` : "\nThis is the final phase."}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: `Error updating sprint phase: ${formatFetchError(error)}`,
            }],
          };
        }
      },
      { annotations: { readOnlyHint: false } }
    ),
  ];
}
