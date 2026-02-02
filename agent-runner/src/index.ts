import {
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKCompactBoundaryMessage,
  type SDKStatusMessage,
  type SDKHookResponseMessage,
  type SDKToolProgressMessage,
  type SDKAuthStatusMessage,
  type Query,
  type HookCallback,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  type NotificationHookInput,
  type SessionStartHookInput,
  type SessionEndHookInput,
  type SubagentStartHookInput,
  type SubagentStopHookInput,
  type PostToolUseFailureHookInput,
  type StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";
import { WorkspaceContext } from "./mcp/context.js";
import { createChatMLMcpServer } from "./mcp/server.js";

function resolveToolPreset(preset: string): { allowedTools?: string[]; disallowedTools?: string[] } {
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

// Safe arg getter: returns the value after a flag, or undefined if missing/out of bounds
function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return args.indexOf(flag) !== -1;
}

function getNumericArg(flag: string): number | undefined {
  const val = getArg(flag);
  if (val === undefined) return undefined;
  // Always use parseFloat — integer values parse fine with it, and this avoids
  // a fragile heuristic for deciding float vs int based on flag name.
  const num = parseFloat(val);
  if (isNaN(num)) {
    console.error(`Invalid numeric value for ${flag}: "${val}". Ignoring.`);
    return undefined;
  }
  return num;
}

const cwd = getArg("--cwd") || process.cwd();
const conversationId = getArg("--conversation-id") || "default";
const resumeSessionId = getArg("--resume");
const forkSession = hasFlag("--fork");

const linearIssue = getArg("--linear-issue");
const toolPreset = (getArg("--tool-preset") || "full") as "full" | "read-only" | "no-bash" | "safe-edit";
const enableCheckpointing = hasFlag("--enable-checkpointing");

// Task 4: Structured Output Support
const structuredOutputSchema = getArg("--structured-output");

// Parse schema if provided
let outputFormat: { type: 'json_schema'; schema: Record<string, unknown> } | undefined;
if (structuredOutputSchema) {
  try {
    outputFormat = { type: 'json_schema', schema: JSON.parse(structuredOutputSchema) as Record<string, unknown> };
  } catch (e) {
    // Log to stderr since emit() before ready event may confuse the Go parser
    console.error(`Invalid structured output schema: ${e}`);
  }
}

// Target branch for PR base and sync operations
const targetBranch = getArg("--target-branch");

// Task 5: Budget Controls
const maxBudgetUsd = getNumericArg("--max-budget-usd");
const maxTurns = getNumericArg("--max-turns");
const maxThinkingTokens = getNumericArg("--max-thinking-tokens");

// Permission mode (e.g., "plan" for plan mode at startup)
const validPermissionModes = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"] as const;
type PermissionMode = typeof validPermissionModes[number];
let initialPermissionMode: PermissionMode = "bypassPermissions";
{
  const value = getArg("--permission-mode");
  if (value) {
    if ((validPermissionModes as readonly string[]).includes(value)) {
      initialPermissionMode = value as PermissionMode;
    } else {
      console.error(`Invalid --permission-mode value: "${value}". Using default "bypassPermissions".`);
    }
  }
}

// Task 6: Settings Sources Configuration
const settingSourcesArg = getArg("--setting-sources");
const settingSources = settingSourcesArg
  ? settingSourcesArg.split(',').map(s => s.trim()) as ('project' | 'user' | 'local')[]
  : undefined;

// Task 7: Beta Features Flag
const betasArg = getArg("--betas");
const betas = betasArg ? betasArg.split(',').map(s => s.trim()) as ("context-1m-2025-08-07")[] : undefined;

// Task 8: Model Configuration
const model = getArg("--model");
const fallbackModel = getArg("--fallback-model");

// Instructions (e.g., from conversation summaries)
import { readFileSync } from "fs";
let instructions: string | undefined;
{
  const instructionsFilePath = getArg("--instructions-file");
  if (instructionsFilePath) {
    try {
      instructions = readFileSync(instructionsFilePath, "utf-8");
    } catch (e) {
      // Log to stderr since emit() may not be safe before ready event
      console.error(`Failed to read instructions file: ${e}`);
    }
  }
}

// Output event types for Go backend
interface OutputEvent {
  type: string;
  [key: string]: unknown;
}

function emit(event: OutputEvent): void {
  console.log(JSON.stringify(event));
}

// Attachment type matching Go backend
interface Attachment {
  id: string;
  type: "file" | "image";
  name: string;
  path?: string;
  mimeType: string;
  size: number;
  lineCount?: number;
  width?: number;
  height?: number;
  base64Data?: string;
  preview?: string;
}

// Input message types from Go backend
interface InputMessage {
  type: "message" | "stop" | "interrupt" | "set_model" | "set_permission_mode" | "get_supported_models" | "get_supported_commands" | "get_mcp_status" | "get_account_info" | "rewind_files" | "user_question_response";
  content?: string;
  model?: string;
  permissionMode?: string;
  checkpointUuid?: string; // For rewind_files
  attachments?: Attachment[]; // File attachments
  // User question response fields
  questionRequestId?: string;
  answers?: Record<string, string>;
}

// Escape a string for use in XML attribute values
function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Track if we've suggested a name yet
let hasEmittedNameSuggestion = false;
let accumulatedText = "";

// Module-level readline interface for proper cleanup
let rl: readline.Interface | null = null;

// Module-level query reference for runtime control
let queryRef: Query | null = null;

// Track current session ID
let currentSessionId: string | undefined = undefined;

// Pending user question requests (for AskUserQuestion tool)
const ASK_USER_QUESTION_HOOK_TIMEOUT_S = 86400; // 24 hours — lets users take as long as they need

interface PendingQuestionRequest {
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}
const pendingQuestionRequests = new Map<string, PendingQuestionRequest>();
let questionRequestCounter = 0;

// Module-level references for cleanup
let abortControllerRef: AbortController | null = null;

// Shutdown state
let isShuttingDown = false;
let cleanupCalled = false;
// Multi-turn loop control: set to false to break the main loop
let mainLoopRunning = false;
// Pending model change queued between turns (applied on next query start)
let pendingModel: string | undefined;

// Debug logging (enabled via CHATML_DEBUG=1 env var)
const debugEnabled = process.env.CHATML_DEBUG === "1";
function debug(msg: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  const ts = new Date().toISOString();
  console.error(`[DEBUG ${ts}] ${msg}`, ...args);
}

// Close readline interface if it exists
function closeReadline(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

// ============================================================================
// EVENT-DRIVEN INPUT QUEUE
// Replaces the async generator with a queue that decouples stdin reading
// from SDK message feeding. Runtime control commands are handled inline.
// ============================================================================

interface QueuedMessage {
  content: string;
  attachments?: Attachment[];
}

// Input queue for "message" type inputs (queued for the next turn)
const messageQueue: QueuedMessage[] = [];
// Resolver for waitForNextMessage — set when waiting, cleared when resolved
let messageWaiter: ((msg: QueuedMessage | null) => void) | null = null;
// Whether stdin has been closed (signals end of input)
let stdinClosed = false;

function setupInputQueue(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", (line: string) => {
    if (!line.trim()) return;

    try {
      const input: InputMessage = JSON.parse(line);
      debug(`Input received: type=${input.type}, content=${(input.content || "").slice(0, 50)}`);

      if (input.type === "stop") {
        debug("Stop command received, breaking main loop");
        mainLoopRunning = false;
        // Resolve any pending waiter with null to unblock
        if (messageWaiter) {
          messageWaiter(null);
          messageWaiter = null;
        }
        return;
      }

      // Handle runtime control commands that execute immediately
      if (input.type === "interrupt") {
        if (queryRef) {
          debug("Interrupting active query");
          void queryRef.interrupt().then(() => {
            emit({ type: "interrupted" });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "interrupt", error: String(cmdErr) });
          });
        } else {
          debug("Interrupt received but no active query");
          emit({ type: "interrupted" });
        }
        return;
      }

      if (input.type === "set_model" && input.model) {
        if (queryRef) {
          debug(`Setting model on active query: ${input.model}`);
          void queryRef.setModel(input.model).then(() => {
            emit({ type: "model_changed", model: input.model! });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "set_model", error: String(cmdErr) });
          });
        } else {
          // Queue model change — will be applied when next query starts
          debug(`Model change queued (between turns): ${input.model}`);
          pendingModel = input.model;
          emit({ type: "model_changed", model: input.model });
        }
        return;
      }

      if (input.type === "set_permission_mode" && input.permissionMode) {
        if (queryRef) {
          debug(`Setting permission mode: ${input.permissionMode}`);
          void queryRef.setPermissionMode(input.permissionMode as "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk").then(() => {
            emit({ type: "permission_mode_changed", mode: input.permissionMode! });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "set_permission_mode", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "set_permission_mode", error: "No active query" });
        }
        return;
      }

      if (input.type === "get_supported_models") {
        if (queryRef) {
          void queryRef.supportedModels().then((models: unknown) => {
            emit({ type: "supported_models", models });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "get_supported_models", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "get_supported_models", error: "No active query" });
        }
        return;
      }

      if (input.type === "get_supported_commands") {
        if (queryRef) {
          void queryRef.supportedCommands().then((commands: unknown) => {
            emit({ type: "supported_commands", commands });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "get_supported_commands", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "get_supported_commands", error: "No active query" });
        }
        return;
      }

      if (input.type === "get_mcp_status") {
        if (queryRef) {
          void queryRef.mcpServerStatus().then((status: unknown) => {
            emit({ type: "mcp_status", servers: status });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "get_mcp_status", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "get_mcp_status", error: "No active query" });
        }
        return;
      }

      if (input.type === "get_account_info") {
        if (queryRef) {
          void queryRef.accountInfo().then((info: unknown) => {
            emit({ type: "account_info", info });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "get_account_info", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "get_account_info", error: "No active query" });
        }
        return;
      }

      if (input.type === "rewind_files" && input.checkpointUuid) {
        if (queryRef) {
          void queryRef.rewindFiles(input.checkpointUuid).then(() => {
            emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid!, success: true });
          }).catch((error: unknown) => {
            emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid!, success: false, error: String(error) });
          });
        } else {
          emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid, success: false, error: "No active query" });
        }
        return;
      }

      // Handle user question responses from the Go backend
      if (input.type === "user_question_response" && input.questionRequestId && input.answers) {
        const pending = pendingQuestionRequests.get(input.questionRequestId);
        if (pending) {
          pendingQuestionRequests.delete(input.questionRequestId);
          if (input.answers.__cancelled === "true") {
            pending.reject(new Error("User cancelled the question"));
          } else {
            pending.resolve(input.answers);
          }
        } else {
          emit({
            type: "warning",
            message: `Received response for unknown question request: ${input.questionRequestId}`,
          });
        }
        return;
      }

      // Queue "message" type inputs for the next turn
      if (input.type === "message" && input.content) {
        const queued: QueuedMessage = {
          content: input.content,
          attachments: input.attachments,
        };

        // If someone is waiting for a message, resolve immediately
        if (messageWaiter) {
          const waiter = messageWaiter;
          messageWaiter = null;
          waiter(queued);
        } else {
          messageQueue.push(queued);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      emit({
        type: "json_parse_error",
        message: `Failed to parse input: ${errorMessage}`,
        rawInput: line.length > 1000 ? line.slice(0, 1000) + "...[truncated]" : line,
        errorDetails: errorMessage,
      });
    }
  });

  rl.on("close", () => {
    debug("Stdin closed (readline 'close' event)");
    stdinClosed = true;
    mainLoopRunning = false;
    // Resolve any pending waiter with null to unblock
    if (messageWaiter) {
      messageWaiter(null);
      messageWaiter = null;
    }
  });
}

