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
  type SDKTaskNotificationMessage,
  // New message types (SDK 0.2.51+)
  type SDKTaskStartedMessage,
  type SDKTaskProgressMessage,
  type SDKFilesPersistedEvent,
  type AgentDefinition,
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
  type PreCompactHookInput,
  type McpServerConfig,
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
// Custom session ID — when provided, the SDK uses this instead of auto-generating one.
// Typically set to the conversation ID so session tracking aligns with our data model.
const customSessionId = getArg("--session-id");

// Backend IDs for MCP tools — these correspond to the backend's workspace/session IDs
// (distinct from the SDK's internal session UUID).
const backendWorkspaceId = getArg("--workspace-id");
const backendSessionId = getArg("--backend-session-id");

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

// Skip loading .mcp.json from workspace root (security: untrusted repo MCP config)
const skipDotMcp = hasFlag("--skip-dot-mcp");

// MCP servers configuration file (JSON array of server configs from backend)
const mcpServersFilePath = getArg("--mcp-servers-file");

// Programmatic agent definitions file (JSON object of agent definitions from backend)
const agentsFilePath = getArg("--agents-file");

// Task 5: Budget Controls
const maxBudgetUsd = getNumericArg("--max-budget-usd");
const maxTurns = getNumericArg("--max-turns");
const maxThinkingTokens = getNumericArg("--max-thinking-tokens");

// Reasoning effort level (Opus 4.6+)
const validEffortLevels = ["low", "medium", "high", "max"] as const;
type EffortLevel = typeof validEffortLevels[number];
const effortArg = getArg("--effort");
const effort: EffortLevel | undefined = effortArg
  ? (validEffortLevels as readonly string[]).includes(effortArg)
    ? (effortArg as EffortLevel)
    : (() => { console.error(`Invalid --effort value: "${effortArg}". Ignoring.`); return undefined; })()
  : undefined;

// Permission mode (e.g., "plan" for plan mode at startup)
const validPermissionModes = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"] as const;
type PermissionMode = typeof validPermissionModes[number];
let initialPermissionMode: PermissionMode = "bypassPermissions";
// Tracks the current permission mode and the mode before plan mode was activated.
let currentPermissionMode: PermissionMode = "bypassPermissions";
let prePlanPermissionMode: PermissionMode = "bypassPermissions";
{
  const value = getArg("--permission-mode");
  if (value) {
    if ((validPermissionModes as readonly string[]).includes(value)) {
      initialPermissionMode = value as PermissionMode;
    } else {
      console.error(`Invalid --permission-mode value: "${value}". Using default "bypassPermissions".`);
    }
  }
  currentPermissionMode = initialPermissionMode;
  // If the agent starts in plan mode, the pre-plan fallback should be
  // bypassPermissions so that ExitPlanMode restores to the correct non-plan mode.
  prePlanPermissionMode = initialPermissionMode === "plan" ? "bypassPermissions" : initialPermissionMode;
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

// Task 9: Debug Options (SDK v0.2.30+)
const sdkDebug = hasFlag("--sdk-debug");
const sdkDebugFile = getArg("--sdk-debug-file");

// Bedrock diagnostic logging — appears in Go backend stderr logs
if (process.env.CLAUDE_CODE_USE_BEDROCK === "true") {
  console.error(`[Bedrock] Enabled. AWS_PROFILE=${process.env.AWS_PROFILE ? "(set)" : "(unset)"}, AWS_REGION=${process.env.AWS_REGION || "(unset)"}`);
  console.error(`[Bedrock] ANTHROPIC_DEFAULT_SONNET_MODEL=${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "(unset)"}`);
  console.error(`[Bedrock] ANTHROPIC_DEFAULT_HAIKU_MODEL=${process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "(unset)"}`);
}

// Instructions (e.g., from conversation summaries)
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
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
  type: "message" | "stop" | "interrupt" | "set_model" | "set_permission_mode" | "set_max_thinking_tokens" | "get_supported_models" | "get_supported_commands" | "get_mcp_status" | "get_account_info" | "rewind_files" | "user_question_response" | "plan_approval_response" | "reconnect_mcp_server" | "toggle_mcp_server" | "stop_task";
  content?: string;
  model?: string;
  permissionMode?: string;
  checkpointUuid?: string; // For rewind_files
  attachments?: Attachment[]; // File attachments
  // User question response fields
  questionRequestId?: string;
  answers?: Record<string, string>;
  // Plan approval response fields
  planApprovalRequestId?: string;
  planApproved?: boolean;
  planApprovalReason?: string;
  // Max thinking tokens override
  maxThinkingTokens?: number;
  // MCP server management fields (SDK v0.2.21+)
  serverName?: string;
  serverEnabled?: boolean;
  // Task management (SDK v0.2.51+)
  taskId?: string;
}

// Escape a string for use in XML attribute values
function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Tool metadata extraction — lightweight structured data from tool results
// ---------------------------------------------------------------------------

/** Extract text content from a tool_result block.content (string or content array). */
function extractTextFromToolResult(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((c: { type: string }) => c.type === "text");
    if (textBlock && "text" in textBlock) return (textBlock as { text: string }).text;
  }
  return undefined;
}

/** Extract structured metadata from tool result content based on tool type. */
function extractToolMetadata(toolName: string, content: unknown, toolInput?: Record<string, unknown>): Record<string, unknown> | undefined {
  const text = extractTextFromToolResult(content);

  switch (toolName) {
    case "Read": {
      if (!text) return undefined;
      // Result format: "     1→line1\n     2→line2..." — count non-empty lines
      const lines = text.split("\n").filter(l => l.length > 0).length;
      return lines > 0 ? { linesRead: lines } : undefined;
    }
    case "Write": {
      if (!text) return undefined;
      // Result contains byte count info, e.g. "Successfully wrote 1234 bytes to /path"
      const match = text.match(/(\d+)\s*bytes/i);
      return match ? { bytesWritten: parseInt(match[1]) } : undefined;
    }
    case "Edit": {
      if (!text) return undefined;
      // Result mentions replacement count, e.g. "1 replacement made" or "Replaced N occurrences"
      const match = text.match(/(\d+)\s*replacement/i) || text.match(/replaced\s+(\d+)/i);
      return match ? { replacements: parseInt(match[1]) } : undefined;
    }
    case "Grep": {
      if (!text) return undefined;
      // files_with_matches mode: lines are file paths, preceded by a count header
      const lines = text.split("\n").filter(l => l.length > 0);
      // Count mode: "N matches in M files" or similar
      const countMatch = text.match(/(\d+)\s+match/i);
      // File paths (non-header lines)
      const fileLines = lines.filter(l => l.startsWith("/") || l.startsWith("./"));
      if (fileLines.length > 0) {
        return { matchCount: fileLines.length, fileCount: fileLines.length };
      }
      if (countMatch) {
        return { matchCount: parseInt(countMatch[1]) };
      }
      return undefined;
    }
    case "Glob": {
      if (!text) return undefined;
      // Result is a list of file paths, one per line
      const files = text.split("\n").filter(l => l.length > 0 && (l.startsWith("/") || l.startsWith("./")));
      return files.length > 0 ? { matchCount: files.length } : undefined;
    }
    case "TodoWrite": {
      // Extract metadata from tool input params (the todo list itself)
      const todos = toolInput?.todos as Array<{status?: string}> | undefined;
      if (!todos || !Array.isArray(todos)) return undefined;
      return {
        todosTotal: todos.length,
        todosCompleted: todos.filter(t => t.status === "completed").length,
        todosInProgress: todos.filter(t => t.status === "in_progress").length,
      };
    }
    default:
      return undefined;
  }
}

// Module-level readline interface for proper cleanup
let rl: readline.Interface | null = null;

// Module-level query reference for runtime control
let queryRef: Query | null = null;

// Track current session ID
let currentSessionId: string | undefined = undefined;

// MCP server source tracking — maps server name to its origin for the UI
let mcpServerSources: Record<string, string> = {};

// Pending user question requests (for AskUserQuestion tool)
const ASK_USER_QUESTION_HOOK_TIMEOUT_S = 86400; // 24 hours — lets users take as long as they need

interface PendingQuestionRequest {
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}
const pendingQuestionRequests = new Map<string, PendingQuestionRequest>();
let questionRequestCounter = 0;

