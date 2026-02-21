# Plan: Model Abstraction Layer

**Goal**: Decouple ChatML from the Claude Agent SDK so the architecture supports multiple AI providers (OpenAI, Google, local models) while keeping Claude as the default and best-supported provider.

**Estimated effort**: 3-4 weeks for a single engineer, or 2 weeks with two.

---

## Current State: Coupling Map

ChatML is coupled to Claude/Anthropic in **20 distinct points** across all four layers:

### Hard Coupling (requires major refactoring)

| # | File | What | Lines |
|---|------|------|-------|
| 1 | `agent-runner/src/index.ts` | SDK imports — 15+ Claude-specific types | 1-25 |
| 2 | `agent-runner/src/index.ts` | `query()` — core execution engine | 1675-1699 |
| 3 | `agent-runner/src/index.ts` | Tool presets — `claude_code` hardcoded | 1587-1590 |
| 4 | `agent-runner/src/index.ts` | Hooks system — 10 SDK-specific hook types | 945-1454 |
| 5 | `agent-runner/src/index.ts` | Message/content format — Claude content blocks | 715-818 |
| 6 | `agent-runner/src/index.ts` | SDK-specific commands (setModel, setPermission, etc.) | 457-577 |
| 7 | `agent-runner/src/index.ts` | Beta features — provider-specific flags | 151-153 |
| 8 | `agent-runner/src/mcp/server.ts` | `createSdkMcpServer()` — SDK MCP factory | Line 51 |
| 9 | `agent-runner/src/mcp/tools/*.ts` | `tool()` function from SDK for tool definitions | Line 2+ |
| 10 | `agent-runner/package.json` | `@anthropic-ai/claude-agent-sdk` dependency | Line 13 |

### Medium Coupling (conditional/feature-flag approach)

| # | File | What | Lines |
|---|------|------|-------|
| 11 | `agent-runner/src/index.ts` | Extended thinking / effort levels | 108-121 |
| 12 | `agent-runner/src/index.ts` | Structured output format | 88-100 |
| 13 | `agent-runner/src/index.ts` | Permission modes (plan mode is Claude-specific) | 126-143 |
| 14 | `agent-runner/src/index.ts` | Setting sources | 145-149 |
| 15 | `src/lib/models.ts` | Model metadata (supportsThinking, supportsEffort) | 1-5 |

### Easy Coupling (configuration changes only)

| # | File | What | Lines |
|---|------|------|-------|
| 16 | `backend/ai/generate.go` | Default model constants (`claude-sonnet-4-6`) | 15, 48, 63 |
| 17 | `backend/agent/process.go` | Model name strings (already generic) | 267-271 |
| 18 | `src/lib/models.ts` | Hardcoded Claude model list | 1-5 |
| 19 | `src/stores/settingsStore.ts` | Default model settings | 201-202, 212 |
| 20 | `src/components/settings/.../AIModelSettings.tsx` | Hardcoded model dropdown | UI component |

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    agent-runner/src/                         │
│                                                             │
│  index.ts (orchestrator)                                    │
│    │                                                        │
│    ├── providers/                                           │
│    │   ├── types.ts          ← Generic interfaces           │
│    │   ├── claude.ts         ← Claude Agent SDK wrapper     │
│    │   ├── openai.ts         ← OpenAI Agents SDK wrapper    │
│    │   └── registry.ts       ← Provider discovery           │
│    │                                                        │
│    ├── tools/                                               │
│    │   ├── types.ts          ← Generic tool interface       │
│    │   ├── registry.ts       ← Tool registration            │
│    │   └── builtin/          ← Provider-agnostic tools      │
│    │                                                        │
│    └── mcp/                                                 │
│        ├── server.ts         ← Generic MCP server           │
│        └── tools/            ← MCP tool definitions         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    backend/                                  │
│                                                             │
│  ai/                                                        │
│    ├── provider.go           ← Provider interface           │
│    ├── claude.go             ← Claude API client            │
│    └── config.go             ← Model registry from config   │
│                                                             │
│  agent/process.go            ← Passes --provider flag       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    src/ (frontend)                           │
│                                                             │
│  lib/models.ts               ← Fetched from backend API    │
│  stores/settingsStore.ts     ← Dynamic defaults per provider│
│  components/settings/        ← Data-driven model selector  │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Define Provider Interface (Week 1)

### Step 1.1: Create `agent-runner/src/providers/types.ts`

This is the core abstraction. Every provider must implement this interface.