// Wait for the next "message" type input. Returns null if stdin closes or stop is received.
function waitForNextMessage(): Promise<QueuedMessage | null> {
  // Check queue first
  if (messageQueue.length > 0) {
    return Promise.resolve(messageQueue.shift()!);
  }
  // Check if we should stop
  if (stdinClosed || !mainLoopRunning) {
    return Promise.resolve(null);
  }
  // Wait for next message
  return new Promise((resolve) => {
    messageWaiter = resolve;
  });
}

// Build prompt for a queued message.
// For plain text: returns the string directly (used as query prompt).
// For messages with attachments: returns a single-yield async generator
// (the V1 SDK only accepts string | AsyncIterable<SDKUserMessage> for prompt).
function buildPrompt(msg: QueuedMessage): string | AsyncIterable<SDKUserMessage> {
  if (!msg.attachments || msg.attachments.length === 0) {
    return msg.content;
  }

  // Build multipart content blocks
  const contentBlocks: Array<{type: string; [key: string]: unknown}> = [];

  if (msg.content) {
    contentBlocks.push({ type: "text", text: msg.content });
  }

  for (const attachment of msg.attachments) {
    if (attachment.type === "image" && attachment.base64Data) {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachment.base64Data,
        }
      });
    } else if (attachment.base64Data) {
      let content = Buffer.from(attachment.base64Data, "base64").toString("utf-8");
      content = content.replace(/<\/attached_file>/g, "&lt;/attached_file&gt;");
      const lineInfo = attachment.lineCount ? ` lines="${attachment.lineCount}"` : "";
      const pathInfo = attachment.path ? ` path="${escapeXmlAttr(attachment.path)}"` : "";
      contentBlocks.push({
        type: "text",
        text: `<attached_file name="${escapeXmlAttr(attachment.name)}"${pathInfo}${lineInfo}>\n${content}\n</attached_file>`
      });
    }
  }

  // Return a single-yield async generator for multipart content
  async function* singleMessage(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: contentBlocks,
      },
      parent_tool_use_id: null,
      session_id: currentSessionId || "",
    } as SDKUserMessage;
  }
  return singleMessage();
}

