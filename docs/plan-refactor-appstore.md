# Plan: Refactor appStore.ts (2,100 lines → ~1,200 lines)

**Goal**: Decompose the monolithic `src/stores/appStore.ts` into focused domain stores, reducing its size by ~43% and making each domain independently testable and maintainable.

**Estimated effort**: 5-7 days for a single engineer.
**Risk level**: Medium (cascading deletes and streaming finalization are the tricky parts).

---

## Current State

`appStore.ts` is a 2,100-line Zustand store managing **16 distinct domains**, **124 actions**, and **~50 state properties**. It's 46% of all store code in the project.

### Why It's a Problem

1. **Cognitive overload**: 124 actions in one file — impossible to hold in your head
2. **No domain isolation**: Streaming state, file tabs, terminals, and code review all in one store
3. **Cascading cleanup**: `removeWorkspace` touches 10+ state domains in one action
4. **External state leaks**: `toolTimeouts` Map, `scriptOutputBuffers` Map, and `lastPRRefreshMap` live outside Zustand but are managed by appStore actions
5. **Testing difficulty**: Can't test streaming logic without initializing the entire store

### Existing Store Architecture (Good)

The project already has 12 other stores with clean separation:

| Store | Lines | Purpose |
|-------|-------|---------|
| settingsStore | 479 | User preferences (persisted) |
| tabStore | 312 | Browser tabs (persisted) |
| slashCommandStore | 376 | Slash commands |
| navigationStore | 212 | Back/forward history |
| uiStore | 98 | Toolbar config |
| branchCacheStore | 91 | Branch list caching |
| authStore | 86 | GitHub auth |
| skillsStore | 77 | Skills registry |
| linearAuthStore | 59 | Linear auth |
| connectionStore | 39 | WebSocket status |
| updateStore | 97 | App update state |
| selectors | 485 | Subscription hooks |

The pattern is established. appStore just needs the same treatment.

---

## Decomposition Plan

### Overview

```
appStore.ts (2,100 lines, 124 actions)
  │
  ├── KEEP in appStore (~1,200 lines, ~50 actions)
  │   ├── Core Data Hierarchy (Workspace/Session/Conversation/Message)
  │   ├── Cascading Delete Orchestration
  │   ├── Selection Logic
  │   ├── Message Pagination
  │   ├── Draft Input & Session Toggles
  │   ├── Query Responses (models, commands, account)
  │   ├── Cost Tracking
  │   └── File Watcher
  │
  ├── EXTRACT → streamingStore.ts (~380 lines, 21 actions)
  │   ├── Streaming State (text, segments, thinking)
  │   ├── Active Tools (with timeout management)
  │   ├── Sub-Agents
  │   ├── Plan Mode
  │   ├── Queued Messages
  │   └── Streaming Finalization
  │
  ├── EXTRACT → editorStore.ts (~160 lines, 13 actions)
  │   ├── File Tabs (LRU, pin, dirty)
  │   ├── Selected File Tab
  │   └── Pending Close State
  │
  ├── EXTRACT → terminalStore.ts (~100 lines, 9 actions)
  │   ├── Terminal Sessions (top-level PTY)
  │   ├── Terminal Instances (bottom panel, max 5/session)
  │   ├── Active Terminal Selection
  │   └── Session Output (ring buffer)
  │
  ├── EXTRACT → reviewStore.ts (~130 lines, 10 actions)
  │   ├── Review Comments (per session)
  │   ├── Branch Sync Status
  │   ├── Branch Sync Loading/Dismissed
  │   └── Sync Timestamps
  │
  ├── EXTRACT → interactionStore.ts (~90 lines, 9 actions)
  │   ├── Pending User Questions (AskUserQuestion tool)
  │   ├── Input Suggestions
  │   └── Summaries
  │
  ├── EXTRACT → scriptStore.ts (~80 lines, 4 actions)
  │   ├── Script Runs
  │   ├── Setup Progress
  │   ├── Script Output (external buffer)
  │   └── Version Counter
  │
  └── EXTRACT → mcpStore.ts (~60 lines, 4 actions)
      ├── MCP Server Status
      ├── MCP Server Configs
      ├── MCP Tools by Server
      └── Config Loading State
```

---

