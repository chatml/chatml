# Phases 5-7: Advanced SDK Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the Claude Agent SDK integration by adding file checkpointing, structured outputs, budget controls, and frontend UI for these features.

**Architecture:** Build on existing agent-runner infrastructure. Add new CLI arguments for configuration options. Create new frontend components for checkpoint timeline, structured output display, and budget monitoring. Wire events through existing WebSocket infrastructure.

**Tech Stack:** TypeScript, Claude Agent SDK v0.1.50+, React, Zustand, Go

---

## Phase 5: File Checkpointing & Structured Outputs

### Task 1: Enable File Checkpointing

**Files:**
- Modify: `agent-runner/src/index.ts` (query options)
- Modify: `backend/agent/process.go` (CLI arg forwarding)

**Step 1: Add CLI argument parsing for file checkpointing**

In `agent-runner/src/index.ts`, after line 58 (toolPreset), add:

```typescript
const enableCheckpointingIndex = args.indexOf("--enable-checkpointing");
const enableCheckpointing = enableCheckpointingIndex !== -1;
```

**Step 2: Add enableFileCheckpointing to query options**

In `agent-runner/src/index.ts`, in the query options object (around line 446), add:

```typescript
enableFileCheckpointing: enableCheckpointing,
```

**Step 3: Add CLI arg to Go backend**

In `backend/agent/process.go`, add to ProcessOptions struct:

```go
EnableCheckpointing bool   // Enable file checkpointing for rewind
```

In NewProcessWithOptions, add:

```go
// Add file checkpointing if enabled
if opts.EnableCheckpointing {
    args = append(args, "--enable-checkpointing")
}
```

**Step 4: Build and verify**

```bash
cd agent-runner && npm run build
cd ../backend && go build ./...
```

**Step 5: Commit**

```bash
git add agent-runner/src/index.ts backend/agent/process.go
git commit -m "feat(sdk): add file checkpointing support"
```

---

### Task 2: Add Rewind Files Input Handler

**Files:**
- Modify: `agent-runner/src/index.ts` (input message handling)

**Step 1: Extend InputMessage type**

In `agent-runner/src/index.ts`, update InputMessage interface (around line 72):

```typescript
interface InputMessage {
  type: "message" | "stop" | "interrupt" | "set_model" | "set_permission_mode" |
        "get_supported_models" | "get_supported_commands" | "get_mcp_status" |
        "get_account_info" | "rewind_files";
  content?: string;
  model?: string;
  permissionMode?: string;
  checkpointUuid?: string; // For rewind_files
}
```

**Step 2: Add rewind handler in input processing**

Find the input message handling section (in createMessageStream or where InputMessage is processed) and add a case for rewind_files. Look for where other input types like "interrupt" are handled and add:

```typescript
if (input.type === "rewind_files" && input.checkpointUuid && queryRef) {
  try {
    await queryRef.rewindFiles(input.checkpointUuid);
    emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid, success: true });
  } catch (error) {
    emit({ type: "files_rewound", checkpointUuid: input.checkpointUuid, success: false, error: String(error) });
  }
}
```

**Step 3: Build and verify**

```bash
cd agent-runner && npm run build
```

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(sdk): add rewind files input handler"
```

---

### Task 3: Track Checkpoint UUIDs from Messages

**Files:**
- Modify: `agent-runner/src/index.ts` (message handling)

**Step 1: Extract checkpoint from user messages**

In the handleMessage function, find where SDKUserMessage is processed and add checkpoint extraction. The SDK includes `checkpoint_uuid` in messages when checkpointing is enabled:

```typescript
// In user message handling
if (message.checkpoint_uuid) {
  emit({
    type: "checkpoint_created",
    checkpointUuid: message.checkpoint_uuid,
    messageIndex: message.message_index || 0
  });
}
```

**Step 2: Extract checkpoint from result messages**

Similarly for SDKResultMessage:

```typescript
// In result message handling
if (message.checkpoint_uuid) {
  emit({
    type: "checkpoint_created",
    checkpointUuid: message.checkpoint_uuid,
    messageIndex: message.message_index || 0,
    isResult: true
  });
}
```

**Step 3: Build and verify**

```bash
cd agent-runner && npm run build
```

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(sdk): emit checkpoint events from messages"
```

---

### Task 4: Add Structured Output Support

**Files:**
- Modify: `agent-runner/src/index.ts`
- Modify: `backend/agent/process.go`

**Step 1: Add CLI arguments for structured output schema**

In `agent-runner/src/index.ts`, add schema configuration. For now, support a basic "summary" schema that can be enabled:

```typescript
const structuredOutputIndex = args.indexOf("--structured-output");
const structuredOutputSchema = structuredOutputIndex !== -1 ? args[structuredOutputIndex + 1] : undefined;

// Parse schema if provided (expects JSON string)
let outputFormat: { type: 'json_schema'; schema: unknown } | undefined;
if (structuredOutputSchema) {
  try {
    outputFormat = {
      type: 'json_schema',
      schema: JSON.parse(structuredOutputSchema)
    };
  } catch (e) {
    emit({ type: "warning", message: `Invalid structured output schema: ${e}` });
  }
}
```

**Step 2: Add outputFormat to query options**

In query options, add:

```typescript
outputFormat,
```

**Step 3: Add CLI arg forwarding in Go backend**

In `backend/agent/process.go`, add to ProcessOptions:

```go
StructuredOutputSchema string // JSON schema for structured output
```

And in NewProcessWithOptions:

```go
if opts.StructuredOutputSchema != "" {
    args = append(args, "--structured-output", opts.StructuredOutputSchema)
}
```

**Step 4: Verify structured output is already emitted**

The result handler should already emit `structuredOutput` - verify this exists in the result handling code (around line 628 based on research).

**Step 5: Build and verify**

```bash
cd agent-runner && npm run build
cd ../backend && go build ./...
```

**Step 6: Commit**

```bash
git add agent-runner/src/index.ts backend/agent/process.go
git commit -m "feat(sdk): add structured output support"
```

---

## Phase 6: Advanced Features

### Task 5: Add Budget Controls

**Files:**
- Modify: `agent-runner/src/index.ts`
- Modify: `backend/agent/process.go`

**Step 1: Add CLI arguments for budget controls**

In `agent-runner/src/index.ts`, after other CLI parsing:

```typescript
const maxBudgetIndex = args.indexOf("--max-budget-usd");
const maxTurnsIndex = args.indexOf("--max-turns");
const maxThinkingTokensIndex = args.indexOf("--max-thinking-tokens");

const maxBudgetUsd = maxBudgetIndex !== -1 ? parseFloat(args[maxBudgetIndex + 1]) : undefined;
const maxTurns = maxTurnsIndex !== -1 ? parseInt(args[maxTurnsIndex + 1], 10) : undefined;
const maxThinkingTokens = maxThinkingTokensIndex !== -1 ? parseInt(args[maxThinkingTokensIndex + 1], 10) : undefined;
```

**Step 2: Add to query options**

```typescript
maxBudgetUsd,
maxTurns,
maxThinkingTokens,
```

**Step 3: Add to Go ProcessOptions**

```go
MaxBudgetUsd       float64 // Maximum budget in USD
MaxTurns           int     // Maximum conversation turns
MaxThinkingTokens  int     // Maximum thinking tokens
```

**Step 4: Add CLI arg forwarding in Go**

```go
if opts.MaxBudgetUsd > 0 {
    args = append(args, "--max-budget-usd", fmt.Sprintf("%.2f", opts.MaxBudgetUsd))
}
if opts.MaxTurns > 0 {
    args = append(args, "--max-turns", strconv.Itoa(opts.MaxTurns))
}
if opts.MaxThinkingTokens > 0 {
    args = append(args, "--max-thinking-tokens", strconv.Itoa(opts.MaxThinkingTokens))
}
```

**Step 5: Build and verify**

```bash
cd agent-runner && npm run build
cd ../backend && go build ./...
```

**Step 6: Commit**

```bash
git add agent-runner/src/index.ts backend/agent/process.go
git commit -m "feat(sdk): add budget controls (maxBudgetUsd, maxTurns, maxThinkingTokens)"
```

---

### Task 6: Add Settings Sources Configuration

**Files:**
- Modify: `agent-runner/src/index.ts`

**Step 1: Add CLI argument**

```typescript
const settingSourcesIndex = args.indexOf("--setting-sources");
const settingSourcesArg = settingSourcesIndex !== -1 ? args[settingSourcesIndex + 1] : undefined;

// Parse comma-separated list: "project,user,local"
const settingSources = settingSourcesArg
  ? settingSourcesArg.split(',').map(s => s.trim()) as ('project' | 'user' | 'local')[]
  : undefined;
```

**Step 2: Add to query options**

```typescript
settingSources,
```

**Step 3: Build and verify**

```bash
cd agent-runner && npm run build
```

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(sdk): add settingSources for CLAUDE.md loading"
```

---

### Task 7: Add Beta Features Flag

**Files:**
- Modify: `agent-runner/src/index.ts`

**Step 1: Add CLI argument**

```typescript
const betasIndex = args.indexOf("--betas");
const betasArg = betasIndex !== -1 ? args[betasIndex + 1] : undefined;