// Extract a suggested name from the first meaningful response
function extractNameSuggestion(text: string): string | null {
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
const BLOCK_BUFFER_MAX_SIZE = 4096; // Flush even without paragraph break to ensure progressive rendering

function processTextChunk(text: string): void {
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

  // Force flush if buffer exceeds max size (e.g., large code blocks without paragraph breaks)
  if (blockBuffer.length > BLOCK_BUFFER_MAX_SIZE) {
    emit({ type: "assistant_text", content: blockBuffer });
    blockBuffer = "";
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

function flushBlockBuffer(): void {
  if (blockBuffer.trim()) {
    emit({ type: "assistant_text", content: blockBuffer });
    blockBuffer = "";
  }
}

// Track active tool uses
const activeTools = new Map<string, { tool: string; startTime: number }>();

// Track sub-agent session → agentId mapping for correlating hook events
const sessionToAgentId = new Map<string, string>();
// Track sub-agent active tools (keyed by toolUseId)
const subagentActiveTools = new Map<string, { agentId: string; tool: string; startTime: number }>();

// Track statistics for the run
interface RunStats {
  toolCalls: number;
  toolsByType: Record<string, number>;
  subAgents: number;
  filesRead: number;
  filesWritten: number;
  bashCommands: number;
  webSearches: number;
  totalToolDurationMs: number;
}

const runStats: RunStats = {
  toolCalls: 0,
  toolsByType: {},
  subAgents: 0,
  filesRead: 0,
  filesWritten: 0,
  bashCommands: 0,
  webSearches: 0,
  totalToolDurationMs: 0,
};

function trackToolStart(toolName: string): void {
  runStats.toolCalls++;
  runStats.toolsByType[toolName] = (runStats.toolsByType[toolName] || 0) + 1;

  // Track specific tool types
  if (toolName === "Task") {
    runStats.subAgents++;
  } else if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
    runStats.filesRead++;
  } else if (toolName === "Write" || toolName === "Edit") {
    runStats.filesWritten++;
  } else if (toolName === "Bash") {
    runStats.bashCommands++;
  } else if (toolName === "WebSearch" || toolName === "WebFetch") {
    runStats.webSearches++;
  }
}

function trackToolEnd(durationMs: number): void {
  runStats.totalToolDurationMs += durationMs;
}

// ============================================================================
// HOOKS - All hooks are always enabled for comprehensive logging/tracking
// ============================================================================

const preToolUseHook: HookCallback = async (input, toolUseId) => {
  const hookInput = input as PreToolUseHookInput;
  const agentId = sessionToAgentId.get(hookInput.session_id);

  emit({
    type: "hook_pre_tool",
    toolUseId,
    tool: hookInput.tool_name,
    input: hookInput.tool_input,
    sessionId: hookInput.session_id,
  });

  // If this is a sub-agent tool, emit a tool_start event with agentId
  if (agentId && toolUseId) {
    subagentActiveTools.set(toolUseId, {
      agentId,
      tool: hookInput.tool_name,
      startTime: Date.now(),
    });
    emit({
      type: "tool_start",
      id: toolUseId,
      tool: hookInput.tool_name,
      params: hookInput.tool_input,
      agentId,
    });
  }

  return {}; // Allow all tools (no blocking)
};

const postToolUseHook: HookCallback = async (input, toolUseId) => {
  const hookInput = input as PostToolUseHookInput;
  // Summarize tool response (truncate if too long)
  let responseSummary: unknown = hookInput.tool_response;
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

  // If this is a sub-agent tool, emit a tool_end event with agentId
  if (toolUseId) {
    const subTool = subagentActiveTools.get(toolUseId);
    if (subTool) {
      const duration = Date.now() - subTool.startTime;
      const summary = typeof responseSummary === "string" ? responseSummary.slice(0, 100) : "";
      emit({
        type: "tool_end",
        id: toolUseId,
        tool: subTool.tool,
        success: true,
        summary,
        duration,
        agentId: subTool.agentId,
      });
      subagentActiveTools.delete(toolUseId);
    }
  }

  return {};
};

const postToolUseFailureHook: HookCallback = async (input, toolUseId) => {
  const hookInput = input as PostToolUseFailureHookInput;
  emit({
    type: "hook_tool_failure",
    toolUseId,
    tool: hookInput.tool_name,
    error: hookInput.error,
    isInterrupt: hookInput.is_interrupt,
    sessionId: hookInput.session_id,
  });

  // If this is a sub-agent tool, emit a tool_end event with success: false
  if (toolUseId) {
    const subTool = subagentActiveTools.get(toolUseId);
    if (subTool) {
      const duration = Date.now() - subTool.startTime;
      const errorMsg = typeof hookInput.error === "string" ? hookInput.error.slice(0, 100) : "Tool failed";
      emit({
        type: "tool_end",
        id: toolUseId,
        tool: subTool.tool,
        success: false,
        summary: errorMsg,
        duration,
        agentId: subTool.agentId,
      });
      subagentActiveTools.delete(toolUseId);
    }
  }

  return {};
};

const notificationHook: HookCallback = async (input) => {
  const hookInput = input as NotificationHookInput;
  emit({
    type: "agent_notification",
    title: hookInput.title,
    message: hookInput.message,
    notificationType: hookInput.notification_type,
    sessionId: hookInput.session_id,
  });
  return {};
};

const sessionStartHook: HookCallback = async (input) => {
  const hookInput = input as SessionStartHookInput;
  currentSessionId = hookInput.session_id;
  emit({
    type: "session_started",
    sessionId: hookInput.session_id,
    source: hookInput.source,
    cwd: hookInput.cwd,
  });
  return {};
};

const sessionEndHook: HookCallback = async (input) => {
  const hookInput = input as SessionEndHookInput;
  emit({
    type: "session_ended",
    reason: hookInput.reason,
    sessionId: hookInput.session_id,
  });
  return {};
};

const stopHook: HookCallback = async (input) => {
  const hookInput = input as StopHookInput;
  emit({
    type: "agent_stop",
    stopHookActive: hookInput.stop_hook_active,
    sessionId: hookInput.session_id,
  });
  return {};
};

const subagentStartHook: HookCallback = async (input) => {
  const hookInput = input as SubagentStartHookInput;
  // Register session → agentId mapping for correlating sub-agent tool events
  sessionToAgentId.set(hookInput.session_id, hookInput.agent_id);

  // Find the parent "Task" tool_use that spawned this sub-agent.
  // Map iteration is in insertion order, so we keep overwriting to get the
  // most recently inserted (i.e. most recent) active Task tool.
  let parentToolUseId: string | undefined;
  for (const [toolId, info] of activeTools) {
    if (info.tool === "Task") {
      parentToolUseId = toolId;
    }
  }

  emit({
    type: "subagent_started",
    agentId: hookInput.agent_id,
    agentType: hookInput.agent_type,
    sessionId: hookInput.session_id,
    parentToolUseId,
  });
  return {};
};

const subagentStopHook: HookCallback = async (input) => {
  const hookInput = input as SubagentStopHookInput;
  // Clean up session → agentId mapping
  sessionToAgentId.delete(hookInput.session_id);
  // Clean up any lingering sub-agent tools
  for (const [toolId, info] of subagentActiveTools) {
    if (info.agentId === hookInput.agent_id) {
      subagentActiveTools.delete(toolId);
    }
  }
  emit({
    type: "subagent_stopped",
    agentId: hookInput.agent_id,
    stopHookActive: hookInput.stop_hook_active,
    transcriptPath: hookInput.agent_transcript_path,
    sessionId: hookInput.session_id,
  });
  return {};
};

// ============================================================================
// ASK USER QUESTION - PreToolUse Hook Handler
// ============================================================================

interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
  answers?: Record<string, string>;
}

// PreToolUse hook that intercepts AskUserQuestion to route through our UI.
// Uses a hook instead of canUseTool to avoid the SDK's 60-second canUseTool timeout.
// The hook has a 24-hour timeout, effectively letting users take as long as they need.
const askUserQuestionHook: HookCallback = async (input) => {
  const hookInput = input as PreToolUseHookInput;
  const toolInput = hookInput.tool_input as unknown as AskUserQuestionInput;
  const requestId = `question-${++questionRequestCounter}-${Date.now()}`;

  // Emit the question request to the Go backend
  emit({
    type: "user_question_request",
    requestId,
    questions: toolInput.questions,
    sessionId: currentSessionId,
  });

  // Wait for user response with a safety timeout matching the hook timeout
  try {
    const answers = await new Promise<Record<string, string>>((resolve, reject) => {
      pendingQuestionRequests.set(requestId, { resolve, reject });
      // Safety timeout to prevent infinite hang if Go backend crashes/restarts
      setTimeout(() => {
        if (pendingQuestionRequests.has(requestId)) {
          pendingQuestionRequests.delete(requestId);
          reject(new Error("User question timed out after 24 hours"));
        }
      }, ASK_USER_QUESTION_HOOK_TIMEOUT_S * 1000);
    });

    // Allow tool execution with answers populated
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "allow" as const,
        updatedInput: {
          ...(hookInput.tool_input as Record<string, unknown>),
          answers,
        },
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: errorMessage,
      },
    };
  }
};