```typescript
// === Core Provider Interface ===

export interface AIProvider {
  readonly name: string;  // "claude", "openai", "gemini", "local"

  // Lifecycle
  initialize(config: ProviderConfig): Promise<void>;
  dispose(): Promise<void>;

  // Core execution — single entry point replacing query()
  execute(options: ExecuteOptions): AsyncIterable<ProviderEvent>;

  // Runtime commands
  setModel(model: string): Promise<void>;
  stop(): Promise<void>;

  // Capabilities
  capabilities(): ProviderCapabilities;
  listModels(): ModelInfo[];
}

// === Configuration ===

export interface ProviderConfig {
  model: string;
  fallbackModel?: string;
  apiKey?: string;
  cwd: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  mcpServers?: McpServerConfig[];
  maxBudgetUsd?: number;
  maxTurns?: number;
  // Provider-specific extensions
  extensions?: Record<string, unknown>;
}

// === Capabilities (what this provider supports) ===

export interface ProviderCapabilities {
  thinking: boolean;         // Extended thinking / chain-of-thought
  effortLevels: boolean;     // low/medium/high/max
  structuredOutput: boolean; // JSON schema responses
  planMode: boolean;         // Plan-before-execute mode
  toolUse: boolean;          // Function calling
  streaming: boolean;        // Streaming responses
  multiTurn: boolean;        // Persistent conversation state
  resume: boolean;           // Resume from session ID
  checkpoints: boolean;      // File state checkpoints
  hooks: boolean;            // Pre/post tool hooks
  subAgents: boolean;        // Spawning sub-agents
}

// === Execution ===

export interface ExecuteOptions {
  messages: AsyncIterable<UserMessage>;  // Replaces createMessageStream()
  resume?: string;                       // Session ID to resume
  abortSignal?: AbortSignal;
  thinking?: ThinkingConfig;
  permissionMode?: string;
  outputFormat?: OutputFormat;
}

export interface ThinkingConfig {
  enabled: boolean;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "max";
}

// === Unified Event Stream ===
// Replaces all Claude-specific SDK message types

export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use_start"; id: string; name: string; input: unknown }
  | { type: "tool_use_end"; id: string; result: unknown; success: boolean }
  | { type: "tool_progress"; id: string; progress: string }
  | { type: "message_complete"; sessionId?: string; usage?: TokenUsage }
  | { type: "checkpoint"; uuid: string }
  | { type: "sub_agent_start"; agentId: string; task: string }
  | { type: "sub_agent_end"; agentId: string }
  | { type: "error"; error: string; code?: string }
  | { type: "status"; message: string }
  | { type: "user_question"; questions: unknown[] }
  | { type: "input_suggestion"; suggestion: unknown }
  | { type: "plan_approval_request"; requestId: string; plan: string }
  | { type: "todo_update"; todos: unknown[] };

// === User Messages ===

export interface UserMessage {
  role: "user";
  content: ContentBlock[];
  attachments?: Attachment[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; base64: string; mimeType: string }
  | { type: "file"; content: string; name: string };

// === Models ===

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: {
    thinking: boolean;
    effort: boolean;
    vision: boolean;
    maxContextWindow: number;
  };
}

// === Tools ===

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  handler: (input: unknown) => Promise<unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  thinkingTokens?: number;
  costUsd?: number;
}
```

### Step 1.2: Create `agent-runner/src/providers/registry.ts`

```typescript
import type { AIProvider } from "./types";

const providers = new Map<string, () => Promise<AIProvider>>();

export function registerProvider(name: string, factory: () => Promise<AIProvider>) {
  providers.set(name, factory);
}

export async function createProvider(name: string): Promise<AIProvider> {
  const factory = providers.get(name);
  if (!factory) {
    throw new Error(`Unknown provider: ${name}. Available: ${[...providers.keys()].join(", ")}`);
  }
  return factory();
}

export function listProviders(): string[] {
  return [...providers.keys()];
}
```

### Step 1.3: Create `agent-runner/src/providers/claude.ts`

Wrap all existing Claude Agent SDK code into the provider interface. This is the **largest file** — essentially extracting and wrapping what's in `index.ts` today.

Key mapping:

| Provider Interface | Claude SDK |
|-------------------|------------|
| `execute()` | `query()` with `createMessageStream()` |
| `ProviderEvent.text` | `SDKMessage` text content |
| `ProviderEvent.thinking` | `SDKMessage` thinking blocks |
| `ProviderEvent.tool_use_start/end` | Hook callbacks |
| `ProviderEvent.message_complete` | `SDKResultMessage` |
| `capabilities().thinking` | `true` |
| `capabilities().planMode` | `true` |
| `capabilities().hooks` | `true` |
| `ToolDefinition` | SDK `tool()` function calls |

The Claude provider internally uses the hooks system, plan mode, tool presets, and all Claude-specific features — but exposes them through the generic `ProviderEvent` stream.

---

## Phase 2: Refactor agent-runner/src/index.ts (Week 1-2)

### Step 2.1: Extract provider initialization

Replace direct SDK imports with provider factory:

```typescript
// Before (current):
import { query, type SDKMessage, ... } from "@anthropic-ai/claude-agent-sdk";

// After:
import { createProvider, type AIProvider, type ProviderEvent } from "./providers";

const providerName = getArg("--provider") || "claude";
const provider = await createProvider(providerName);
await provider.initialize({ model, cwd, ... });
```

### Step 2.2: Replace the query execution loop

The main message loop (lines 1675-1699) becomes:

```typescript
// Before:
const result = query({ prompt: createMessageStream(), options: { ... } });
for await (const message of result) { /* handle SDK types */ }

// After:
const events = provider.execute({
  messages: createMessageStream(),
  resume: sessionId,
  abortSignal: controller.signal,
  thinking: { enabled: true, maxTokens, effort },
  permissionMode,
});
for await (const event of events) { /* handle generic ProviderEvent types */ }
```

### Step 2.3: Replace event handling switch

The massive message type switch becomes a clean event handler:

```typescript
for await (const event of events) {
  switch (event.type) {
    case "text":
      emit({ type: "assistant_text", text: event.text, conversationId });
      break;
    case "thinking":
      emit({ type: "thinking_text", text: event.text, conversationId });
      break;
    case "tool_use_start":
      emit({ type: "tool_start", id: event.id, name: event.name, conversationId });
      break;
    case "tool_use_end":
      emit({ type: "tool_end", id: event.id, success: event.success, conversationId });
      break;
    case "message_complete":
      emit({ type: "assistant_complete", sessionId: event.sessionId, conversationId });
      break;
    // ... other event types
  }
}
```

### Step 2.4: Move hooks into Claude provider

All 10 hook types (lines 945-1454) move into `providers/claude.ts`. The generic interface exposes hooks through the event stream:

- `PreToolUse` hook → Claude provider internally calls hook, emits `tool_use_start` event
- `PostToolUse` hook → Claude provider internally calls hook, emits `tool_use_end` event
- `AskUserQuestion` hook → emits `user_question` event
- `ExitPlanMode` hook → emits `plan_approval_request` event

Other providers can implement their own hook equivalents or skip them entirely.

### Step 2.5: Refactor command handling

Commands like `setModel`, `setPermissionMode`, `setMaxThinkingTokens` (lines 457-577) route through the provider:

```typescript
// Before:
case "setModel": queryRef?.setModel(cmd.model); break;

// After:
case "setModel": provider.setModel(cmd.model); break;
```

Providers that don't support a command silently ignore it (checked via `capabilities()`).

---

## Phase 3: Refactor MCP & Tools (Week 2)

### Step 3.1: Create generic tool registration

Replace SDK-specific `tool()` with generic tool definitions:

```typescript
// Before (agent-runner/src/mcp/tools/linear.ts):
import { tool } from "@anthropic-ai/claude-agent-sdk";
export function createLinearTools() {
  return [tool("get_linear_context", "...", {}, async () => { ... })];
}

// After:
import type { ToolDefinition } from "../../providers/types";
export function createLinearTools(): ToolDefinition[] {
  return [{
    name: "get_linear_context",
    description: "...",
    parameters: {},
    handler: async () => { ... },
  }];
}
```

### Step 3.2: Refactor MCP server creation

Replace `createSdkMcpServer()` with a generic MCP server that works with any provider:

```typescript
// Before (agent-runner/src/mcp/server.ts):
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
return createSdkMcpServer({ name: "chatml", tools: [...] });

// After:
import { createGenericMcpServer } from "./generic-mcp";
return createGenericMcpServer({ name: "chatml", tools: [...] });
```

The Claude provider can still use `createSdkMcpServer` internally if needed — the abstraction is at the boundary.

---

## Phase 4: Backend & Frontend Changes (Week 3)

### Step 4.1: Backend — Add provider to process spawn

**File:** `backend/agent/process.go`

```go
// Add --provider flag to agent-runner spawn
if opts.Provider != "" {
    args = append(args, "--provider", opts.Provider)
}
```

### Step 4.2: Backend — Dynamic model registry

**File:** `backend/ai/config.go` (new)

```go
type ProviderConfig struct {
    Name   string      `json:"name"`
    Models []ModelInfo  `json:"models"`
}

type ModelInfo struct {
    ID           string `json:"id"`
    Name         string `json:"name"`
    Provider     string `json:"provider"`
    Thinking     bool   `json:"supportsThinking"`
    Effort       bool   `json:"supportsEffort"`
    Vision       bool   `json:"supportsVision"`
    MaxContext    int    `json:"maxContextWindow"`
}
```

### Step 4.3: Backend — Models API endpoint

**File:** `backend/server/router.go`

```go
r.Get("/api/models", handlers.ListModels)        // Returns all available models
r.Get("/api/providers", handlers.ListProviders)   // Returns registered providers
```

### Step 4.4: Frontend — Dynamic model list

**File:** `src/lib/models.ts`

