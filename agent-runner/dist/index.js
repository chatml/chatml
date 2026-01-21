import { query, } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";
import { WorkspaceContext } from "./mcp/context.js";
import { createConductorMcpServer } from "./mcp/server.js";
function resolveToolPreset(preset) {
    switch (preset) {
        case "read-only":
            return { allowedTools: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"] };
        case "no-bash":
            return { disallowedTools: ["Bash"] };
        case "safe-edit":
            return { allowedTools: ["Read", "Glob", "Grep", "Edit", "WebFetch", "WebSearch"] };
        case "full":
        default:
            return {};
    }
}
// CLI arguments
const args = process.argv.slice(2);
const cwdIndex = args.indexOf("--cwd");
const conversationIdIndex = args.indexOf("--conversation-id");
const resumeIndex = args.indexOf("--resume");
const forkIndex = args.indexOf("--fork");
const cwd = cwdIndex !== -1 ? args[cwdIndex + 1] : process.cwd();
const conversationId = conversationIdIndex !== -1 ? args[conversationIdIndex + 1] : "default";
const resumeSessionId = resumeIndex !== -1 ? args[resumeIndex + 1] : undefined;
const forkSession = forkIndex !== -1;
const linearIssueIndex = args.indexOf("--linear-issue");
const toolPresetIndex = args.indexOf("--tool-preset");
const linearIssue = linearIssueIndex !== -1 ? args[linearIssueIndex + 1] : undefined;
const toolPreset = toolPresetIndex !== -1 ? args[toolPresetIndex + 1] : "full";
const enableCheckpointingIndex = args.indexOf("--enable-checkpointing");
const enableCheckpointing = enableCheckpointingIndex !== -1;
// Task 4: Structured Output Support
const structuredOutputIndex = args.indexOf("--structured-output");
const structuredOutputSchema = structuredOutputIndex !== -1 ? args[structuredOutputIndex + 1] : undefined;
// Parse schema if provided
let outputFormat;
if (structuredOutputSchema) {
    try {
        outputFormat = { type: 'json_schema', schema: JSON.parse(structuredOutputSchema) };
    }
    catch (e) {
        emit({ type: "warning", message: `Invalid structured output schema: ${e}` });
    }
}
// Task 5: Budget Controls
const maxBudgetIndex = args.indexOf("--max-budget-usd");
const maxTurnsIndex = args.indexOf("--max-turns");
const maxThinkingTokensIndex = args.indexOf("--max-thinking-tokens");
const maxBudgetUsd = maxBudgetIndex !== -1 ? parseFloat(args[maxBudgetIndex + 1]) : undefined;
const maxTurns = maxTurnsIndex !== -1 ? parseInt(args[maxTurnsIndex + 1], 10) : undefined;
const maxThinkingTokens = maxThinkingTokensIndex !== -1 ? parseInt(args[maxThinkingTokensIndex + 1], 10) : undefined;
// Task 6: Settings Sources Configuration
const settingSourcesIndex = args.indexOf("--setting-sources");
const settingSourcesArg = settingSourcesIndex !== -1 ? args[settingSourcesIndex + 1] : undefined;
const settingSources = settingSourcesArg
    ? settingSourcesArg.split(',').map(s => s.trim())
    : undefined;
// Task 7: Beta Features Flag
const betasIndex = args.indexOf("--betas");
const betasArg = betasIndex !== -1 ? args[betasIndex + 1] : undefined;
const betas = betasArg ? betasArg.split(',').map(s => s.trim()) : undefined;
// Task 8: Model Configuration
const modelIndex = args.indexOf("--model");
const fallbackModelIndex = args.indexOf("--fallback-model");
const model = modelIndex !== -1 ? args[modelIndex + 1] : undefined;
const fallbackModel = fallbackModelIndex !== -1 ? args[fallbackModelIndex + 1] : undefined;
function emit(event) {
    console.log(JSON.stringify(event));
}
// Track if we've suggested a name yet
let hasEmittedNameSuggestion = false;
let accumulatedText = "";
// Module-level readline interface for proper cleanup
let rl = null;
// Module-level query reference for runtime control
let queryRef = null;
// Track current session ID
let currentSessionId = undefined;
// Module-level references for cleanup
let abortControllerRef = null;
// Shutdown state
let isShuttingDown = false;
let cleanupCalled = false;
// Close readline interface if it exists
function closeReadline() {
    if (rl) {
        rl.close();
        rl = null;
    }
}
// Create async generator for streaming input mode
async function* createMessageStream() {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });
    try {
        for await (const line of rl) {
            if (!line.trim())
                continue;
            try {
                const input = JSON.parse(line);
                if (input.type === "stop") {
                    break;
                }
                // Handle runtime control commands
                if (input.type === "interrupt" && queryRef) {
                    await queryRef.interrupt();
                    emit({ type: "interrupted" });
                    continue;
                }
                if (input.type === "set_model" && queryRef && input.model) {
                    await queryRef.setModel(input.model);
                    emit({ type: "model_changed", model: input.model });
                    continue;
                }
                if (input.type === "set_permission_mode" && queryRef && input.permissionMode) {
                    await queryRef.setPermissionMode(input.permissionMode);
                    emit({ type: "permission_mode_changed", mode: input.permissionMode });
                    continue;
                }
                if (input.type === "get_supported_models" && queryRef) {
                    const models = await queryRef.supportedModels();
                    emit({ type: "supported_models", models });
                    continue;
                }
                if (input.type === "get_supported_commands" && queryRef) {
                    const commands = await queryRef.supportedCommands();
                    emit({ type: "supported_commands", commands });
                    continue;
                }
                if (input.type === "get_mcp_status" && queryRef) {
                    const status = await queryRef.mcpServerStatus();
                    emit({ type: "mcp_status", servers: status });
                    continue;
                }
                if (input.type === "get_account_info" && queryRef) {
                    const info = await queryRef.accountInfo();
                    emit({ type: "account_info", info });
                    continue;
                }
                if (input.type === "rewind_files" && input.checkpointUuid && queryRef) {
                    try {
                        await queryRef.rewindFiles(input.checkpointUuid);
                        emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid, success: true });
                    }
                    catch (error) {
                        emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid, success: false, error: String(error) });
                    }
                    continue;
                }
                if (input.type === "message" && input.content) {
                    yield {
                        type: "user",
                        message: {
                            role: "user",
                            content: input.content,
                        },
                        parent_tool_use_id: null,
                        session_id: currentSessionId || "",
                    };
                }
            }
            catch (err) {
                emit({ type: "error", message: `Failed to parse input: ${err}` });
            }
        }
    }
    finally {
        closeReadline();
    }
}
// Extract a suggested name from the first meaningful response
function extractNameSuggestion(text) {
    // Try to extract a concise task description from the text
    // Look for patterns like "I'll [action]" or "Let me [action]"
    const patterns = [
        /I'll\s+(.{10,50}?)(?:\.|,|$)/i,
        /I will\s+(.{10,50}?)(?:\.|,|$)/i,
        /Let me\s+(.{10,50}?)(?:\.|,|$)/i,
        /I'm going to\s+(.{10,50}?)(?:\.|,|$)/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            // Capitalize first letter and clean up
            let name = match[1].trim();
            name = name.charAt(0).toUpperCase() + name.slice(1);
            // Truncate if too long
            if (name.length > 40) {
                name = name.slice(0, 37) + "...";
            }
            return name;
        }
    }
    return null;
}
// Buffer for block-level streaming (emit on paragraph breaks)
let blockBuffer = "";
function processTextChunk(text) {
    blockBuffer += text;
    accumulatedText += text;
    // Emit complete blocks (separated by double newlines)
    const blocks = blockBuffer.split("\n\n");
    // Keep the last incomplete block in buffer
    blockBuffer = blocks.pop() || "";
    // Emit all complete blocks
    for (const block of blocks) {
        if (block.trim()) {
            emit({ type: "assistant_text", content: block + "\n\n" });
        }
    }
    // Try to suggest a name after accumulating some text
    if (!hasEmittedNameSuggestion && accumulatedText.length > 50) {
        const suggestedName = extractNameSuggestion(accumulatedText);
        if (suggestedName) {
            emit({ type: "name_suggestion", name: suggestedName });
            hasEmittedNameSuggestion = true;
        }
    }
}
function flushBlockBuffer() {
    if (blockBuffer.trim()) {
        emit({ type: "assistant_text", content: blockBuffer });
        blockBuffer = "";
    }
}
// Track active tool uses
const activeTools = new Map();
const runStats = {
    toolCalls: 0,
    toolsByType: {},
    subAgents: 0,
    filesRead: 0,
    filesWritten: 0,
    bashCommands: 0,
    webSearches: 0,
    totalToolDurationMs: 0,
};
function trackToolStart(toolName) {
    runStats.toolCalls++;
    runStats.toolsByType[toolName] = (runStats.toolsByType[toolName] || 0) + 1;
    // Track specific tool types
    if (toolName === "Task") {
        runStats.subAgents++;
    }
    else if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
        runStats.filesRead++;
    }
    else if (toolName === "Write" || toolName === "Edit") {
        runStats.filesWritten++;
    }
    else if (toolName === "Bash") {
        runStats.bashCommands++;
    }
    else if (toolName === "WebSearch" || toolName === "WebFetch") {
        runStats.webSearches++;
    }
}
function trackToolEnd(durationMs) {
    runStats.totalToolDurationMs += durationMs;
}
// ============================================================================
// HOOKS - All hooks are always enabled for comprehensive logging/tracking
// ============================================================================
const preToolUseHook = async (input, toolUseId) => {
    const hookInput = input;
    emit({
        type: "hook_pre_tool",
        toolUseId,
        tool: hookInput.tool_name,
        input: hookInput.tool_input,
        sessionId: hookInput.session_id,
    });
    return {}; // Allow all tools (no blocking)
};
const postToolUseHook = async (input, toolUseId) => {
    const hookInput = input;
    // Summarize tool response (truncate if too long)
    let responseSummary = hookInput.tool_response;
    if (typeof responseSummary === "string" && responseSummary.length > 200) {
        responseSummary = responseSummary.slice(0, 197) + "...";
    }
    emit({
        type: "hook_post_tool",
        toolUseId,
        tool: hookInput.tool_name,
        response: responseSummary,
        sessionId: hookInput.session_id,
    });
    return {};
};
const postToolUseFailureHook = async (input, toolUseId) => {
    const hookInput = input;
    emit({
        type: "hook_tool_failure",
        toolUseId,
        tool: hookInput.tool_name,
        error: hookInput.error,
        isInterrupt: hookInput.is_interrupt,
        sessionId: hookInput.session_id,
    });
    return {};
};
const notificationHook = async (input) => {
    const hookInput = input;
    emit({
        type: "agent_notification",
        title: hookInput.title,
        message: hookInput.message,
        notificationType: hookInput.notification_type,
        sessionId: hookInput.session_id,
    });
    return {};
};
const sessionStartHook = async (input) => {
    const hookInput = input;
    currentSessionId = hookInput.session_id;
    emit({
        type: "session_started",
        sessionId: hookInput.session_id,
        source: hookInput.source,
        cwd: hookInput.cwd,
    });
    return {};
};
const sessionEndHook = async (input) => {
    const hookInput = input;
    emit({
        type: "session_ended",
        reason: hookInput.reason,
        sessionId: hookInput.session_id,
    });
    return {};
};
const stopHook = async (input) => {
    const hookInput = input;
    emit({
        type: "agent_stop",
        stopHookActive: hookInput.stop_hook_active,
        sessionId: hookInput.session_id,
    });
    return {};
};
const subagentStartHook = async (input) => {
    const hookInput = input;
    emit({
        type: "subagent_started",
        agentId: hookInput.agent_id,
        agentType: hookInput.agent_type,
        sessionId: hookInput.session_id,
    });
    return {};
};
const subagentStopHook = async (input) => {
    const hookInput = input;
    emit({
        type: "subagent_stopped",
        agentId: hookInput.agent_id,
        stopHookActive: hookInput.stop_hook_active,
        transcriptPath: hookInput.agent_transcript_path,
        sessionId: hookInput.session_id,
    });
    return {};
};
// Hooks configuration - all always enabled
const hooks = {
    PreToolUse: [{ hooks: [preToolUseHook] }],
    PostToolUse: [{ hooks: [postToolUseHook] }],
    PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
    Notification: [{ hooks: [notificationHook] }],
    SessionStart: [{ hooks: [sessionStartHook] }],
    SessionEnd: [{ hooks: [sessionEndHook] }],
    Stop: [{ hooks: [stopHook] }],
    SubagentStart: [{ hooks: [subagentStartHook] }],
    SubagentStop: [{ hooks: [subagentStopHook] }],
};
// ============================================================================
// MAIN
// ============================================================================
async function main() {
    const abortController = new AbortController();
    abortControllerRef = abortController;
    emit({
        type: "ready",
        conversationId,
        cwd,
        resuming: !!resumeSessionId,
        forking: forkSession,
    });
    try {
        // Create workspace context for MCP tools
        const workspaceContext = new WorkspaceContext({
            cwd,
            workspaceId: conversationId, // Use conversation ID as workspace ID for now
            sessionId: currentSessionId || "pending",
            linearIssue,
        });
        // Create conductor MCP server
        const conductorMcp = createConductorMcpServer({ context: workspaceContext });
        // Resolve tool preset to allowedTools/disallowedTools
        const presetConfig = resolveToolPreset(toolPreset);
        const result = query({
            prompt: createMessageStream(),
            options: {
                cwd,
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                mcpServers: { conductor: conductorMcp },
                includePartialMessages: true,
                tools: { type: "preset", preset: "claude_code" },
                systemPrompt: { type: "preset", preset: "claude_code" },
                abortController,
                hooks,
                // Session management
                resume: resumeSessionId,
                forkSession: forkSession && !!resumeSessionId,
                // Tool preset configuration
                allowedTools: presetConfig.allowedTools,
                disallowedTools: presetConfig.disallowedTools,
                // File checkpointing
                enableFileCheckpointing: enableCheckpointing,
                // Task 4: Structured output
                outputFormat,
                // Task 5: Budget controls
                maxBudgetUsd,
                maxTurns,
                maxThinkingTokens,
                // Task 6: Settings sources
                settingSources,
                // Task 7: Beta features
                betas,
                // Task 8: Model configuration
                model,
                fallbackModel,
                // stderr callback for debugging
                stderr: (data) => {
                    emit({ type: "agent_stderr", data });
                },
            },
        });
        // Store query reference for runtime control
        queryRef = result;
        for await (const message of result) {
            handleMessage(message);
        }
        flushBlockBuffer();
        emit({ type: "complete", sessionId: currentSessionId });
    }
    catch (err) {
        closeReadline();
        emit({ type: "error", message: `${err}` });
        process.exit(1);
    }
}
function handleMessage(message) {
    // Extract session_id from any message that has it
    if ("session_id" in message && message.session_id) {
        if (!currentSessionId || currentSessionId !== message.session_id) {
            currentSessionId = message.session_id;
            emit({ type: "session_id_update", sessionId: currentSessionId });
        }
    }
    switch (message.type) {
        case "assistant": {
            // Full assistant message - extract content blocks
            // NOTE: We skip text blocks here because text is already handled
            // via stream_event -> content_block_delta during streaming.
            // Processing it here would cause duplicate content.
            const content = message.message.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === "thinking") {
                        // Thinking block - emit thinking event
                        emit({
                            type: "thinking",
                            content: block.thinking,
                        });
                    }
                    else if (block.type === "tool_use") {
                        // Tool use started
                        activeTools.set(block.id, {
                            tool: block.name,
                            startTime: Date.now(),
                        });
                        trackToolStart(block.name);
                        emit({
                            type: "tool_start",
                            id: block.id,
                            tool: block.name,
                            params: block.input,
                        });
                        // Emit TodoWrite events for real-time todo tracking
                        if (block.name === "TodoWrite") {
                            const input = block.input;
                            if (input?.todos) {
                                emit({
                                    type: "todo_update",
                                    id: block.id,
                                    todos: input.todos,
                                });
                            }
                        }
                    }
                }
            }
            break;
        }
        case "stream_event": {
            // Partial streaming message
            const event = message.event;
            if (event.type === "content_block_delta") {
                const delta = event.delta;
                if ("text" in delta && delta.text) {
                    processTextChunk(delta.text);
                }
                else if ("thinking" in delta && delta.thinking) {
                    // Streaming thinking content
                    emit({
                        type: "thinking_delta",
                        content: delta.thinking,
                    });
                }
            }
            else if (event.type === "content_block_start") {
                // Track when a thinking block starts
                const contentBlock = event.content_block;
                if (contentBlock?.type === "thinking") {
                    emit({ type: "thinking_start" });
                }
            }
            break;
        }
        case "user": {
            // Tool result or user message replay
            const content = message.message.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === "tool_result") {
                        const toolInfo = activeTools.get(block.tool_use_id);
                        if (toolInfo) {
                            const duration = Date.now() - toolInfo.startTime;
                            // Determine success from content
                            const isError = block.is_error === true;
                            let summary = "";
                            // Try to extract a summary from the result
                            if (typeof block.content === "string") {
                                summary = block.content.slice(0, 100);
                            }
                            else if (Array.isArray(block.content)) {
                                const textContent = block.content.find((c) => c.type === "text");
                                if (textContent && "text" in textContent) {
                                    summary = textContent.text.slice(0, 100);
                                }
                            }
                            trackToolEnd(duration);
                            emit({
                                type: "tool_end",
                                id: block.tool_use_id,
                                tool: toolInfo.tool,
                                success: !isError,
                                summary,
                                duration,
                            });
                            activeTools.delete(block.tool_use_id);
                        }
                    }
                }
            }
            // Check for checkpoint_uuid in user messages (present when checkpointing is enabled)
            // Type guard for SDK messages with checkpoint fields
            const msgWithCheckpoint = message;
            if (msgWithCheckpoint.checkpoint_uuid) {
                emit({
                    type: "checkpoint_created",
                    checkpointUuid: msgWithCheckpoint.checkpoint_uuid,
                    messageIndex: msgWithCheckpoint.message_index || 0,
                });
            }
            break;
        }
        case "result": {
            flushBlockBuffer();
            const resultMsg = message;
            // Check for checkpoint_uuid in result messages (present when checkpointing is enabled)
            // Type guard for SDK messages with checkpoint fields
            const resultWithCheckpoint = message;
            if (resultWithCheckpoint.checkpoint_uuid) {
                emit({
                    type: "checkpoint_created",
                    checkpointUuid: resultWithCheckpoint.checkpoint_uuid,
                    messageIndex: resultWithCheckpoint.message_index || 0,
                    isResult: true,
                });
            }
            if (resultMsg.subtype === "success") {
                emit({
                    type: "result",
                    success: true,
                    subtype: "success",
                    summary: resultMsg.result,
                    cost: resultMsg.total_cost_usd,
                    turns: resultMsg.num_turns,
                    durationMs: resultMsg.duration_ms,
                    durationApiMs: resultMsg.duration_api_ms,
                    usage: resultMsg.usage,
                    modelUsage: resultMsg.modelUsage,
                    structuredOutput: resultMsg.structured_output,
                    sessionId: resultMsg.session_id,
                    stats: {
                        toolCalls: runStats.toolCalls,
                        toolsByType: runStats.toolsByType,
                        subAgents: runStats.subAgents,
                        filesRead: runStats.filesRead,
                        filesWritten: runStats.filesWritten,
                        bashCommands: runStats.bashCommands,
                        webSearches: runStats.webSearches,
                        totalToolDurationMs: runStats.totalToolDurationMs,
                    },
                });
            }
            else {
                // Handle all error subtypes: error_during_execution, error_max_turns,
                // error_max_budget_usd, error_max_structured_output_retries
                emit({
                    type: "result",
                    success: false,
                    subtype: resultMsg.subtype,
                    errors: "errors" in resultMsg ? resultMsg.errors : [],
                    cost: resultMsg.total_cost_usd,
                    turns: resultMsg.num_turns,
                    durationMs: resultMsg.duration_ms,
                    durationApiMs: resultMsg.duration_api_ms,
                    usage: resultMsg.usage,
                    modelUsage: resultMsg.modelUsage,
                    sessionId: resultMsg.session_id,
                    stats: {
                        toolCalls: runStats.toolCalls,
                        toolsByType: runStats.toolsByType,
                        subAgents: runStats.subAgents,
                        filesRead: runStats.filesRead,
                        filesWritten: runStats.filesWritten,
                        bashCommands: runStats.bashCommands,
                        webSearches: runStats.webSearches,
                        totalToolDurationMs: runStats.totalToolDurationMs,
                    },
                });
            }
            break;
        }
        case "system": {
            const sysMsg = message;
            if (sysMsg.subtype === "init") {
                const initMsg = sysMsg;
                emit({
                    type: "init",
                    model: initMsg.model,
                    tools: initMsg.tools,
                    mcpServers: initMsg.mcp_servers,
                    slashCommands: initMsg.slash_commands,
                    skills: initMsg.skills,
                    plugins: initMsg.plugins,
                    agents: initMsg.agents,
                    permissionMode: initMsg.permissionMode,
                    claudeCodeVersion: initMsg.claude_code_version,
                    apiKeySource: initMsg.apiKeySource,
                    betas: initMsg.betas,
                    outputStyle: initMsg.output_style,
                    sessionId: initMsg.session_id,
                    cwd: initMsg.cwd,
                    // Budget configuration passed from CLI args
                    budgetConfig: {
                        maxBudgetUsd,
                        maxTurns,
                        maxThinkingTokens,
                    },
                });
                currentSessionId = initMsg.session_id;
            }
            else if (sysMsg.subtype === "compact_boundary") {
                const compactMsg = sysMsg;
                emit({
                    type: "compact_boundary",
                    trigger: compactMsg.compact_metadata.trigger,
                    preTokens: compactMsg.compact_metadata.pre_tokens,
                    sessionId: compactMsg.session_id,
                });
            }
            else if (sysMsg.subtype === "status") {
                const statusMsg = sysMsg;
                emit({
                    type: "status_update",
                    status: statusMsg.status,
                    sessionId: statusMsg.session_id,
                });
            }
            else if (sysMsg.subtype === "hook_response") {
                const hookMsg = sysMsg;
                emit({
                    type: "hook_response",
                    hookName: hookMsg.hook_name,
                    hookEvent: hookMsg.hook_event,
                    stdout: hookMsg.stdout,
                    stderr: hookMsg.stderr,
                    exitCode: hookMsg.exit_code,
                    sessionId: hookMsg.session_id,
                });
            }
            break;
        }
        case "tool_progress": {
            const progressMsg = message;
            emit({
                type: "tool_progress",
                toolUseId: progressMsg.tool_use_id,
                toolName: progressMsg.tool_name,
                elapsedTimeSeconds: progressMsg.elapsed_time_seconds,
                parentToolUseId: progressMsg.parent_tool_use_id,
                sessionId: progressMsg.session_id,
            });
            break;
        }
        case "auth_status": {
            const authMsg = message;
            emit({
                type: "auth_status",
                isAuthenticating: authMsg.isAuthenticating,
                output: authMsg.output,
                error: authMsg.error,
                sessionId: authMsg.session_id,
            });
            break;
        }
    }
}
// Async cleanup function for graceful shutdown
async function cleanup(reason) {
    // Idempotency guard - prevent duplicate cleanup
    if (cleanupCalled)
        return;
    cleanupCalled = true;
    // 1. Signal abort to cancel pending operations
    if (abortControllerRef) {
        abortControllerRef.abort();
    }
    // 2. Interrupt the query if active
    if (queryRef) {
        try {
            await queryRef.interrupt();
        }
        catch {
            // Ignore errors during shutdown
        }
    }
    // 3. Close readline
    closeReadline();
    // 4. Emit shutdown event
    emit({ type: "shutdown", reason });
}
// Handle graceful shutdown
process.on("SIGTERM", () => {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    cleanup("SIGTERM").finally(() => process.exit(0));
});
process.on("SIGINT", () => {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    cleanup("SIGINT").finally(() => process.exit(0));
});
main().catch(async (err) => {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    await cleanup("error");
    emit({ type: "error", message: `Unhandled error: ${err}` });
    process.exit(1);
});