// Required by SDK interface; AskUserQuestion is handled via PreToolUse hook above
const canUseTool = async (
  _toolName: string,
  _toolInput: Record<string, unknown>,
  _options: { signal: AbortSignal; toolUseID: string }
): Promise<{ behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string }> => {
  return { behavior: "allow" };
};

// Hooks configuration - all always enabled
const hooks = {
  PreToolUse: [
    { matcher: "AskUserQuestion", timeout: ASK_USER_QUESTION_HOOK_TIMEOUT_S, hooks: [askUserQuestionHook] },
    { hooks: [preToolUseHook] },
  ],
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
// MAIN — Multi-turn loop
// Each user message creates a new query() call. Between turns, the process
// stays alive reading stdin. The process only exits on "stop", SIGTERM, or
// stdin close.
// ============================================================================

async function main(): Promise<void> {
  emit({
    type: "ready",
    conversationId,
    cwd,
    resuming: !!resumeSessionId,
    forking: forkSession,
  });

  // Set up the event-driven input queue (replaces createMessageStream)
  setupInputQueue();
  mainLoopRunning = true;

  // Track the session ID for resume across turns
  let resumeId: string | undefined = resumeSessionId;
  let isFirstTurn = true;
  let turnCount = 0;

  try {
    // Create workspace context for MCP tools
    const workspaceContext = new WorkspaceContext({
      cwd,
      workspaceId: conversationId,
      sessionId: currentSessionId || "pending",
      linearIssue,
      targetBranch,
    });

    // Create ChatML MCP server
    const chatmlMcp = createChatMLMcpServer({ context: workspaceContext });

    // Resolve tool preset to allowedTools/disallowedTools
    const presetConfig = resolveToolPreset(toolPreset);

    // Shared query options (reused across turns — abortController added per-turn)
    const baseOptions = {
      cwd,
      permissionMode: initialPermissionMode,
      allowDangerouslySkipPermissions: true,
      canUseTool,
      mcpServers: { chatml: chatmlMcp },
      includePartialMessages: true,
      tools: { type: "preset" as const, preset: "claude_code" as const },
      systemPrompt: instructions
        ? { type: "preset" as const, preset: "claude_code" as const, append: instructions }
        : { type: "preset" as const, preset: "claude_code" as const },
      hooks,
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
      stderr: (data: string) => {
        emit({ type: "agent_stderr", data });
      },
    };

    // ====================================================================
    // Multi-turn loop: wait for message → query() → stream → turn_complete
    // ====================================================================
    while (mainLoopRunning) {
      debug(`Waiting for next message (turn ${turnCount + 1}, resumeId=${resumeId || "none"})`);

      const nextMsg = await waitForNextMessage();
      if (!nextMsg) {
        debug("No more messages (stdin closed or stop received)");
        break;
      }

      turnCount++;
      const turnStartTime = Date.now();
      debug(`Turn ${turnCount} starting: content="${nextMsg.content.slice(0, 80)}"`);

      // Reset per-turn state so previous turn's data doesn't leak
      accumulatedText = "";
      blockBuffer = "";

      // Fresh AbortController per turn — aborting turn N must not affect turn N+1
      const turnAbortController = new AbortController();
      abortControllerRef = turnAbortController;

      // Apply pending model change if queued between turns
      const turnModel = pendingModel || model;
      pendingModel = undefined;

      // Update workspace context with current session ID if it changed
      if (currentSessionId && workspaceContext.sessionId !== currentSessionId) {
        workspaceContext.updateSessionId(currentSessionId);
      }

      // Build the prompt (string for plain text, async generator for attachments)
      const prompt = buildPrompt(nextMsg);

      // Set isFirstTurn before query() so forkSession is evaluated correctly
      const shouldFork = isFirstTurn && forkSession && !!resumeId;
      isFirstTurn = false;

      // Create a new query for this turn
      const result = query({
        prompt,
        options: {
          ...baseOptions,
          abortController: turnAbortController,
          model: turnModel,
          // Session management: resume from previous turn's session
          resume: resumeId,
          // Only fork on the very first turn if --fork was specified
          forkSession: shouldFork,
        },
      });

      // Store query reference for runtime control during this turn
      queryRef = result;

      // Stream all messages for this turn
      for await (const message of result) {
        handleMessage(message);
      }

      // Turn complete — flush and emit turn_complete
      flushBlockBuffer();

      // Update resume ID for the next turn
      if (currentSessionId) {
        resumeId = currentSessionId;
      }

      // Clear query reference between turns
      queryRef = null;

      const turnDurationMs = Date.now() - turnStartTime;
      debug(`Turn ${turnCount} completed in ${turnDurationMs}ms (sessionId=${currentSessionId})`);

      // Emit turn_complete to signal the Go backend that this turn is done
      // but the process is still alive and ready for more input
      emit({ type: "turn_complete", sessionId: currentSessionId });
    }

    // Loop exited — emit complete to signal process is done
    flushBlockBuffer();
    emit({ type: "complete", sessionId: currentSessionId });
    debug(`Main loop exited after ${turnCount} turns`);
  } catch (err) {
    // Re-throw to let the top-level handler deal with cleanup and exit
    throw err;
  }
}

function handleMessage(message: SDKMessage): void {
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
              content: (block as { type: "thinking"; thinking: string }).thinking,
            });
          } else if (block.type === "tool_use") {
            // Flush any buffered text before tool starts
            flushBlockBuffer();

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
              const input = block.input as { todos?: Array<{content: string, status: string, activeForm: string}> };
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

      // Extract per-message usage for context meter
      const msgUsage = (message.message as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
      if (msgUsage) {
        emit({
          type: "context_usage",
          inputTokens: msgUsage.input_tokens ?? 0,
          outputTokens: msgUsage.output_tokens ?? 0,
          cacheReadInputTokens: msgUsage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: msgUsage.cache_creation_input_tokens ?? 0,
        });
      }
      break;
    }

    case "stream_event": {
      // Partial streaming message
      const event = message.event;
      if (event.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown>;
        if ("text" in delta && delta.text) {
          processTextChunk(delta.text as string);
        } else if ("thinking" in delta && delta.thinking) {
          // Streaming thinking content
          emit({
            type: "thinking_delta",
            content: delta.thinking as string,
          });
        }
      } else if (event.type === "content_block_start") {
        // Track when a thinking block starts
        const contentBlock = (event as { content_block?: { type: string } }).content_block;
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

            // Flush any buffered text before tool ends
            // Safe for untracked tools — flushBlockBuffer is a no-op when buffer is empty
            flushBlockBuffer();

            const isError = block.is_error === true;
            let summary = "";

            // Try to extract a summary from the result
            if (typeof block.content === "string") {
              summary = block.content.slice(0, 100);
            } else if (Array.isArray(block.content)) {
              const textContent = block.content.find(
                (c: { type: string }) => c.type === "text"
              );
              if (textContent && "text" in textContent) {
                summary = (textContent as { text: string }).text.slice(0, 100);
              }
            }

            if (toolInfo) {
              const duration = Date.now() - toolInfo.startTime;
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
            } else {
              // Race condition: tool_result arrived but tool_start was never tracked.
              // Emit tool_end anyway to prevent infinite spinner on frontend.
              emit({
                type: "warning",
                message: `tool_result for untracked tool_use_id: ${block.tool_use_id}`,
              });
              emit({
                type: "tool_end",
                id: block.tool_use_id,
                tool: "Unknown",
                success: !isError,
                summary,
                duration: 0,
                untracked: true,
              });
            }
          }
        }
      }

      // Check for checkpoint_uuid in user messages (present when checkpointing is enabled)
      // Type guard for SDK messages with checkpoint fields
      const msgWithCheckpoint = message as SDKMessage & { checkpoint_uuid?: string; message_index?: number };
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
      const resultMsg = message as SDKResultMessage;

      // Check for checkpoint_uuid in result messages (present when checkpointing is enabled)
      // Type guard for SDK messages with checkpoint fields
      const resultWithCheckpoint = message as SDKResultMessage & { checkpoint_uuid?: string; message_index?: number };
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
      } else {
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

      // Extract context window size from modelUsage for context meter
      const resultModelUsage = resultMsg.modelUsage as Record<string, { contextWindow?: number }> | undefined;
      if (resultModelUsage) {
        for (const modelKey of Object.keys(resultModelUsage)) {
          const mu = resultModelUsage[modelKey];
          if (mu?.contextWindow) {
            emit({
              type: "context_window_size",
              contextWindow: mu.contextWindow,
            });
            break;
          }
        }
      }
      break;
    }

    case "system": {
      const sysMsg = message as SDKSystemMessage | SDKCompactBoundaryMessage | SDKStatusMessage | SDKHookResponseMessage;

      if (sysMsg.subtype === "init") {
        const initMsg = sysMsg as SDKSystemMessage;
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
      } else if (sysMsg.subtype === "compact_boundary") {
        const compactMsg = sysMsg as SDKCompactBoundaryMessage;
        emit({
          type: "compact_boundary",
          trigger: compactMsg.compact_metadata.trigger,
          preTokens: compactMsg.compact_metadata.pre_tokens,
          sessionId: compactMsg.session_id,
        });
      } else if (sysMsg.subtype === "status") {
        const statusMsg = sysMsg as SDKStatusMessage;
        emit({
          type: "status_update",
          status: statusMsg.status,
          sessionId: statusMsg.session_id,
        });
      } else if (sysMsg.subtype === "hook_response") {
        const hookMsg = sysMsg as SDKHookResponseMessage;
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
      const progressMsg = message as SDKToolProgressMessage;
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
      const authMsg = message as SDKAuthStatusMessage;
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
async function cleanup(reason: string): Promise<void> {
  // Idempotency guard - prevent duplicate cleanup
  if (cleanupCalled) return;
  cleanupCalled = true;
  debug(`Cleanup called: ${reason}`);

  // 1. Break the main loop
  mainLoopRunning = false;

  // 2. Signal abort to cancel pending operations
  if (abortControllerRef) {
    abortControllerRef.abort();
  }

  // 3. Cancel all pending question requests
  for (const [requestId, pending] of pendingQuestionRequests) {
    pending.reject(new Error(`Cleanup: ${reason}`));
    pendingQuestionRequests.delete(requestId);
  }

  // 4. Emit tool_end for any in-flight tools to prevent infinite spinners on frontend
  for (const [toolId, toolInfo] of activeTools) {
    const duration = Date.now() - toolInfo.startTime;
    emit({
      type: "tool_end",
      id: toolId,
      tool: toolInfo.tool,
      success: false,
      summary: `Interrupted: ${reason}`,
      duration,
    });
  }
  activeTools.clear();

  // 5. Flush any remaining buffered text
  flushBlockBuffer();

  // 6. Interrupt the query if active (may be null between turns)
  if (queryRef) {
    try {
      await queryRef.interrupt();
    } catch {
      // Ignore errors during shutdown
    }
    queryRef = null;
  }

  // 7. Unblock any pending message waiter
  if (messageWaiter) {
    messageWaiter(null);
    messageWaiter = null;
  }

  // 8. Close readline
  closeReadline();

  // 9. Emit shutdown event
  emit({ type: "shutdown", reason });
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanup("SIGTERM").finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanup("SIGINT").finally(() => process.exit(0));
});

process.on("unhandledRejection", async (reason) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await cleanup("unhandledRejection");
  const errorMessage =
    reason instanceof Error
      ? `${reason.message}\n${reason.stack || ""}`
      : String(reason);
  emit({ type: "error", message: `Unhandled rejection: ${errorMessage}` });
  process.exit(1);
});

main().catch(async (err) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await cleanup("error");
  const errorMessage =
    err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);
  emit({ type: "error", message: `Unhandled error: ${errorMessage}` });
  process.exit(1);
});