Replace hardcoded list with API fetch:

```typescript
// Before:
export const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', ... },
  ...
];

// After:
export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch(`${API_URL}/api/models`);
  return response.json();
}

// Keep a fallback for offline/startup
export const DEFAULT_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'claude', ... },
];
```

### Step 4.5: Frontend — Data-driven settings

**File:** `src/components/settings/sections/AIModelSettings.tsx`

Replace hardcoded dropdowns with data-driven selectors:

```tsx
// Before:
<SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>

// After:
{models.map(model => (
  <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
))}
```

Group by provider when multiple providers are available.

### Step 4.6: Frontend — Settings store defaults

**File:** `src/stores/settingsStore.ts`

```typescript
// Before:
defaultModel: 'claude-opus-4-6',

// After:
defaultModel: 'claude-opus-4-6',  // Still Claude by default
defaultProvider: 'claude',
```

---

## Phase 5: Add Second Provider (Week 3-4, optional but proves the abstraction)

### Step 5.1: Create OpenAI provider stub

**File:** `agent-runner/src/providers/openai.ts`

Implement the `AIProvider` interface using OpenAI's Agents SDK or Responses API. This validates the abstraction actually works.

Key differences to handle:
- OpenAI uses `function_call` instead of `tool_use`
- No extended thinking (chain-of-thought is implicit)
- Different streaming format (SSE vs SDK events)
- No plan mode equivalent
- Different MCP integration approach

### Step 5.2: Register in provider registry

```typescript
// agent-runner/src/providers/index.ts
registerProvider("claude", () => import("./claude").then(m => new m.ClaudeProvider()));
registerProvider("openai", () => import("./openai").then(m => new m.OpenAIProvider()));
```

---

## Migration Strategy

### Key Principle: Zero breakage during migration

Every step maintains backward compatibility. The Claude provider wraps existing code — it doesn't rewrite it. The abstraction layer is additive.

### Migration Order

```
1. Create types.ts (new file, no existing code changes)
2. Create registry.ts (new file)
3. Create claude.ts (extract from index.ts, index.ts still works)
4. Update index.ts to use provider interface (swap)
5. Move hooks into claude.ts (extract)
6. Refactor tools (update imports)
7. Refactor MCP server (update factory)
8. Add backend API endpoints (additive)
9. Update frontend to use API (swap hardcoded → dynamic)
10. (Optional) Add OpenAI provider (new file)
```

### Testing Strategy

- **Unit tests** for each provider (mock the underlying SDK)
- **Integration test**: spawn agent-runner with `--provider claude`, verify event stream
- **Frontend test**: mock `/api/models` endpoint, verify UI renders dynamically
- **Smoke test**: full stack with Claude provider, verify no regressions

---

## File Change Summary

| File | Action | Effort |
|------|--------|--------|
| `agent-runner/src/providers/types.ts` | **Create** | Medium |
| `agent-runner/src/providers/registry.ts` | **Create** | Small |
| `agent-runner/src/providers/claude.ts` | **Create** (extract from index.ts) | Large |
| `agent-runner/src/providers/index.ts` | **Create** | Small |
| `agent-runner/src/index.ts` | **Refactor** (use provider interface) | Large |
| `agent-runner/src/mcp/server.ts` | **Refactor** (generic MCP) | Medium |
| `agent-runner/src/mcp/tools/*.ts` | **Refactor** (generic tool defs) | Medium |
| `agent-runner/package.json` | **Update** (keep claude-agent-sdk as optional) | Small |
| `backend/ai/generate.go` | **Update** (configurable model) | Small |
| `backend/ai/config.go` | **Create** | Small |
| `backend/server/router.go` | **Update** (add endpoints) | Small |
| `backend/server/handlers_models.go` | **Create** | Small |
| `backend/agent/process.go` | **Update** (add --provider flag) | Small |
| `src/lib/models.ts` | **Refactor** (API-driven) | Small |
| `src/stores/settingsStore.ts` | **Update** (add provider field) | Small |
| `src/components/settings/.../AIModelSettings.tsx` | **Refactor** (data-driven) | Small |

**Total new files**: 6
**Total modified files**: 10
**Total lines of new code**: ~1,500-2,000
**Total lines refactored**: ~800-1,000

---

## What NOT to Abstract

Some things should stay Claude-specific intentionally:

1. **Skills system**: Skills are markdown prompts — they work with any model. No abstraction needed.
2. **MCP protocol**: MCP is already a standard. Keep using it as-is.
3. **Git worktree management**: Provider-agnostic by design. No changes needed.
4. **WebSocket streaming format**: The backend → frontend protocol is already generic JSON events.
5. **Database schema**: Provider-agnostic. Model name is just a string column.

The abstraction layer should be **thin and focused**: it wraps the SDK execution boundary and nothing else.