## Phase 1: Extract streamingStore (Day 1-2)

**Highest ROI**. The streaming domain is the most complex (21 actions, 9 state properties, external timeout management) and the most self-contained once extracted.

### State to Move

```typescript
// src/stores/streamingStore.ts

interface StreamingStoreState {
  // Per-conversation streaming state
  streamingState: Record<string, StreamingState>;
  activeTools: Record<string, ActiveTool[]>;
  subAgents: Record<string, SubAgent[]>;
  queuedMessage: Record<string, QueuedMessage | null>;
  pendingCheckpointUuid: Record<string, string>;
}
```

### Actions to Move (21)

**Streaming text (6)**:
- `appendStreamingText(conversationId, text)` — segment management
- `setStreaming(conversationId, isStreaming)` — flag + timer
- `setStreamingError(conversationId, error)` — error handling
- `clearStreamingText(conversationId)` — full reset
- `clearStreamingContent(conversationId)` — partial (preserve timer)
- `restoreStreamingFromSnapshot(conversationId, snapshot)` — reconnection recovery

**Thinking (3)**:
- `appendThinkingText(conversationId, text)`
- `setThinking(conversationId, isThinking)`
- `clearThinking(conversationId)`

**Plan mode (4)**:
- `setPlanModeActive(conversationId, active)`
- `setPendingPlanApproval(conversationId, requestId, planContent)`
- `clearPendingPlanApproval(conversationId)`
- `setApprovedPlanContent(conversationId, content)` / `clearApprovedPlanContent`

**Active tools (4)**:
- `addActiveTool(conversationId, tool, opts)` — with 5-min timeout
- `completeActiveTool(conversationId, toolId, success, ...)` — clear timeout
- `updateToolProgress(conversationId, toolId, progress)`
- `clearActiveTools(conversationId)` — clear all + timeouts

**Sub-agents (5)**:
- `addSubAgent`, `completeSubAgent`, `addSubAgentTool`, `completeSubAgentTool`, `setSubAgentOutput`, `clearSubAgents`

**Queued messages (2)**:
- `setQueuedMessage(conversationId, message)`
- `commitQueuedMessage(conversationId)` — **cross-store**: creates Message in appStore

**Finalization (1)**:
- `finalizeStreamingMessage(conversationId, metadata)` — **cross-store**: creates Message + clears everything

**Checkpoint (2)**:
- `setPendingCheckpointUuid(conversationId, uuid)`
- (consumed by finalizeStreamingMessage)

### Cross-Store Communication Pattern

The tricky part: `finalizeStreamingMessage` and `commitQueuedMessage` need to create Messages in appStore.

**Solution**: Export a `createMessageFromStreaming` callback that appStore provides:

```typescript
// streamingStore.ts
export const useStreamingStore = create<StreamingStoreState>((set, get) => ({
  // ...

  finalizeStreamingMessage: (conversationId, metadata) => {
    const state = get();
    const streaming = state.streamingState[conversationId];
    const tools = state.activeTools[conversationId] || [];
    const agents = state.subAgents[conversationId] || [];
    const checkpointUuid = state.pendingCheckpointUuid[conversationId];

    // Build the Message object (timeline, segments, etc.)
    const message = buildMessageFromStreaming(streaming, tools, agents, metadata, checkpointUuid);

    // Push to appStore
    useAppStore.getState().addMessage(message);

    // Clear all streaming state
    set((s) => ({
      streamingState: { ...s.streamingState, [conversationId]: initialStreamingState() },
      activeTools: { ...s.activeTools, [conversationId]: [] },
      subAgents: { ...s.subAgents, [conversationId]: [] },
      pendingCheckpointUuid: omit(s.pendingCheckpointUuid, conversationId),
    }));

    // Clear external timeouts
    clearToolTimeoutsForConversation(conversationId);
  },
}));
```

### External State (stays with this store)

```typescript
// Moved from appStore module scope into streamingStore module scope
const toolTimeouts = new Map<string, NodeJS.Timeout>();

function clearToolTimeoutsForConversation(conversationId: string) { /* ... */ }
function clearToolTimeoutsForConversations(conversationIds: string[]) { /* ... */ }
```

### Cleanup Hook

appStore's `removeConversation` and `removeSession` need to clean streaming state:

```typescript
// In appStore's removeConversation:
removeConversation: (id) => {
  // ... existing cleanup ...

  // Clean streaming state (new)
  const { clearStreamingText, clearActiveTools, clearSubAgents } = useStreamingStore.getState();
  clearStreamingText(id);
  clearActiveTools(id);
  clearSubAgents(id);
},
```

---

## Phase 2: Extract editorStore (Day 2-3)

**Clear boundary**. File tabs are completely independent of other domains.

### State to Move

```typescript
// src/stores/editorStore.ts

interface EditorStoreState {
  fileTabs: FileTab[];
  selectedFileTabId: string | null;
  pendingCloseFileTabId: string | null;
}
```

### Actions to Move (13)

- `setFileTabs`, `openFileTab` (with LRU eviction), `closeFileTab`, `selectFileTab`
- `updateFileTab`, `updateFileTabContent`, `reorderFileTabs`
- `pinFileTab`, `closeOtherTabs`, `closeTabsToRight`
- `selectNextTab`, `selectPreviousTab` — **cross-store**: these navigate between file tabs AND conversations. They read `conversations` from appStore.
- `setPendingCloseFileTabId`

### Cross-Store Note

`selectNextTab` and `selectPreviousTab` build a unified list of files + conversations. After extraction:

```typescript
selectNextTab: () => {
  const conversations = useAppStore.getState().conversations;
  const selectedConvId = useAppStore.getState().selectedConversationId;
  // ... build unified list, cycle forward
  // If landing on a conversation, call useAppStore.getState().selectConversation(id)
  // If landing on a file tab, update local selectedFileTabId
},
```

### Cleanup in appStore

```typescript
// In appStore's selectSession (filters file tabs to session scope):
selectSession: (id) => {
  // ... existing logic ...
  // Filter file tabs (new: delegate to editorStore)
  const session = sessions.find(s => s.id === id);
  useEditorStore.getState().filterTabsToSession(session);
},
```

---

## Phase 3: Extract terminalStore (Day 3)

### State to Move

```typescript
// src/stores/terminalStore.ts

interface TerminalStoreState {
  // Top-level terminal sessions (PTY processes)
  terminalSessions: Record<string, TerminalSession>;
  sessionOutputs: Record<string, string[]>;

  // Bottom panel terminal instances (max 5 per session)
  terminalInstances: Record<string, TerminalInstance[]>;
  activeTerminalId: Record<string, string | null>;
}
```

### Actions to Move (9)

**Session terminals**: `createTerminalSession`, `updateTerminalSession`, `closeTerminalSession`, `appendOutput`, `clearOutput`

**Instance terminals**: `createTerminal` (slot allocation 1-5), `closeTerminal`, `setActiveTerminal`, `markTerminalExited`

### Cleanup in appStore

```typescript
// In appStore's removeSession:
const { clearSessionTerminals } = useTerminalStore.getState();
clearSessionTerminals(id);
```

---

## Phase 4: Extract reviewStore (Day 4)

### State to Move

```typescript
// src/stores/reviewStore.ts

interface ReviewStoreState {
  // Code review comments
  reviewComments: Record<string, ReviewComment[]>;

  // Branch synchronization
  branchSyncStatus: Record<string, BranchSyncStatus | null>;
  branchSyncLoading: Record<string, boolean>;
  branchSyncDismissed: Record<string, boolean>;
  branchSyncCompletedAt: Record<string, number>;
  lastTurnCompletedAt: Record<string, number>;
}
```

### Actions to Move (10)

**Review comments (4)**: `setReviewComments`, `addReviewComment`, `updateReviewComment`, `deleteReviewComment`

**Branch sync (6)**: `setBranchSyncStatus`, `setBranchSyncLoading`, `setBranchSyncDismissed`, `setBranchSyncCompletedAt`, `setLastTurnCompletedAt`, `clearBranchSyncStatus`

### Cleanup in appStore

```typescript
// In removeSession and removeWorkspace:
useReviewStore.getState().clearForSession(sessionId);
```

---

## Phase 5: Extract interactionStore (Day 5)

### State to Move

