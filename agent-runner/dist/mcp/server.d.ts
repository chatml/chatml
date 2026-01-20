import { WorkspaceContext } from "./context.js";
export interface McpServerOptions {
    context: WorkspaceContext;
}
export declare function createConductorMcpServer(options: McpServerOptions): import("@anthropic-ai/claude-agent-sdk").McpSdkServerConfigWithInstance;
