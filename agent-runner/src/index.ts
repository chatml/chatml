import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "readline";

// CLI arguments
const args = process.argv.slice(2);
const cwdIndex = args.indexOf("--cwd");
const conversationIdIndex = args.indexOf("--conversation-id");

const cwd = cwdIndex !== -1 ? args[cwdIndex + 1] : process.cwd();
const conversationId = conversationIdIndex !== -1 ? args[conversationIdIndex + 1] : "default";

// Output event types for Go backend
interface OutputEvent {
  type: string;
  [key: string]: unknown;
}

function emit(event: OutputEvent): void {
  console.log(JSON.stringify(event));
}

// Input message types from Go backend
interface InputMessage {
  type: "message" | "stop";
  content?: string;
}

// Track if we've suggested a name yet
let hasEmittedNameSuggestion = false;
let accumulatedText = "";

// Create async generator for streaming input mode
async function* createMessageStream(): AsyncGenerator<SDKUserMessage> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const input: InputMessage = JSON.parse(line);

      if (input.type === "stop") {
        break;
      }

      if (input.type === "message" && input.content) {
        yield {
          type: "user",
          message: {
            role: "user",
            content: input.content,
          },
        } as SDKUserMessage;
      }
    } catch (err) {
      emit({ type: "error", message: `Failed to parse input: ${err}` });
    }
  }
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

// Buffer for line-level streaming
let lineBuffer = "";

function processTextChunk(text: string): void {
  lineBuffer += text;
  accumulatedText += text;

  // Emit complete lines
  const lines = lineBuffer.split("\n");
  lineBuffer = lines.pop() || ""; // Keep incomplete line in buffer

  for (const line of lines) {
    emit({ type: "assistant_text", content: line + "\n" });
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

function flushLineBuffer(): void {
  if (lineBuffer) {
    emit({ type: "assistant_text", content: lineBuffer });
    lineBuffer = "";
  }
}

// Track active tool uses
const activeTools = new Map<string, { tool: string; startTime: number }>();

async function main(): Promise<void> {
  emit({ type: "ready", conversationId, cwd });

  try {
    const result = query({
      prompt: createMessageStream(),
      options: {
        cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        tools: { type: "preset", preset: "claude_code" },
        systemPrompt: { type: "preset", preset: "claude_code" },
      },
    });

    for await (const message of result) {
      handleMessage(message);
    }

    flushLineBuffer();
    emit({ type: "complete" });
  } catch (err) {
    emit({ type: "error", message: `${err}` });
    process.exit(1);
  }
}

function handleMessage(message: SDKMessage): void {
  switch (message.type) {
    case "assistant": {
      // Full assistant message - extract text content
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            // For full messages, process any remaining text
            processTextChunk(block.text);
          } else if (block.type === "tool_use") {
            // Tool use started
            activeTools.set(block.id, {
              tool: block.name,
              startTime: Date.now(),
            });
            emit({
              type: "tool_start",
              id: block.id,
              tool: block.name,
              params: block.input,
            });
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
              } else if (Array.isArray(block.content)) {
                const textContent = block.content.find(
                  (c: { type: string }) => c.type === "text"
                );
                if (textContent && "text" in textContent) {
                  summary = (textContent as { text: string }).text.slice(0, 100);
                }
              }

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
      break;
    }

    case "result": {
      flushLineBuffer();
      if (message.subtype === "success") {
        emit({
          type: "result",
          success: true,
          summary: message.result,
          cost: message.total_cost_usd,
          turns: message.num_turns,
        });
      } else {
        emit({
          type: "result",
          success: false,
          subtype: message.subtype,
          errors: "errors" in message ? message.errors : [],
        });
      }
      break;
    }

    case "system": {
      if (message.subtype === "init") {
        emit({
          type: "init",
          model: message.model,
          tools: message.tools,
        });
      }
      break;
    }
  }
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  emit({ type: "shutdown", reason: "SIGTERM" });
  process.exit(0);
});

process.on("SIGINT", () => {
  emit({ type: "shutdown", reason: "SIGINT" });
  process.exit(0);
});

main().catch((err) => {
  emit({ type: "error", message: `Unhandled error: ${err}` });
  process.exit(1);
});