// Parse comma-separated list of beta flags
const betas = betasArg ? betasArg.split(',').map(s => s.trim()) : undefined;
```

**Step 2: Add to query options**

```typescript
betas,
```

**Step 3: Build and verify**

```bash
cd agent-runner && npm run build
```

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(sdk): add betas feature flag support"
```

---

### Task 8: Add Model and Fallback Model Configuration

**Files:**
- Modify: `agent-runner/src/index.ts`

**Step 1: Add CLI arguments**

```typescript
const modelIndex = args.indexOf("--model");
const fallbackModelIndex = args.indexOf("--fallback-model");

const model = modelIndex !== -1 ? args[modelIndex + 1] : undefined;
const fallbackModel = fallbackModelIndex !== -1 ? args[fallbackModelIndex + 1] : undefined;
```

**Step 2: Add to query options**

```typescript
model,
fallbackModel,
```

**Step 3: Build and verify**

```bash
cd agent-runner && npm run build
```

**Step 4: Commit**

```bash
git add agent-runner/src/index.ts
git commit -m "feat(sdk): add model and fallback model configuration"
```

---

## Phase 7: Frontend Integration

### Task 9: Add New TypeScript Types

**Files:**
- Modify: `src/lib/types.ts`

**Step 1: Add CheckpointInfo interface**

After AgentTodoItem interface (around line 321), add:

```typescript
// File checkpoint for rewind support
export interface CheckpointInfo {
  uuid: string;
  timestamp: string;
  messageIndex: number;
  isResult?: boolean;
}

// Budget and limits status
export interface BudgetStatus {
  maxBudgetUsd?: number;
  currentCostUsd: number;
  maxTurns?: number;
  currentTurns: number;
  maxThinkingTokens?: number;
  currentThinkingTokens: number;
  limitExceeded?: 'budget' | 'turns' | 'thinking_tokens';
}
```

**Step 2: Add to AgentEvent interface**

In AgentEvent interface, add:

```typescript
// Checkpoint fields
checkpointUuid?: string;
messageIndex?: number;
isResult?: boolean;

// Files rewound event
checkpointsRewound?: string[];
```

**Step 3: Add new event type constants**

In AgentEventTypes, add:

```typescript
// Checkpoint events
CHECKPOINT_CREATED: 'checkpoint_created',
FILES_REWOUND: 'files_rewound',
```

**Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add checkpoint and budget status types"
```

---

### Task 10: Add Checkpoint Timeline Store State

**Files:**
- Modify: `src/stores/appStore.ts`

**Step 1: Add checkpoint state to store**

Find the store state interface and add:

```typescript
// Checkpoint timeline
checkpoints: CheckpointInfo[];
setCheckpoints: (checkpoints: CheckpointInfo[]) => void;
addCheckpoint: (checkpoint: CheckpointInfo) => void;
clearCheckpoints: () => void;

// Budget status
budgetStatus: BudgetStatus | null;
setBudgetStatus: (status: BudgetStatus | null) => void;
```

**Step 2: Implement the actions**

In the store create function, add:

```typescript
checkpoints: [],
setCheckpoints: (checkpoints) => set({ checkpoints }),
addCheckpoint: (checkpoint) => set((state) => ({
  checkpoints: [...state.checkpoints, checkpoint]
})),
clearCheckpoints: () => set({ checkpoints: [] }),

budgetStatus: null,
setBudgetStatus: (budgetStatus) => set({ budgetStatus }),
```

**Step 3: Import types**

Add to imports:

```typescript
import type { CheckpointInfo, BudgetStatus } from '@/lib/types';
```

**Step 4: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(store): add checkpoint timeline and budget status state"
```

---

### Task 11: Create Checkpoint Timeline Component

**Files:**
- Create: `src/components/CheckpointTimeline.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, RotateCcw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function CheckpointTimeline() {
  const { checkpoints, selectedConversationId } = useAppStore();

  const handleRewind = async (uuid: string) => {
    if (!selectedConversationId) return;

    // Send rewind command via WebSocket
    const ws = (window as unknown as { __agentWs?: WebSocket }).__agentWs;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'input',
        conversationId: selectedConversationId,
        payload: JSON.stringify({
          type: 'rewind_files',
          checkpointUuid: uuid
        })
      }));
    }
  };

  if (checkpoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm p-4">
        <History className="w-8 h-8 mb-2 opacity-50" />
        <p>No checkpoints yet</p>
        <p className="text-xs mt-1">Checkpoints are created at message boundaries</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-1">
        <div className="text-xs font-medium text-muted-foreground px-2 mb-2">
          File Checkpoints ({checkpoints.length})
        </div>
        {checkpoints.map((checkpoint, index) => (
          <div
            key={checkpoint.uuid}
            className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">
                  {checkpoint.isResult ? 'After response' : 'Before message'} #{checkpoint.messageIndex}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(checkpoint.timestamp), { addSuffix: true })}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleRewind(checkpoint.uuid)}
              title="Rewind to this checkpoint"
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/CheckpointTimeline.tsx
git commit -m "feat(ui): add checkpoint timeline component"
```