// Retry dedup for AskUserQuestion — similar to ExitPlanMode's cooldown for SDK bug #15755.
// After the user answers, cache answers so SDK retries get auto-approved without re-prompting.
let lastQuestionAnswers: Record<string, string> | null = null;
let lastQuestionAnswerTime = 0;
const ASK_USER_QUESTION_COOLDOWN_MS = 30_000; // 30 seconds

// Pending plan approval requests (for ExitPlanMode tool)
const PLAN_APPROVAL_HOOK_TIMEOUT_S = 86400; // 24 hours — lets users take as long as they need

// Guard against SDK bug #15755: after ExitPlanMode completes, the SDK may emit
// a stale status message with permissionMode: "plan" that overrides our manual
// mode restoration. This flag suppresses those stale messages.
let suppressStalePlanMode = false;

interface PlanApprovalResult {
  approved: boolean;
  reason?: string;
}
interface PendingPlanApprovalRequest {
  resolve: (result: PlanApprovalResult) => void;
  reject: (error: Error) => void;
}
const pendingPlanApprovalRequests = new Map<string, PendingPlanApprovalRequest>();
let planApprovalRequestCounter = 0;

// Track the last file written during plan mode so we can include plan content
// in the plan_approval_request event when ExitPlanMode fires.
let lastPlanFilePath: string | null = null;

// Module-level references for cleanup
let abortControllerRef: AbortController | null = null;

// Shutdown state
let isShuttingDown = false;
let cleanupCalled = false;
// Multi-turn loop control: set to false to break the main loop
let mainLoopRunning = false;
// Track when the current turn started (for duration reporting)
let currentTurnStartTime = 0;

// Debug logging (enabled via CHATML_DEBUG=1 env var)
const debugEnabled = process.env.CHATML_DEBUG === "1";
function debug(msg: string, ...args: unknown[]): void {
  if (!debugEnabled) return;
  const ts = new Date().toISOString();
  console.error(`[DEBUG ${ts}] ${msg}`, ...args);
}

// Always-on lifecycle logging for sidecar visibility.
// These log at key milestones so hangs can be diagnosed without CHATML_DEBUG.
function lifecycle(msg: string): void {
  console.error(`[lifecycle] ${msg}`);
}

