// agent-runner/src/mcp/tools/scripts.ts
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { WorkspaceContext } from "../context.js";

const CONFIG_DIR = ".chatml";
const CONFIG_FILE = "config.json";

interface ScriptDef {
  name: string;
  command: string;
}

interface ChatMLConfig {
  setupScripts: ScriptDef[];
  runScripts: Record<string, ScriptDef>;
  hooks: Record<string, string>;
  autoSetup: boolean;
}

export function createScriptTools(context: WorkspaceContext) {
  // Returns the workspace root where .chatml/config.json lives.
  // Currently uses context.cwd directly — the backend places the config in the
  // workspace root, and worktrees are expected to have it copied/symlinked.
  // TODO: If worktrees don't have the config, add parent directory traversal
  // or pass the workspace root explicitly via WorkspaceContext.
  function getWorkspaceRoot(): string {
    return context.cwd;
  }

  return [
    tool(
      "get_workspace_scripts_config",
      "Read the .chatml/config.json file that defines setup scripts, run scripts, and hooks for this project",
      {},
      async () => {
        const root = getWorkspaceRoot();
        const configPath = join(root, CONFIG_DIR, CONFIG_FILE);

        if (!existsSync(configPath)) {
          return {
            content: [{
              type: "text" as const,
              text: "No .chatml/config.json found. You can create one to define setup scripts, run scripts, and hooks for this project.",
            }],
          };
        }

        try {
          const data = readFileSync(configPath, "utf-8");
          const config: ChatMLConfig = JSON.parse(data);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(config, null, 2),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text" as const,
              text: `Error reading config: ${error}`,
            }],
          };
        }
      }
    ),

    tool(
      "propose_scripts_config",
      "Propose a .chatml/config.json configuration for this project. Present the config to the user in chat for approval before writing.",
      {
        setupScripts: z.array(z.object({
          name: z.string().describe("Human-readable name for the script"),
          command: z.string().describe("Shell command to run"),
        })).optional().describe("Scripts to run when setting up a new session"),
        runScripts: z.record(z.object({
          name: z.string().describe("Human-readable name"),
          command: z.string().describe("Shell command to run"),
        })).optional().describe("Named scripts that can be run on-demand (key is the script ID)"),
        hooks: z.record(z.string()).optional().describe("Lifecycle hooks (pre-session, post-session, post-merge)"),
        autoSetup: z.boolean().optional().describe("Whether to auto-run setup scripts on session creation"),
      },
      async ({ setupScripts, runScripts, hooks, autoSetup }) => {
        const config: ChatMLConfig = {
          setupScripts: setupScripts || [],
          runScripts: runScripts || {},
          hooks: hooks || {},
          autoSetup: autoSetup ?? true,
        };

        // Return the config for the agent to present to the user
        // The agent should show this in chat and ask for confirmation before writing
        return {
          content: [{
            type: "text" as const,
            text: `Proposed .chatml/config.json:\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n\nPresent this to the user and ask them to approve before writing it to .chatml/config.json using the Write tool.`,
          }],
        };
      }
    ),
  ];
}