---

### Task 12: Create Budget Status Panel Component

**Files:**
- Create: `src/components/BudgetStatusPanel.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useAppStore } from '@/stores/appStore';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, DollarSign, RefreshCw, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BudgetStatusPanel() {
  const { budgetStatus } = useAppStore();

  if (!budgetStatus) {
    return null;
  }

  const {
    maxBudgetUsd,
    currentCostUsd,
    maxTurns,
    currentTurns,
    maxThinkingTokens,
    currentThinkingTokens,
    limitExceeded,
  } = budgetStatus;

  const budgetPercent = maxBudgetUsd ? (currentCostUsd / maxBudgetUsd) * 100 : 0;
  const turnsPercent = maxTurns ? (currentTurns / maxTurns) * 100 : 0;
  const thinkingPercent = maxThinkingTokens ? (currentThinkingTokens / maxThinkingTokens) * 100 : 0;

  return (
    <div className="p-3 space-y-3">
      {limitExceeded && (
        <div className="flex items-center gap-2 p-2 bg-destructive/10 text-destructive rounded-md text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            {limitExceeded === 'budget' && 'Budget limit exceeded'}
            {limitExceeded === 'turns' && 'Turn limit exceeded'}
            {limitExceeded === 'thinking_tokens' && 'Thinking token limit exceeded'}
          </span>
        </div>
      )}

      {maxBudgetUsd !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              <span>Cost</span>
            </div>
            <span className={cn(budgetPercent >= 90 && 'text-destructive')}>
              ${currentCostUsd.toFixed(4)} / ${maxBudgetUsd.toFixed(2)}
            </span>
          </div>
          <Progress value={budgetPercent} className="h-1" />
        </div>
      )}

      {maxTurns !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <RefreshCw className="w-3 h-3" />
              <span>Turns</span>
            </div>
            <span className={cn(turnsPercent >= 90 && 'text-destructive')}>
              {currentTurns} / {maxTurns}
            </span>
          </div>
          <Progress value={turnsPercent} className="h-1" />
        </div>
      )}

      {maxThinkingTokens !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Brain className="w-3 h-3" />
              <span>Thinking</span>
            </div>
            <span className={cn(thinkingPercent >= 90 && 'text-destructive')}>
              {currentThinkingTokens.toLocaleString()} / {maxThinkingTokens.toLocaleString()}
            </span>
          </div>
          <Progress value={thinkingPercent} className="h-1" />
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/BudgetStatusPanel.tsx
git commit -m "feat(ui): add budget status panel component"
```

---

### Task 13: Create Structured Output Display Component

**Files:**
- Create: `src/components/StructuredOutputDisplay.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Copy, ChevronDown, ChevronRight, FileJson } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StructuredOutputDisplayProps {
  data: unknown;
  className?: string;
}

export function StructuredOutputDisplay({ data, className }: StructuredOutputDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedJson = JSON.stringify(data, null, 2);

  return (
    <div className={cn('border rounded-md bg-muted/30', className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <FileJson className="w-3 h-3" />
          <span>Structured Output</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>
      {expanded && (
        <ScrollArea className="max-h-[300px]">
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">
            {formattedJson}
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/StructuredOutputDisplay.tsx
git commit -m "feat(ui): add structured output display component"
```

---

### Task 14: Update WebSocket Handler for New Events

**Files:**
- Modify: `src/hooks/useWebSocket.ts`

**Step 1: Add checkpoint event handling**

Find the event handling switch/if chain and add:

```typescript
// Handle checkpoint events
if (data.type === 'checkpoint_created') {
  const checkpoint: CheckpointInfo = {
    uuid: data.checkpointUuid as string,
    timestamp: new Date().toISOString(),
    messageIndex: data.messageIndex as number,
    isResult: data.isResult as boolean | undefined,
  };
  useAppStore.getState().addCheckpoint(checkpoint);
  return;
}

// Handle files rewound event
if (data.type === 'files_rewound') {
  // Could show a toast notification here
  console.log('Files rewound to checkpoint:', data.checkpointUuid);
  return;
}
```

**Step 2: Add budget status tracking from result events**