```typescript
// src/stores/interactionStore.ts

interface InteractionStoreState {
  pendingUserQuestion: Record<string, PendingUserQuestion | null>;
  inputSuggestions: Record<string, InputSuggestion>;
  summaries: Record<string, Summary>;
}
```

### Actions to Move (9)

**User questions (5)**: `setPendingUserQuestion`, `updateUserQuestionAnswer`, `nextUserQuestion`, `prevUserQuestion`, `clearPendingUserQuestion`

**Input suggestions (2)**: `setInputSuggestion`, `clearInputSuggestion`

**Summaries (2)**: `setSummary`, `updateSummary`

---

## Phase 6: Extract scriptStore (Day 5-6)

### State to Move

```typescript
// src/stores/scriptStore.ts

interface ScriptStoreState {
  scriptRuns: Record<string, ScriptRun[]>;
  setupProgress: Record<string, SetupProgress>;
  scriptOutputVersion: number; // version counter for re-renders
}

// External buffer (stays with this store)
const scriptOutputBuffers = new Map<string, string[]>();
```

### Actions to Move (4)

- `addScriptRun` — seeds external buffer
- `updateScriptRunStatus`
- `appendScriptOutput` — appends to external buffer, bumps version
- `setSetupProgress`

Also export `getScriptOutput(sessionId, runId)` and `clearScriptOutputBuffers(sessionId)`.

---

## Phase 7: Extract mcpStore (Day 6)

### State to Move

```typescript
// src/stores/mcpStore.ts

interface McpStoreState {
  mcpServers: McpServerStatus[];
  mcpServerConfigs: McpServerConfig[];
  mcpConfigLoading: boolean;
  mcpToolsByServer: Record<string, string[]>;
}
```

### Actions to Move (4)

- `setMcpServers`
- `setMcpToolsByServer`
- `fetchMcpServerConfigs(workspaceId)` — async API call
- `saveMcpServerConfigs(workspaceId, configs)` — async API call

---

## Update Selectors (Day 6-7)

The `src/stores/selectors.ts` file (485 lines) has 25+ selector hooks that all read from `useAppStore`. After extraction, update them to read from the correct store:

```typescript
// Before:
export function useStreamingState(conversationId: string) {
  return useAppStore(s => s.streamingState[conversationId]);
}

// After:
export function useStreamingState(conversationId: string) {
  return useStreamingStore(s => s.streamingState[conversationId]);
}
```

### Selector Migration Map

| Selector | Current Store | New Store |
|----------|--------------|-----------|
| `useStreamingState` | appStore | streamingStore |
| `useActiveTools` | appStore | streamingStore |
| `useSubAgents` | appStore | streamingStore |
| `useFileTabState` | appStore | editorStore |
| `useTerminalState` | appStore | terminalStore |
| `useReviewComments` | appStore | reviewStore |
| `useBranchSyncState` | appStore | reviewStore |
| `useTodoState` | appStore | appStore (stays) |
| `useSessionActivityState` | appStore | streamingStore (reads streaming + tools) |
| `useMessages` | appStore | appStore (stays) |
| `useConversationState` | appStore | appStore (stays) |
| `useWorkspaceSelection` | appStore | appStore (stays) |

---

## Cascading Delete Orchestration

The most delicate part. After extraction, `removeWorkspace`, `removeSession`, and `removeConversation` in appStore must coordinate cleanup across all stores.

### Pattern: Explicit Store Cleanup

```typescript
// appStore.ts — removeWorkspace (after extraction)

removeWorkspace: (id) => {
  const state = get();
  const sessionIds = state.sessions.filter(s => s.workspaceId === id).map(s => s.id);
  const conversationIds = state.conversations
    .filter(c => sessionIds.includes(c.sessionId))
    .map(c => c.id);

  // 1. Clean extracted stores
  const streaming = useStreamingStore.getState();
  const editor = useEditorStore.getState();
  const terminal = useTerminalStore.getState();
  const review = useReviewStore.getState();
  const interaction = useInteractionStore.getState();
  const script = useScriptStore.getState();

  conversationIds.forEach(cid => {
    streaming.clearForConversation(cid);
    interaction.clearForConversation(cid);
  });
  sessionIds.forEach(sid => {
    editor.clearForSession(sid);
    terminal.clearForSession(sid);
    review.clearForSession(sid);
    script.clearForSession(sid);
  });

  // 2. Clean own state (workspaces, sessions, conversations, messages)
  set((s) => ({
    workspaces: s.workspaces.filter(w => w.id !== id),
    sessions: s.sessions.filter(s => !sessionIds.includes(s.id)),
    conversations: s.conversations.filter(c => !conversationIds.includes(c.id)),
    messages: s.messages.filter(m => !conversationIds.includes(m.conversationId)),
    // ... clean remaining appStore-owned state
  }));
},
```

