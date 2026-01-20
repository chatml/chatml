import { z } from "zod";
import type { WorkspaceContext } from "../context.js";
export declare function createLinearTools(context: WorkspaceContext): (import("@anthropic-ai/claude-agent-sdk").SdkMcpToolDefinition<{}> | import("@anthropic-ai/claude-agent-sdk").SdkMcpToolDefinition<{
    issueId: z.ZodString;
}> | import("@anthropic-ai/claude-agent-sdk").SdkMcpToolDefinition<{
    state: z.ZodString;
}>)[];