In the result event handling, extract budget info:

```typescript
// In result event handling
if (data.type === 'result') {
  const budgetStatus: BudgetStatus | undefined = data.cost !== undefined ? {
    currentCostUsd: data.cost as number,
    currentTurns: data.turns as number || 0,
    currentThinkingTokens: 0, // Not tracked separately yet
    limitExceeded: data.subtype === 'error_max_budget_usd' ? 'budget'
                 : data.subtype === 'error_max_turns' ? 'turns'
                 : undefined,
  } : undefined;

  if (budgetStatus) {
    useAppStore.getState().setBudgetStatus(budgetStatus);
  }
  // ... existing result handling
}
```

**Step 3: Import types**

Add to imports:

```typescript
import type { CheckpointInfo, BudgetStatus } from '@/lib/types';
```

**Step 4: Clear checkpoints on new conversation**

Find where conversation changes are handled and add:

```typescript
// When conversation changes
useAppStore.getState().clearCheckpoints();
useAppStore.getState().setBudgetStatus(null);
```

**Step 5: Commit**

```bash
git add src/hooks/useWebSocket.ts
git commit -m "feat(ws): handle checkpoint and budget events"
```

---

### Task 15: Integrate New Components into Right Sidebar

**Files:**
- Modify: `src/components/ChangesPanel.tsx`

**Step 1: Import new components**

Add imports:

```typescript
import { CheckpointTimeline } from '@/components/CheckpointTimeline';
import { BudgetStatusPanel } from '@/components/BudgetStatusPanel';
```

**Step 2: Add Checkpoints tab to output section**

Update the outputTab state type:

```typescript
const [outputTab, setOutputTab] = useState<'setup' | 'run' | 'mcp' | 'checkpoints'>('setup');
```

Add button for checkpoints tab alongside MCP:

```typescript
<Button
  variant={outputTab === 'checkpoints' ? 'secondary' : 'ghost'}
  size="sm"
  className="h-6 text-xs px-2"
  onClick={() => setOutputTab('checkpoints')}
>
  History
</Button>
```

Add render case for checkpoints:

```typescript
{outputTab === 'checkpoints' && (
  <CheckpointTimeline />
)}
```

**Step 3: Add budget panel above output section (if budget is active)**

Before the output tabs section, add:

```typescript
<BudgetStatusPanel />
```

**Step 4: Commit**

```bash
git add src/components/ChangesPanel.tsx
git commit -m "feat(ui): integrate checkpoint timeline and budget panel"
```

---

### Task 16: Final Build and Integration Test

**Step 1: Build everything**

```bash
cd agent-runner && npm run build
cd ../backend && go build ./...
cd .. && npm run build
```

**Step 2: Verify no TypeScript errors**

```bash
npm run lint
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Phases 5-7 advanced SDK features

Phase 5: File Checkpointing & Structured Outputs
- Enable file checkpointing via --enable-checkpointing
- Add rewind files input handler
- Track checkpoint UUIDs from messages
- Add structured output schema support

Phase 6: Advanced Features
- Budget controls (maxBudgetUsd, maxTurns, maxThinkingTokens)
- Settings sources for CLAUDE.md loading
- Beta feature flags
- Model and fallback model configuration

Phase 7: Frontend Integration
- CheckpointInfo and BudgetStatus types
- Checkpoint timeline component
- Budget status panel
- Structured output display component
- WebSocket handler updates for new events

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After completing all tasks, verify:

1. **File Checkpointing**
   - [ ] `--enable-checkpointing` CLI arg works
   - [ ] Checkpoint events emitted from messages
   - [ ] Rewind files command accepted

2. **Structured Outputs**
   - [ ] `--structured-output '{...}'` CLI arg works
   - [ ] Structured output displayed in UI

3. **Budget Controls**
   - [ ] `--max-budget-usd 5.00` limits spending
   - [ ] `--max-turns 50` limits turns
   - [ ] Budget panel shows current usage

4. **Settings Sources**
   - [ ] `--setting-sources project` loads project settings

5. **Beta Features**
   - [ ] `--betas flag1,flag2` passes to SDK

6. **Frontend**
   - [ ] Checkpoint timeline shows history
   - [ ] Budget panel displays limits
   - [ ] New tabs appear in right sidebar

---

## Summary

| Phase | Tasks | Key Features |
|-------|-------|--------------|
| 5 | 1-4 | File checkpointing, structured outputs |
| 6 | 5-8 | Budget controls, settings, betas, model config |
| 7 | 9-16 | TypeScript types, UI components, WebSocket |

**Total Tasks:** 16
**Estimated Time:** 2-3 hours with subagent-driven development