### Each Extracted Store Exports a `clearForX` Method

```typescript
// streamingStore.ts
clearForConversation: (conversationId: string) => {
  clearToolTimeoutsForConversation(conversationId);
  set((s) => ({
    streamingState: omit(s.streamingState, conversationId),
    activeTools: omit(s.activeTools, conversationId),
    subAgents: omit(s.subAgents, conversationId),
    queuedMessage: omit(s.queuedMessage, conversationId),
    pendingCheckpointUuid: omit(s.pendingCheckpointUuid, conversationId),
  }));
},
```

---

## Post-Refactoring File Structure

```
src/stores/
├── appStore.ts           (~1,200 lines — core data hierarchy + orchestration)
├── streamingStore.ts     (~380 lines — streaming, tools, sub-agents, finalization)
├── editorStore.ts        (~160 lines — file tabs with LRU)
├── terminalStore.ts      (~100 lines — terminal sessions + instances)
├── reviewStore.ts        (~130 lines — review comments + branch sync)
├── interactionStore.ts   (~90 lines — user questions, suggestions, summaries)
├── scriptStore.ts        (~80 lines — script execution + output buffers)
├── mcpStore.ts           (~60 lines — MCP server config)
├── selectors.ts          (~500 lines — updated to read from correct stores)
├── settingsStore.ts      (unchanged)
├── tabStore.ts           (unchanged)
├── navigationStore.ts    (unchanged)
├── uiStore.ts            (unchanged)
├── connectionStore.ts    (unchanged)
├── branchCacheStore.ts   (unchanged)
├── authStore.ts          (unchanged)
├── linearAuthStore.ts    (unchanged)
├── slashCommandStore.ts  (unchanged)
├── skillsStore.ts        (unchanged)
└── updateStore.ts        (unchanged)
```

**Total**: 20 stores, none larger than 1,200 lines. Average size: ~200 lines.

---

## Testing Strategy

### Per-Store Unit Tests

Each extracted store gets its own test file:

```
src/stores/__tests__/
├── streamingStore.test.ts   ← Most critical: streaming lifecycle, tool timeouts
├── editorStore.test.ts      ← LRU eviction, pin/dirty logic
├── terminalStore.test.ts    ← Slot allocation, max 5 instances
├── reviewStore.test.ts      ← CRUD operations
├── interactionStore.test.ts ← Multi-question sequences
├── scriptStore.test.ts      ← External buffer management
└── mcpStore.test.ts         ← Async config fetch/save
```

### Integration Tests

Test cascading deletes:
```typescript
test("removeWorkspace cleans all extracted stores", () => {
  // Setup: create workspace, session, conversation with streaming state
  // Act: removeWorkspace(id)
  // Assert: all stores are clean for that workspace's data
});
```

### Regression Test

Before and after refactoring, the WebSocket event handler in the frontend should produce identical state changes. Test by replaying a recorded WebSocket event sequence against both the old monolithic store and the new decomposed stores.

---

## Execution Checklist

Each phase follows this pattern:

```
[ ] Create new store file with state + actions
[ ] Add clearForConversation / clearForSession methods
[ ] Update appStore's cascading deletes to call new store
[ ] Update selectors.ts to read from new store
[ ] Update all component imports (find usages of moved actions)
[ ] Run: npm run lint && npm run build && npm run test:run
[ ] Commit with descriptive message
```

**Component import updates** are the hidden work. Use grep to find every `useAppStore` call that accesses moved state/actions:

```bash
# Find all components using streaming state
grep -r "useAppStore.*streamingState\|useAppStore.*activeTools\|useAppStore.*subAgents" src/
```

Replace with the new store import. This is mechanical but important — miss one and you get a runtime error.