// Close readline interface if it exists
function closeReadline(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

// Stop the main loop and unblock any pending message waiter
function stopMainLoop(): void {
  mainLoopRunning = false;
  if (messageWaiter) {
    messageWaiter(null);
    messageWaiter = null;
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
      const attachCount = input.attachments?.length ?? 0;
      lifecycle(`stdin: type=${input.type} len=${line.length} attachments=${attachCount}`);
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
          debug(`Model change ignored (no active query): ${input.model}`);
          emit({ type: "command_error", command: "set_model", error: "No active query" });
        }
        return;
      }

      if (input.type === "set_permission_mode" && input.permissionMode) {
        if (queryRef) {
          debug(`Setting permission mode: ${input.permissionMode}`);
          // Track pre-plan mode so ExitPlanMode can restore it
          if (input.permissionMode === "plan") {
            prePlanPermissionMode = currentPermissionMode;
            // Reset suppression and cooldown — user is explicitly entering plan mode
            suppressStalePlanMode = false;
            lastExitPlanApprovalTime = 0;
            // Clear stale plan file path — a new plan cycle starts fresh.
            // Without this, re-entering plan mode and calling ExitPlanMode would
            // re-read the previously approved plan file from disk.
            lastPlanFilePath = null;
          }
          currentPermissionMode = input.permissionMode as PermissionMode;
          void queryRef.setPermissionMode(input.permissionMode as "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk").then(() => {
            emit({ type: "permission_mode_changed", mode: input.permissionMode!, source: "user" });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "set_permission_mode", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "set_permission_mode", error: "No active query" });
        }
        return;
      }

      if (input.type === "set_max_thinking_tokens" && input.maxThinkingTokens) {
        if (queryRef) {
          debug(`Setting max thinking tokens: ${input.maxThinkingTokens}`);
          // TODO: migrate to setThinking() when SDK exposes it as a Query method
          void queryRef.setMaxThinkingTokens(input.maxThinkingTokens).then(() => {
            emit({ type: "max_thinking_tokens_changed", maxThinkingTokens: input.maxThinkingTokens! });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "set_max_thinking_tokens", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "set_max_thinking_tokens", error: "No active query" });
        }
        return;
      }

      if (input.type === "stop_task" && input.taskId) {
        if (queryRef) {
          debug(`Stopping task: ${input.taskId}`);
          void queryRef.stopTask(input.taskId).then(() => {
            emit({ type: "task_stopped", taskId: input.taskId! });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "stop_task", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "stop_task", error: "No active query" });
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
            const count = Array.isArray(commands) ? commands.length : 0;
            const names = Array.isArray(commands) ? (commands as Array<{name?: string}>).map(c => c.name ?? JSON.stringify(c)).join(", ") : "N/A";
            lifecycle(`supportedCommands() returned ${count} commands: [${names}]`);
            emit({ type: "supported_commands", commands });
          }).catch((cmdErr: unknown) => {
            lifecycle(`supportedCommands() error: ${String(cmdErr)}`);
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

      // MCP server management (SDK v0.2.21+)
      if (input.type === "reconnect_mcp_server" && input.serverName) {
        if (queryRef) {
          void queryRef.reconnectMcpServer(input.serverName).then(() => {
            emit({ type: "mcp_server_reconnected", serverName: input.serverName! });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "reconnect_mcp_server", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "reconnect_mcp_server", error: "No active query" });
        }
        return;
      }

      if (input.type === "toggle_mcp_server" && input.serverName) {
        if (queryRef) {
          const enabled = input.serverEnabled !== false;
          void queryRef.toggleMcpServer(input.serverName, enabled).then(() => {
            emit({ type: "mcp_server_toggled", serverName: input.serverName!, enabled });
          }).catch((cmdErr: unknown) => {
            emit({ type: "command_error", command: "toggle_mcp_server", error: String(cmdErr) });
          });
        } else {
          emit({ type: "command_error", command: "toggle_mcp_server", error: "No active query" });
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

      // Handle plan approval responses from the Go backend
      if (input.type === "plan_approval_response" && input.planApprovalRequestId) {
        const pending = pendingPlanApprovalRequests.get(input.planApprovalRequestId);
        if (pending) {
          pendingPlanApprovalRequests.delete(input.planApprovalRequestId);
          pending.resolve({ approved: input.planApproved === true, reason: input.planApprovalReason });
        } else {
          emit({
            type: "warning",
            message: `Received response for unknown plan approval request: ${input.planApprovalRequestId}`,
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

// Build an SDKUserMessage from a queued message (text or text+attachments).
function buildUserMessage(msg: QueuedMessage): SDKUserMessage {
  if (!msg.attachments || msg.attachments.length === 0) {
    return {
      type: "user",
      message: { role: "user", content: msg.content },
      parent_tool_use_id: null,
      session_id: currentSessionId || "",
    } as SDKUserMessage;
  }

  // Build multipart content blocks
  const contentBlocks: Array<{type: string; [key: string]: unknown}> = [];

  if (msg.content) {
    contentBlocks.push({ type: "text", text: msg.content });
  }

  // Track temp files for cleanup after message is built
  const tempFilesToClean: string[] = [];

  for (const attachment of msg.attachments) {
    if (attachment.type === "image") {
      // Image attachment — prefer file-based delivery to avoid pipe buffer saturation
      // in the SDK → cli.js chain. The Go backend offloads images to temp files.
      if (attachment.path && !attachment.base64Data) {
        // File-based path: image was offloaded to a temp file by Go backend.
        // Instruct Claude to read the image file directly via the Read tool,
        // bypassing the stdin pipe entirely.
        lifecycle(`image "${attachment.name}" via file: ${attachment.path}`);
        tempFilesToClean.push(attachment.path);
        pendingTempFiles.add(attachment.path);
        contentBlocks.push({
          type: "text",
          text: `[The user attached an image: "${attachment.name}" (${attachment.mimeType}). ` +
                `IMPORTANT: Read it now with the Read tool at path: ${attachment.path}]`,
        });
        continue;
      }

      if (!attachment.base64Data) {
        emit({
          type: "warning",
          message: `Image "${attachment.name}" has no data and was skipped`,
        });
        continue;
      }

      // Inline base64 fallback: Go backend should have offloaded to temp file,
      // but if it didn't, save to temp file here. Sending image content blocks
      // directly through the SDK causes hangs (pipe buffer saturation in the
      // SDK → CLI child process chain). Instead, write to a temp file and use
      // the same text-instruction approach as the file-based path.
      const rawSizeBytes = Math.ceil(attachment.base64Data.length * 3 / 4);
      const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
      if (rawSizeBytes > MAX_IMAGE_BYTES) {
        const sizeMB = (rawSizeBytes / (1024 * 1024)).toFixed(1);
        lifecycle(`image "${attachment.name}" too large: ${sizeMB}MB (limit 5MB)`);
        emit({
          type: "error",
          message: `Image "${attachment.name}" is ${sizeMB}MB which exceeds the 5MB API limit. Please use a smaller image.`,
        });
        continue;
      }

      // Determine extension from MIME type
      let ext = ".png";
      if (attachment.mimeType === "image/jpeg") ext = ".jpg";
      else if (attachment.mimeType === "image/gif") ext = ".gif";
      else if (attachment.mimeType === "image/webp") ext = ".webp";

      // Write decoded image to temp file
      try {
        const tempPath = join(tmpdir(), `chatml-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
        const raw = Buffer.from(attachment.base64Data, "base64");
        writeFileSync(tempPath, raw);
        lifecycle(`image "${attachment.name}" saved to temp file: ${tempPath} (${Math.round(raw.length / 1024)}KB)`);
        tempFilesToClean.push(tempPath);
        pendingTempFiles.add(tempPath);
        contentBlocks.push({
          type: "text",
          text: `[The user attached an image: "${attachment.name}" (${attachment.mimeType}). ` +
                `IMPORTANT: Read it now with the Read tool at path: ${tempPath}]`,
        });
      } catch (err) {
        lifecycle(`Failed to save image "${attachment.name}" to temp file: ${err}`);
        emit({
          type: "warning",
          message: `Image "${attachment.name}" could not be processed and was skipped`,
        });
      }
    } else if (!attachment.base64Data) {
      emit({
        type: "warning",
        message: `Attachment "${attachment.name}" (${attachment.type}) has no base64Data and was skipped`,
      });
      continue;
    } else {
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

  // Schedule deferred cleanup of temp image files.
  // Delay allows Claude to read the files during the turn.
  if (tempFilesToClean.length > 0) {
    setTimeout(() => {
      for (const filePath of tempFilesToClean) {
        try {
          unlinkSync(filePath);
          pendingTempFiles.delete(filePath);
          debug(`Cleaned up temp image: ${filePath}`);
        } catch {
          pendingTempFiles.delete(filePath);
          // File may already be gone — that's fine
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  return {
    type: "user",
    message: { role: "user", content: contentBlocks },
    parent_tool_use_id: null,
    session_id: currentSessionId || "",
  } as SDKUserMessage;
}

// Buffer for block-level streaming (emit on paragraph breaks)
let blockBuffer = "";
const BLOCK_BUFFER_MAX_SIZE = 4096; // Flush even without paragraph break to ensure progressive rendering

// Track whether the current (parent) turn produced any assistant_text events.
// Used to detect local commands (like /release-notes) whose output only appears
// in the result message's `result` field, not as streamed text.
// Only set by parent-session stream events (sub-agent streams are filtered at
// the isSubAgentMessage guard), so sub-agents cannot interfere with this flag.
let parentTurnHadAssistantText = false;

function processTextChunk(text: string): void {
  parentTurnHadAssistantText = true;
  blockBuffer += text;

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
    // Try to split at the last newline to avoid breaking mid-word
    const lastNewline = blockBuffer.lastIndexOf("\n");
    if (lastNewline > 0) {
      emit({ type: "assistant_text", content: blockBuffer.slice(0, lastNewline + 1) });
      blockBuffer = blockBuffer.slice(lastNewline + 1);
    } else {
      emit({ type: "assistant_text", content: blockBuffer });
      blockBuffer = "";
    }
  }
}

function flushBlockBuffer(): void {
  if (blockBuffer.trim()) {
    emit({ type: "assistant_text", content: blockBuffer });
    blockBuffer = "";
  }
}

// Track temp image files for cleanup on exit (module-level so cleanup() can access them)
const pendingTempFiles = new Set<string>();

// Track active tool uses
const activeTools = new Map<string, { tool: string; startTime: number; input?: Record<string, unknown> }>();
// Retain tool names after completion so duplicate tool_end events during
// session replay can still report the correct tool name instead of "Unknown".
const completedToolNames = new Map<string, string>();

// Track sub-agent session → agentId mapping for correlating hook events
const sessionToAgentId = new Map<string, string>();
// Track sub-agent active tools (keyed by toolUseId)
const subagentActiveTools = new Map<string, { agentId: string; tool: string; startTime: number }>();
// Track Task tool descriptions by tool_use_id for sub-agent description plumbing (Issue 3)
const taskToolDescriptions = new Map<string, string>();

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

function resetRunStats(): void {
  runStats.toolCalls = 0;
  runStats.toolsByType = {};
  runStats.subAgents = 0;
  runStats.filesRead = 0;
  runStats.filesWritten = 0;
  runStats.bashCommands = 0;
  runStats.webSearches = 0;
  runStats.totalToolDurationMs = 0;
}

// ============================================================================
// HOOKS - All hooks are always enabled for comprehensive logging/tracking
// ============================================================================

// Extract agent_id / agent_type from hook inputs (SDK 0.2.69+ provides these on ALL hooks)
function extractAgentFields(input: unknown): { agentId?: string; agentType?: string } {
  const i = input as { agent_id?: string; agent_type?: string };
  return { agentId: i.agent_id, agentType: i.agent_type };
}

const preToolUseHook: HookCallback = async (input, toolUseId) => {
  const hookInput = input as PreToolUseHookInput;
  const agentFields = extractAgentFields(input);
  const agentId = sessionToAgentId.get(hookInput.session_id) || agentFields.agentId;

  emit({
    type: "hook_pre_tool",
    toolUseId,
    tool: hookInput.tool_name,
    input: hookInput.tool_input,
    sessionId: hookInput.session_id,
    ...agentFields,
  });

  // Capture Task tool descriptions for sub-agent description plumbing (Issue 3)
  if (hookInput.tool_name === "Task" && toolUseId) {
    const taskInput = hookInput.tool_input as { description?: string };
    if (taskInput.description) {
      taskToolDescriptions.set(toolUseId, taskInput.description);
    }
  }

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

  // Track Write tool file paths during plan mode so exitPlanModeHook can
  // read the plan content and include it in the plan_approval_request event.
  if (currentPermissionMode === "plan" && hookInput.tool_name === "Write") {
    const writeInput = hookInput.tool_input as { file_path?: string };
    if (writeInput.file_path) {
      lastPlanFilePath = writeInput.file_path;
    }
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
    ...extractAgentFields(input),
  });

  // When ExitPlanMode completes, the SDK internally changes the permission mode
  // from "plan" to the pre-plan mode. Explicitly restore the mode and emit
  // permission_mode_changed to sync Go backend and frontend. This works around
  // SDK bug #15755 where permissionDecision: "allow" from PreToolUse hooks
  // sometimes doesn't properly transition the SDK out of plan mode.
  if (hookInput.tool_name === "ExitPlanMode") {
    const restoreMode = prePlanPermissionMode;
    currentPermissionMode = restoreMode;
    // Suppress stale SDK status messages that try to re-set plan mode
    suppressStalePlanMode = true;
    debug(`ExitPlanMode completed — restoring permission mode to "${restoreMode}", suppressing stale plan status`);
    emit({ type: "permission_mode_changed", mode: restoreMode, source: "exit_plan" });
    // Await the SDK mode change to ensure it takes effect before the next turn
    if (queryRef) {
      try {
        await queryRef.setPermissionMode(restoreMode);
        debug(`SDK permission mode confirmed set to "${restoreMode}"`);
      } catch (err: unknown) {
        debug(`Failed to restore permission mode after ExitPlanMode: ${err}`);
      }
    }
    // Clear the plan file path now that the plan cycle is complete.
    // Defense-in-depth: also cleared on plan mode re-entry (set_permission_mode handler).
    lastPlanFilePath = null;
  }

  // When the agent autonomously enters plan mode via EnterPlanMode, emit a dedicated
  // event so the frontend can distinguish it from stale SDK status echoes and bypass
  // the exit cooldown. Mirrors the ExitPlanMode pattern above.
  if (hookInput.tool_name === "EnterPlanMode") {
    // Clear stale-mode suppression — this is a genuine plan mode entry
    suppressStalePlanMode = false;
    // Track pre-plan mode so ExitPlanMode can restore it
    if (currentPermissionMode !== "plan") {
      prePlanPermissionMode = currentPermissionMode;
    }
    currentPermissionMode = "plan" as PermissionMode;
    // Clear stale plan file path — new plan cycle starts fresh
    lastPlanFilePath = null;
    debug(`EnterPlanMode completed — entering plan mode, previous mode was "${prePlanPermissionMode}"`);
    emit({ type: "permission_mode_changed", mode: "plan", source: "enter_plan_tool" });
    // Sync SDK internal state to plan mode (mirrors ExitPlanMode's setPermissionMode call)
    if (queryRef) {
      try {
        await queryRef.setPermissionMode("plan");
        debug(`SDK permission mode confirmed set to "plan"`);
      } catch (err: unknown) {
        debug(`Failed to set permission mode after EnterPlanMode: ${err}`);
      }
    }
  }

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
    // Clean up Task tool description after completion
    taskToolDescriptions.delete(toolUseId);
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
    ...extractAgentFields(input),
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
    // Clean up Task tool description after failure
    taskToolDescriptions.delete(toolUseId);
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
    ...extractAgentFields(input),
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
    ...extractAgentFields(input),
  });
  return {};
};

const sessionEndHook: HookCallback = async (input) => {
  const hookInput = input as SessionEndHookInput;
  emit({
    type: "session_ended",
    reason: hookInput.reason,
    sessionId: hookInput.session_id,
    ...extractAgentFields(input),
  });
  return {};
};

const stopHook: HookCallback = async (input) => {
  const hookInput = input as StopHookInput;
  emit({
    type: "agent_stop",
    stopHookActive: hookInput.stop_hook_active,
    sessionId: hookInput.session_id,
    ...extractAgentFields(input),
  });
  return {};
};

const preCompactHook: HookCallback = async (input) => {
  const hookInput = input as PreCompactHookInput;
  emit({
    type: "pre_compact",
    trigger: hookInput.trigger,
    customInstructions: hookInput.custom_instructions,
    sessionId: hookInput.session_id,
    ...extractAgentFields(input),
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

  // Look up the Task tool description for this sub-agent (Issue 3)
  const description = parentToolUseId ? taskToolDescriptions.get(parentToolUseId) : undefined;

  emit({
    type: "subagent_started",
    agentId: hookInput.agent_id,
    agentType: hookInput.agent_type,
    sessionId: hookInput.session_id,
    parentToolUseId,
    description,
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

  // SDK retry guard: if we recently answered a question, auto-return the cached
  // answers instead of prompting the user again. Mirrors the ExitPlanMode
  // cooldown workaround for SDK bug #15755.
  if (lastQuestionAnswers && Date.now() - lastQuestionAnswerTime < ASK_USER_QUESTION_COOLDOWN_MS) {
    debug("Auto-returning cached answers for AskUserQuestion retry (cooldown active)");
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "allow" as const,
        updatedInput: {
          ...(hookInput.tool_input as Record<string, unknown>),
          answers: lastQuestionAnswers,
        },
      },
    };
  }

  const requestId = `question-${++questionRequestCounter}-${Date.now()}`;

  // Flush any buffered text so it appears BEFORE the question UI.
  // The PreToolUse hook fires before the SDK yields the assistant message
  // through the iterator, so flushBlockBuffer() in handleMessage hasn't run yet.
  flushBlockBuffer();

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

    // Cache answers for retry dedup
    lastQuestionAnswers = answers;
    lastQuestionAnswerTime = Date.now();

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
    // Clear cached answers on cancellation/timeout
    lastQuestionAnswers = null;
    lastQuestionAnswerTime = 0;

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

// Tracks the last time ExitPlanMode was approved by the user. Used to auto-approve
// duplicate ExitPlanMode calls caused by SDK bug #15755 (SDK doesn't properly exit
// plan mode after permissionDecision: "allow", so the agent retries).
let lastExitPlanApprovalTime = 0;
const EXIT_PLAN_APPROVAL_COOLDOWN_MS = 30_000; // 30 seconds

// PreToolUse hook that intercepts ExitPlanMode to route approval through our UI.
// Uses the same pattern as AskUserQuestion: hook blocks execution until user responds.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const exitPlanModeHook: HookCallback = async (_input) => {
  // SDK bug #15755: after the first ExitPlanMode is approved and executed, the SDK
  // may retry ExitPlanMode because its internal state didn't update. Returning "allow"
  // again would re-trigger the same bug. Instead, DENY the retry with a clear message
  // so the agent knows the plan was approved and should proceed with implementation.
  if (Date.now() - lastExitPlanApprovalTime < EXIT_PLAN_APPROVAL_COOLDOWN_MS) {
    debug("Denying ExitPlanMode retry (recently approved, SDK bug #15755) — telling agent to proceed");
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "Plan mode already exited successfully. Your plan was approved by the user. Do not call ExitPlanMode again. Proceed with implementation immediately.",
      },
      systemMessage: "The user has already approved your plan. Plan mode has been exited. Proceed with implementing the plan now.",
    };
  }

  const requestId = `plan-approval-${++planApprovalRequestCounter}-${Date.now()}`;

  // Flush any buffered text so plan content appears before the approval UI
  flushBlockBuffer();

  // Read plan file content if tracked during plan mode
  let planContent: string | undefined;
  if (lastPlanFilePath) {
    try {
      planContent = readFileSync(lastPlanFilePath, "utf-8");
    } catch (err) {
      debug(`Failed to read plan file ${lastPlanFilePath}: ${err}`);
    }
  }

  // No plan content means the agent is just exiting plan mode (not proposing a plan).
  // Auto-approve to avoid showing an empty approval UI that requires user interaction.
  if (!planContent) {
    debug("Auto-approving ExitPlanMode — no plan content to review");
    lastExitPlanApprovalTime = Date.now();
    emit({
      type: "plan_mode_auto_exited",
      sessionId: currentSessionId,
    });
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "allow" as const,
      },
    };
  }

  // Emit the plan approval request to the Go backend (with plan content)
  emit({
    type: "plan_approval_request",
    requestId,
    sessionId: currentSessionId,
    planContent,
  });

  // Wait for user response with a safety timeout matching the hook timeout
  try {
    const result = await new Promise<PlanApprovalResult>((resolve, reject) => {
      pendingPlanApprovalRequests.set(requestId, { resolve, reject });
      // Safety timeout to prevent infinite hang if Go backend crashes/restarts
      setTimeout(() => {
        if (pendingPlanApprovalRequests.has(requestId)) {
          pendingPlanApprovalRequests.delete(requestId);
          reject(new Error("Plan approval timed out after 24 hours"));
        }
      }, PLAN_APPROVAL_HOOK_TIMEOUT_S * 1000);
    });

    if (result.approved) {
      // Record approval time to auto-approve retries caused by SDK bug #15755
      lastExitPlanApprovalTime = Date.now();
      // Allow tool execution - SDK will exit plan mode naturally
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow" as const,
        },
      };
    } else {
      // Deny tool execution - SDK stays in plan mode
      const reason = result.reason || "User requested changes to the plan";
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: reason,
        },
      };
    }
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

// Tools that are NOT allowed in plan mode (write/execute tools).
// Plan mode restricts the agent to read-only until ExitPlanMode is approved.
const PLAN_MODE_DENIED_TOOLS = new Set([
  "Write", "Edit", "Bash", "NotebookEdit",
]);

// Permission callback — enforces plan mode restrictions as defense-in-depth.
// In bypassPermissions mode the SDK auto-allows all tools before reaching this.
// In plan mode the SDK should enforce restrictions natively, but we double-check here.
const canUseTool = async (
  toolName: string,
  toolInput: Record<string, unknown>,
  _options: { signal: AbortSignal; toolUseID: string } // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<{ behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string }> => {
  // Defense-in-depth: if AskUserQuestion reaches canUseTool with cached answers,
  // provide them via updatedInput. In bypassPermissions mode (the default), the SDK
  // auto-allows before reaching this callback — this covers non-bypass modes.
  if (toolName === "AskUserQuestion" && lastQuestionAnswers &&
      Date.now() - lastQuestionAnswerTime < ASK_USER_QUESTION_COOLDOWN_MS) {
    const answers = lastQuestionAnswers;
    lastQuestionAnswers = null; // Consume once
    return { behavior: "allow", updatedInput: { ...toolInput, answers } };
  }
  if (currentPermissionMode === "plan" && PLAN_MODE_DENIED_TOOLS.has(toolName)) {
    return { behavior: "deny", message: "This tool is not available in plan mode. Present your plan using ExitPlanMode first." };
  }
  return { behavior: "allow", updatedInput: toolInput };
};

// Hooks configuration - all always enabled
const hooks = {
  PreToolUse: [
    { matcher: "AskUserQuestion", timeout: ASK_USER_QUESTION_HOOK_TIMEOUT_S, hooks: [askUserQuestionHook] },
    { matcher: "ExitPlanMode", timeout: PLAN_APPROVAL_HOOK_TIMEOUT_S, hooks: [exitPlanModeHook] },
    { hooks: [preToolUseHook] },
  ],
  PostToolUse: [{ hooks: [postToolUseHook] }],
  PostToolUseFailure: [{ hooks: [postToolUseFailureHook] }],
  Notification: [{ hooks: [notificationHook] }],
  SessionStart: [{ hooks: [sessionStartHook] }],
  SessionEnd: [{ hooks: [sessionEndHook] }],
  Stop: [{ hooks: [stopHook] }],
  PreCompact: [{ hooks: [preCompactHook] }],
  SubagentStart: [{ hooks: [subagentStartHook] }],
  SubagentStop: [{ hooks: [subagentStopHook] }],
};

// ============================================================================
// MAIN — Streaming Input Mode (single query, persistent generator)
//
// Per the Claude Agent SDK docs, streaming input is the recommended mode for
// multi-turn conversations. A SINGLE query() call is made with a long-lived
// AsyncGenerator that yields user messages as they arrive on stdin.
//
// The generator stays alive across turns:
//   1. Generator yields message 1 → CLI processes → result streamed back
//   2. Generator awaits next stdin message
//   3. Generator yields message 2 → CLI processes → result streamed back
//   4. ... continues until process shutdown
//
// Benefits:
//   - Single CLI subprocess lives for the entire session
//   - No --resume needed between turns (session persists naturally)
//   - stdin stays open so hooks, canUseTool, and MCP work correctly
//   - endInput() only called when the generator returns (shutdown)
// ============================================================================

async function main(): Promise<void> {
  lifecycle("main() entered");
  emit({
    type: "ready",
    provider: "claude",
    conversationId,
    cwd,
    resuming: !!resumeSessionId,
    forking: forkSession,
    model: model || "(default)",
  });
  lifecycle("ready emitted");

  // Set up the event-driven input queue
  setupInputQueue();
  mainLoopRunning = true;
  lifecycle("input queue ready");

  let turnCount = 0;

  try {
    // Create workspace context for MCP tools.
    // Use backend IDs (workspace/session) when available so MCP tools hit the correct
    // backend API endpoints. Fall back to conversationId for backwards compatibility.
    const workspaceContext = new WorkspaceContext({
      cwd,
      workspaceId: backendWorkspaceId || conversationId,
      sessionId: backendSessionId || "pending",
      linearIssue,
      targetBranch,
    });

    // Create ChatML MCP server
    const chatmlMcp = createChatMLMcpServer({ context: workspaceContext });

    // Build merged MCP servers map: built-in + .mcp.json + claude-cli + user-configured
    // Merge priority (later wins): builtin → dot-mcp → claude-cli-user → claude-cli-project → chatml
    const mergedMcpServers: Record<string, McpServerConfig> = { chatml: chatmlMcp };
    mcpServerSources = { chatml: "builtin" };

    // Load .mcp.json from worktree root (project-level config)
    // Gated by --skip-dot-mcp flag to prevent untrusted repos from executing commands
    if (!skipDotMcp) {
      try {
        const dotMcpPath = `${cwd}/.mcp.json`;
        const dotMcpContent = readFileSync(dotMcpPath, "utf-8");
        const dotMcpConfig = JSON.parse(dotMcpContent) as { mcpServers?: Record<string, McpServerConfig> };
        if (dotMcpConfig.mcpServers) {
          for (const [name, config] of Object.entries(dotMcpConfig.mcpServers)) {
            mergedMcpServers[name] = config;
            mcpServerSources[name] = "dot-mcp";
            debug(`Loaded MCP server from .mcp.json: ${name}`);
          }
        }
      } catch {
        // .mcp.json doesn't exist or is invalid — that's fine
      }
    } else {
      debug("Skipping .mcp.json loading (--skip-dot-mcp flag set)");
    }

    // Load Claude Code CLI user-level MCP servers (~/.claude/settings.json)
    // Always trusted — this is the user's own global config
    try {
      const userSettingsPath = join(homedir(), ".claude", "settings.json");
      const userSettingsContent = readFileSync(userSettingsPath, "utf-8");
      const userSettings = JSON.parse(userSettingsContent) as { mcpServers?: Record<string, McpServerConfig> };
      if (userSettings.mcpServers) {
        for (const [name, config] of Object.entries(userSettings.mcpServers)) {
          mergedMcpServers[name] = config;
          mcpServerSources[name] = "claude-cli-user";
          debug(`Loaded MCP server from ~/.claude/settings.json: ${name}`);
        }
      }
    } catch {
      // ~/.claude/settings.json doesn't exist or is invalid — that's fine
    }

    // Load Claude Code CLI project-level MCP servers (<cwd>/.claude/settings.json)
    // Gated by same trust mechanism as .mcp.json
    if (!skipDotMcp) {
      try {
        const projectSettingsPath = join(cwd, ".claude", "settings.json");
        const projectSettingsContent = readFileSync(projectSettingsPath, "utf-8");
        const projectSettings = JSON.parse(projectSettingsContent) as { mcpServers?: Record<string, McpServerConfig> };
        if (projectSettings.mcpServers) {
          for (const [name, config] of Object.entries(projectSettings.mcpServers)) {
            mergedMcpServers[name] = config;
            mcpServerSources[name] = "claude-cli-project";
            debug(`Loaded MCP server from .claude/settings.json: ${name}`);
          }
        }
      } catch {
        // .claude/settings.json doesn't exist or is invalid — that's fine
      }
    }

    // Load user-configured MCP servers from backend (via temp file)
    if (mcpServersFilePath) {
      try {
        const mcpContent = readFileSync(mcpServersFilePath, "utf-8");
        const userServers = JSON.parse(mcpContent) as Array<{
          name: string;
          type: string;
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          url?: string;
          headers?: Record<string, string>;
          enabled: boolean;
        }>;
        for (const server of userServers) {
          if (!server.enabled) continue;
          if (server.type === "stdio" && server.command) {
            mergedMcpServers[server.name] = {
              command: server.command,
              args: server.args || [],
              env: server.env || {},
            };
          } else if (server.type === "sse" && server.url) {
            mergedMcpServers[server.name] = {
              type: "sse" as const,
              url: server.url,
              headers: server.headers || {},
            };
          } else if (server.type === "http" && server.url) {
            mergedMcpServers[server.name] = {
              type: "http" as const,
              url: server.url,
              headers: server.headers || {},
            };
            mcpServerSources[server.name] = "chatml";
          } else {
            debug(`Skipped user MCP server with unsupported config: ${server.name} (${server.type})`);
            continue;
          }
          debug(`Loaded user MCP server: ${server.name} (${server.type})`);
        }
      } catch (e) {
        console.error(`Failed to load MCP servers file: ${e}`);
      }
    }

    // Load programmatic agent definitions from backend (via temp file)
    let programmaticAgents: Record<string, AgentDefinition> | undefined;
    if (agentsFilePath) {
      try {
        const agentsContent = readFileSync(agentsFilePath, "utf-8");
        programmaticAgents = JSON.parse(agentsContent) as Record<string, AgentDefinition>;
        debug(`Loaded ${Object.keys(programmaticAgents).length} programmatic agents: ${Object.keys(programmaticAgents).join(", ")}`);
      } catch (e) {
        console.error(`Failed to load agents file: ${e}`);
      }
    }

    // Resolve tool preset to allowedTools/disallowedTools
    const presetConfig = resolveToolPreset(toolPreset);

    // Shared query options (everything except resume, abortController, and prompt
    // which change per recovery attempt)
    const queryOptions = {
      cwd,
      permissionMode: initialPermissionMode,
      // Do NOT set allowDangerouslySkipPermissions: true — it bypasses plan mode
      // restrictions in the SDK (isBypassPermissionsModeAvailable becomes true,
      // causing the plan mode check to auto-allow all tools). In bypassPermissions
      // mode the SDK already allows all tools via a direct mode check, so this
      // flag is not needed. canUseTool provides additional defense-in-depth.
      allowDangerouslySkipPermissions: false,
      canUseTool,
      mcpServers: mergedMcpServers,
      includePartialMessages: true,
      tools: { type: "preset" as const, preset: "claude_code" as const },
      systemPrompt: instructions
        ? { type: "preset" as const, preset: "claude_code" as const, append: instructions }
        : { type: "preset" as const, preset: "claude_code" as const },
      hooks,
      allowedTools: presetConfig.allowedTools,
      disallowedTools: presetConfig.disallowedTools,
      enableFileCheckpointing: enableCheckpointing,
      outputFormat,
      maxBudgetUsd,
      maxTurns,
      // Use new thinking config (SDK 0.2.57+) instead of deprecated maxThinkingTokens
      thinking: maxThinkingTokens !== undefined
        ? { type: "enabled" as const, budgetTokens: maxThinkingTokens }
        : undefined,
      settingSources,
      betas,
      model,
      // Pass effort level to SDK as first-class option (SDK 0.2.57+)
      ...(effort ? { effort: effort as "low" | "medium" | "high" | "max" } : {}),
      fallbackModel,
      // Custom session ID — aligns SDK session with our conversation ID (SDK v0.2.33+)
      ...(customSessionId ? { sessionId: customSessionId } : {}),
      forkSession,
      // Programmatic agent definitions (SDK 0.2.62+)
      ...(programmaticAgents ? { agents: programmaticAgents } : {}),
      // Debug options (SDK v0.2.30+)
      debug: sdkDebug || !!process.env.DEBUG_CLAUDE_AGENT_SDK,
      debugFile: sdkDebugFile,
      stderr: (data: string) => {
        console.error(`[CLI stderr] ${data.trimEnd()}`);
        emit({ type: "agent_stderr", data });
      },
    };

    // ====================================================================
    // Persistent message generator factory: creates a fresh generator per
    // query() call. Each generator yields user messages across turns.
    // On recovery, the old generator is canceled (via messageWaiter(null))
    // and a new one is created for the new query() call.
    // ====================================================================
    function createMessageStream(): AsyncGenerator<SDKUserMessage> {
      async function* messageStream(): AsyncGenerator<SDKUserMessage> {
        while (mainLoopRunning) {
          const msg = await waitForNextMessage();
          if (!msg) {
            debug("messageStream: no more messages, returning");
            break;
          }

          turnCount++;
          currentTurnStartTime = Date.now();
          const attachInfo = msg.attachments?.map(a => `${a.type}:${a.name}:${Math.round((a.base64Data?.length ?? 0) / 1024)}KB`).join(", ") || "none";
          lifecycle(`turn ${turnCount}: content=${msg.content.length} chars, attachments=[${attachInfo}]`);
          debug(`Turn ${turnCount} starting: content="${msg.content.slice(0, 80)}"`);

          // Reset per-turn state
          blockBuffer = "";
          parentTurnHadAssistantText = false;
          resetRunStats();

          // Update workspace context with current session ID if it changed.
          // When backendSessionId is provided, keep using it — the SDK's internal
          // session UUID is different from the backend session ID and must not
          // overwrite it (MCP tools need the backend session ID for API calls).
          if (!backendSessionId && currentSessionId && workspaceContext.sessionId !== currentSessionId) {
            workspaceContext.updateSessionId(currentSessionId);
          }

          const sdkMessage = buildUserMessage(msg);
          lifecycle(`buildUserMessage done: ${JSON.stringify(sdkMessage).length} bytes`);
          yield sdkMessage;
        }
      }
      return messageStream();
    }

    // ====================================================================
    // Query loop with CLI crash recovery.
    // If the CLI child process crashes (exit code 1), we retry query()
    // with resume: currentSessionId so the new CLI process loads the
    // previous session state. The agent-runner Node.js process stays alive
    // with its message queue, stdin listener, and all state intact.
    // ====================================================================
    const MAX_CLI_RECOVERY = 2;
    let cliRecoveryAttempts = 0;

    while (true) {
      try {
        // Fresh AbortController per attempt (old one may be aborted)
        const sessionAbortController = new AbortController();
        abortControllerRef = sessionAbortController;

        lifecycle("calling query()");
        const result = query({
          prompt: createMessageStream(),
          options: {
            ...queryOptions,
            abortController: sessionAbortController,
            // Resume uses currentSessionId on recovery, or resumeSessionId on first attempt
            resume: currentSessionId || resumeSessionId,
          },
        });

        queryRef = result;
        lifecycle("query() returned, entering message loop");

        // ====================================================================
        // Process ALL messages from ALL turns in a single loop.
        // Result messages mark turn boundaries but don't end the session.
        // ====================================================================
        let sdkMessageCount = 0;
        for await (const message of result) {
          sdkMessageCount++;
          if (sdkMessageCount === 1) {
            lifecycle(`first SDK message: type=${message.type}`);
          }
          handleMessage(message);

          // Result messages mark the end of a turn — but only for parent-agent results.
          // Sub-agent result messages are handled inside handleMessage (Issue 5).
          if (message.type === "result") {
            const msgSid = "session_id" in message ? (message as { session_id?: string }).session_id : undefined;
            const isSubAgent = msgSid ? sessionToAgentId.has(msgSid) : false;
            if (isSubAgent) continue; // Skip sub-agent results — don't emit turn_complete

            flushBlockBuffer();

            const turnDurationMs = Date.now() - currentTurnStartTime;
            debug(`Turn ${turnCount} completed in ${turnDurationMs}ms (sessionId=${currentSessionId})`);

            emit({ type: "turn_complete", sessionId: currentSessionId });
            currentTurnStartTime = 0;

            // Reset recovery counter on successful turn — fresh retries for future crashes
            cliRecoveryAttempts = 0;

            // Check for auth errors in result
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.subtype !== "success") {
              const resultErrors = "errors" in resultMsg ? resultMsg.errors : [];
              const errorText = Array.isArray(resultErrors) ? resultErrors.join(" ") : String(resultErrors);
              if (detectAuthError(errorText)) {
                emit({
                  type: "auth_error",
                  message: getAuthErrorMessage(),
                });
                // Auth errors are fatal — break out to stop the session
                stopMainLoop();
              }
            }
          }
        }

        // Normal exit — session ended (generator returned or CLI exited cleanly)
        queryRef = null;
        flushBlockBuffer();
        lifecycle(`session ended after ${turnCount} turns, ${sdkMessageCount} SDK messages`);
        emit({ type: "complete", sessionId: currentSessionId });
        debug(`Session ended after ${turnCount} turns`);
        break; // Exit retry loop

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        lifecycle(`query error: ${errMsg.slice(0, 200)}`);

        // Non-retriable errors — throw to top-level handler
        if (detectAuthError(errMsg) || !mainLoopRunning) throw err;

        const isProcessCrash = errMsg.includes("process exited") || errMsg.includes("exit code");
        if (!isProcessCrash || cliRecoveryAttempts >= MAX_CLI_RECOVERY) throw err;

        // CLI process crashed — attempt silent recovery
        queryRef = null;

        // Cancel old generator's pending wait so a fresh one can be created
        if (messageWaiter) {
          messageWaiter(null);
          messageWaiter = null;
        }

        cliRecoveryAttempts++;
        const delay = cliRecoveryAttempts * 1500; // 1.5s, 3s
        debug(`CLI crashed, recovering (attempt ${cliRecoveryAttempts}/${MAX_CLI_RECOVERY}), session=${currentSessionId}`);
        emit({
          type: "session_recovering",
          attempt: cliRecoveryAttempts,
          maxAttempts: MAX_CLI_RECOVERY,
          sessionId: currentSessionId,
        });
        await new Promise(r => setTimeout(r, delay));
      }
    }
  } catch (err) {
    // Re-throw to let the top-level handler deal with cleanup and exit
    throw err;
  }
}

const AUTH_ERROR_PATTERNS = [
  // Anthropic API patterns
  "authentication_error",
  "oauth token has expired",
  "oauth token expired",
  "invalid api key",
  "invalid x-api-key",
  "401 unauthorized",
  "status 401",
  "http 401",
  "request unauthorized",
  "unauthorized request",
  "token has been revoked",
  // AWS Bedrock patterns
  "expiredtoken",
  "expired token",
  "the security token included in the request is expired",
  "accessdeniedexception: unable to locate credentials",
  "accessdeniedexception: unable to assume role",
  "accessdeniedexception: expired",
  "unable to locate credentials",
  "could not resolve credentials",
  "invalid identity token",
];

function detectAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}

function getAuthErrorMessage(): string {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === "true") {
    return "AWS credentials expired or invalid. Run 'aws sso login' (or your configured auth refresh command) in a terminal, then retry.";
  }
  return "Authentication failed. Your OAuth token may have expired or your API key is invalid. Check your API key in Settings > Claude Code.";
}

function handleMessage(message: SDKMessage): void {
  // Extract session_id from any message that has it
  if ("session_id" in message && message.session_id) {
    if (!currentSessionId || currentSessionId !== message.session_id) {
      currentSessionId = message.session_id;
      emit({ type: "session_id_update", sessionId: currentSessionId });
    }
  }

  // Skip messages from sub-agent sessions — their tools are already tracked via hooks
  // (preToolUseHook / postToolUseHook emit tool_start/tool_end with agentId).
  // Processing them here would duplicate tool events at the parent level without agentId.
  const msgSessionId = "session_id" in message ? (message as { session_id?: string }).session_id : undefined;
  const isSubAgentMessage = msgSessionId ? sessionToAgentId.has(msgSessionId) : false;

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
          } else if (block.type === "tool_use" && !isSubAgentMessage) {
            // Skip sub-agent tool_use blocks — hooks handle those with agentId.
            // Flush any buffered text before tool starts
            flushBlockBuffer();

            // Tool use started
            activeTools.set(block.id, {
              tool: block.name,
              startTime: Date.now(),
              input: block.input as Record<string, unknown> | undefined,
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

      // Extract per-message usage for context meter — skip sub-agent messages
      // to avoid overwriting the parent conversation's context usage.
      if (!isSubAgentMessage) {
        const msgUsage = (message.message as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
        debug(`[context_usage] assistant message usage: ${JSON.stringify(msgUsage)}, isSubAgent=${isSubAgentMessage}, sessionId=${msgSessionId}`);
        if (msgUsage) {
          emit({
            type: "context_usage",
            inputTokens: msgUsage.input_tokens ?? 0,
            outputTokens: msgUsage.output_tokens ?? 0,
            cacheReadInputTokens: msgUsage.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: msgUsage.cache_creation_input_tokens ?? 0,
          });
        }
      }
      break;
    }

    case "stream_event": {
      // Partial streaming message — skip sub-agent stream events to avoid
      // duplicating their text/thinking into the parent's output.
      if (isSubAgentMessage) break;

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
      } else if (event.type === "content_block_stop") {
        // Text block finished — flush any remaining buffered content so text
        // is fully emitted before subsequent tool events.
        flushBlockBuffer();
      } else if (event.type === "error") {
        // Surface API-level errors (e.g., overloaded_error) during streaming
        const errorEvent = event as { error?: { type?: string; message?: string } };
        const errorType = errorEvent.error?.type || "unknown";
        const errorMsg = errorEvent.error?.message || "An API error occurred during streaming";
        emit({
          type: "warning",
          message: `API error (${errorType}): ${errorMsg}`,
        });
      }
      break;
    }

    case "user": {
      // Tool result or user message replay
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result" && !isSubAgentMessage) {
            // Skip sub-agent tool_result blocks — hooks handle those with agentId.
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

            // Extract full output for persistence (capped at 100KB to match backend truncateOutput)
            const MAX_TOOL_OUTPUT = 100 * 1024;
            let stdout = "";
            if (typeof block.content === "string") {
              stdout = block.content.slice(0, MAX_TOOL_OUTPUT);
            } else if (Array.isArray(block.content)) {
              const textContent = block.content.find(
                (c: { type: string }) => c.type === "text"
              );
              if (textContent && "text" in textContent) {
                stdout = (textContent as { text: string }).text.slice(0, MAX_TOOL_OUTPUT);
              }
            }

            // Tools whose success output is not useful to persist (file contents, glob lists)
            const SKIP_OUTPUT_TOOLS = new Set(["Read", "Write", "Edit", "Glob", "NotebookEdit"]);
            const shouldIncludeOutput = isError || !SKIP_OUTPUT_TOOLS.has(toolInfo?.tool ?? "");

            // Extract lightweight structured metadata (line counts, match counts, etc.)
            const metadata = toolInfo ? extractToolMetadata(toolInfo.tool, block.content, toolInfo.input) : undefined;

            if (toolInfo) {
              const duration = Date.now() - toolInfo.startTime;
              trackToolEnd(duration);
              completedToolNames.set(block.tool_use_id, toolInfo.tool);
              emit({
                type: "tool_end",
                id: block.tool_use_id,
                tool: toolInfo.tool,
                success: !isError,
                summary,
                duration,
                ...(shouldIncludeOutput && stdout ? { stdout } : {}),
                ...(metadata ? { metadata } : {}),
              });
              activeTools.delete(block.tool_use_id);
            } else if (completedToolNames.has(block.tool_use_id)) {
              // Duplicate tool_result during session replay — tool already completed.
              // Skip to avoid duplicate tool_end events with wrong tool names.
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
                ...(shouldIncludeOutput && stdout ? { stdout } : {}),
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
      // Filter sub-agent result messages (Issues 4 & 5):
      // Sub-agent results must NOT trigger parent-level finalization.
      // Instead, capture the result text and emit a subagent_output event.
      if (isSubAgentMessage) {
        const agentId = sessionToAgentId.get(msgSessionId!);
        const resultMsg = message as SDKResultMessage;
        if (agentId) {
          emit({
            type: "subagent_output",
            agentId,
            agentOutput: resultMsg.subtype === "success" ? resultMsg.result : "",
          });
        }
        break;
      }

      // Extend SDK type with fields that may not yet be in the published type definitions
      const resultMsg = message as SDKResultMessage & {
        checkpoint_uuid?: string;
        message_index?: number;
        permission_denials?: Array<{ tool_name: string; tool_use_id: string; tool_input: unknown }>;
      };

      // If the turn produced no streamed text but the result has content,
      // this was a local command (e.g. /release-notes). Route through
      // processTextChunk so the text gets proper block-buffered paragraph
      // splitting, then flush — consistent with normal streamed output.
      if (!parentTurnHadAssistantText && resultMsg.subtype === "success" && resultMsg.result) {
        processTextChunk(resultMsg.result);
      }

      flushBlockBuffer();

      // Check for checkpoint_uuid in result messages (present when checkpointing is enabled)
      if (resultMsg.checkpoint_uuid) {
        emit({
          type: "checkpoint_created",
          checkpointUuid: resultMsg.checkpoint_uuid,
          messageIndex: resultMsg.message_index || 0,
          isResult: true,
        });
      }

      // Extract permission denials (tools that were denied during this turn)
      const permissionDenials = resultMsg.permission_denials?.length
        ? resultMsg.permission_denials.map((d) => ({
            toolName: d.tool_name,
            toolUseId: d.tool_use_id,
          }))
        : undefined;

      if (resultMsg.subtype === "success") {
        emit({
          type: "result",
          success: true,
          subtype: "success",
          summary: resultMsg.result,
          stopReason: resultMsg.stop_reason,
          cost: resultMsg.total_cost_usd,
          turns: resultMsg.num_turns,
          durationMs: resultMsg.duration_ms,
          durationApiMs: resultMsg.duration_api_ms,
          usage: resultMsg.usage,
          modelUsage: resultMsg.modelUsage,
          structuredOutput: resultMsg.structured_output,
          sessionId: resultMsg.session_id,
          ...(permissionDenials ? { permissionDenials } : {}),
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
        const resultErrors = "errors" in resultMsg ? resultMsg.errors : [];
        emit({
          type: "result",
          success: false,
          subtype: resultMsg.subtype,
          stopReason: resultMsg.stop_reason,
          errors: resultErrors,
          cost: resultMsg.total_cost_usd,
          turns: resultMsg.num_turns,
          durationMs: resultMsg.duration_ms,
          durationApiMs: resultMsg.duration_api_ms,
          usage: resultMsg.usage,
          modelUsage: resultMsg.modelUsage,
          sessionId: resultMsg.session_id,
          ...(permissionDenials ? { permissionDenials } : {}),
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

        // Check if the error is auth-related and emit a user-friendly auth_error event
        const errorText = Array.isArray(resultErrors) ? resultErrors.join(" ") : String(resultErrors);
        if (detectAuthError(errorText)) {
          emit({
            type: "auth_error",
            message: getAuthErrorMessage(),
          });
        }
      }

      // NOTE: result.usage is cumulative across all API calls in the agentic loop,
      // so we do NOT emit it as context_usage — it would overwrite the correct
      // per-call data emitted per assistant message in the "assistant" case above.
      debug(`[context_usage] result usage (cumulative, not emitted): ${JSON.stringify(resultMsg.usage)}`);

      debug(`[context_usage] result modelUsage: ${JSON.stringify(resultMsg.modelUsage)}`);

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
      const sysMsg = message as SDKSystemMessage | SDKCompactBoundaryMessage | SDKStatusMessage | SDKHookResponseMessage | SDKTaskNotificationMessage | SDKTaskStartedMessage | SDKTaskProgressMessage | SDKFilesPersistedEvent;

      if (sysMsg.subtype === "init") {
        const initMsg = sysMsg as SDKSystemMessage;
        lifecycle(`SDK init: slash_commands=${JSON.stringify(initMsg.slash_commands)}, skills=${JSON.stringify(initMsg.skills)}, plugins=${JSON.stringify(initMsg.plugins)}`);
        emit({
          type: "init",
          model: initMsg.model,
          tools: initMsg.tools,
          mcpServers: initMsg.mcp_servers,
          mcpServerSources,
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
            effort,
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
        // SDK emits permissionMode in status messages when the mode changes
        // (e.g., after ExitPlanMode executes). Propagate to Go backend/frontend.
        if (statusMsg.permissionMode) {
          // Guard against SDK bug #15755: after ExitPlanMode, the SDK may emit
          // a stale status with permissionMode "plan" even though we already
          // restored the mode. Suppress these to prevent the plan-mode loop.
          if (statusMsg.permissionMode === "plan" && suppressStalePlanMode) {
            debug(`Suppressing stale SDK plan mode status (already exited plan mode)`);
          } else {
            // Clear suppression when SDK confirms a non-plan mode
            if (statusMsg.permissionMode !== "plan") {
              suppressStalePlanMode = false;
            }
            currentPermissionMode = statusMsg.permissionMode;
            emit({ type: "permission_mode_changed", mode: statusMsg.permissionMode, source: "sdk_status" });
          }
        }
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
      } else if (sysMsg.subtype === "task_notification") {
        const taskMsg = sysMsg as SDKTaskNotificationMessage;
        // Emit usage data for completed subagents (correlate via tool_use_id)
        if (taskMsg.usage && taskMsg.tool_use_id) {
          emit({
            type: "subagent_usage",
            toolUseId: taskMsg.tool_use_id,
            usage: {
              totalTokens: taskMsg.usage.total_tokens,
              toolUses: taskMsg.usage.tool_uses,
              durationMs: taskMsg.usage.duration_ms,
            },
          });
        }
      } else if (sysMsg.subtype === "task_started") {
        // Background task (sub-agent) started (SDK 0.2.51+)
        const taskMsg = sysMsg as SDKTaskStartedMessage;
        emit({
          type: "task_started",
          taskId: taskMsg.task_id,
          toolUseId: taskMsg.tool_use_id,
          description: taskMsg.description,
          sessionId: taskMsg.session_id,
        });
      } else if (sysMsg.subtype === "task_progress") {
        // Background task (sub-agent) progress with cumulative usage (SDK 0.2.51+)
        const taskMsg = sysMsg as SDKTaskProgressMessage;
        emit({
          type: "task_progress",
          taskId: taskMsg.task_id,
          toolUseId: taskMsg.tool_use_id,
          description: taskMsg.description,
          usage: taskMsg.usage,
          lastToolName: taskMsg.last_tool_name,
          sessionId: taskMsg.session_id,
        });
      } else if (sysMsg.subtype === "files_persisted") {
        // File checkpoint persisted to disk (SDK 0.2.51+)
        const fpMsg = sysMsg as SDKFilesPersistedEvent;
        emit({
          type: "files_persisted",
          files: fpMsg.files,
          failed: fpMsg.failed,
          processedAt: fpMsg.processed_at,
          sessionId: fpMsg.session_id,
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

    default: {
      // Forward new/unknown message types to the Go backend (SDK 0.2.51+).
      // This handles SDKRateLimitEvent, SDKPromptSuggestionMessage, SDKToolUseSummaryMessage
      // and any future types added by newer SDK versions without code changes.
      // Prefix with "sdk_" to avoid collisions with internal event types.
      const anyMsg = message as { type: string; session_id?: string; [key: string]: unknown };
      debug(`Forwarding unhandled SDK message type: ${anyMsg.type}`);
      emit({
        type: `sdk_${anyMsg.type}`,
        sessionId: anyMsg.session_id,
        data: anyMsg,
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

  // 3b. Cancel all pending plan approval requests
  for (const [requestId, pending] of pendingPlanApprovalRequests) {
    pending.reject(new Error(`Cleanup: ${reason}`));
    pendingPlanApprovalRequests.delete(requestId);
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

  // 4b. Emit tool_end for any in-flight sub-agent tools
  for (const [toolId, toolInfo] of subagentActiveTools) {
    const duration = Date.now() - toolInfo.startTime;
    emit({
      type: "tool_end",
      id: toolId,
      tool: toolInfo.tool,
      success: false,
      summary: `Interrupted: ${reason}`,
      duration,
      agentId: toolInfo.agentId,
    });
  }
  subagentActiveTools.clear();

  // 5. Flush any remaining buffered text
  flushBlockBuffer();

  // 5b. Clean up any temp image files that haven't been cleaned by their deferred timers
  for (const filePath of pendingTempFiles) {
    try {
      unlinkSync(filePath);
      debug(`Cleanup: removed temp image: ${filePath}`);
    } catch {
      // File may already be gone — that's fine
    }
  }
  pendingTempFiles.clear();

  // 6. Interrupt the query if active (may be null between turns).
  // Note: MCP servers (chatmlMcp and user-configured servers) are managed by the SDK
  // session lifecycle — interrupting the query tears down the session and its MCP connections.
  if (queryRef) {
    try {
      await queryRef.interrupt();
    } catch {
      // Ignore errors during shutdown
    }
    // Force-close the query to ensure the subprocess is terminated (SDK v0.2.15+).
    // close() kills the process immediately — useful when interrupt() alone isn't enough.
    try {
      queryRef.close();
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

// Drain stdout before exiting to ensure all emitted events reach the Go backend.
// console.log uses buffered I/O when stdout is a pipe; process.exit() would
// terminate before the buffer is flushed, silently dropping error events.
function drainAndExit(code: number): void {
  // If stdout is already destroyed or not writable, exit immediately
  if (!process.stdout.writable) {
    process.exit(code);
    return;
  }
  // Write an empty string and wait for the callback — this ensures all
  // previously buffered data has been flushed to the OS pipe.
  process.stdout.write("", () => {
    process.exit(code);
  });
  // Safety net: if the drain callback never fires (broken pipe, etc.),
  // force-exit after a short timeout so we don't hang forever.
  setTimeout(() => process.exit(code), 500).unref();
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanup("SIGTERM").finally(() => drainAndExit(0));
});

process.on("SIGINT", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cleanup("SIGINT").finally(() => drainAndExit(0));
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
  drainAndExit(1);
});

main().catch(async (err) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await cleanup("error");
  const errorMessage =
    err instanceof Error ? `${err.message}\n${err.stack || ""}` : String(err);

  // Check if the fatal error is auth-related and emit a specific event
  if (detectAuthError(errorMessage)) {
    emit({
      type: "auth_error",
      message: getAuthErrorMessage(),
    });
  }

  emit({ type: "error", message: `Unhandled error: ${errorMessage}` });
  drainAndExit(1);
});
