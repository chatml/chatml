# Frontend State & Rendering

The ChatML frontend is a Next.js 16 / React 19 application rendered inside a Tauri webview. This document covers the component architecture, Zustand state management, streaming rendering pipeline, and the performance optimizations that keep the UI responsive during high-throughput agent operations.

## Component Architecture

The frontend consists of 44+ React components organized by feature area. The main page (`src/app/page.tsx`) serves as the orchestrator, rendering the session sidebar, conversation area, file panel, CI panel, and terminal panel in a resizable layout.

### Key Component Groups

| Area | Components | Purpose |
|------|-----------|---------|
| Conversation | `ConversationArea`, `StreamingMessage`, `MessageBlock`, `ConversationTabs` | Message display, streaming, and tab management |
| Tools | `ToolUsageBlock`, `ToolUsageHistory`, `ActiveToolsDisplay` | Real-time tool execution display |
| Files | `FilePanel`, `FileEditor`, `DiffView`, `FileTabs` | File browsing, editing, and diff viewing |
| Session | `SessionSidebar`, `SessionCard`, `CreateSessionModal` | Session list, creation, and management |
| Terminal | `TerminalPanel`, `TerminalTab` | PTY terminal integration |
| CI | `CIPanel`, `CIRunCard`, `CIJobLogs` | GitHub Actions monitoring |
| Settings | `SettingsModal`, settings section components | Configuration UI |
| Onboarding | `OnboardingWizard`, step components | First-run experience |

## State Management

ChatML uses Zustand for state management with 13 stores. Zustand was chosen over Redux for its simplicity, minimal boilerplate, and excellent support for scoped subscriptions that prevent unnecessary re-renders.

### Store Overview

| Store | File | Responsibility |
|-------|------|----------------|
| `appStore` | `src/stores/appStore.ts` | Main state: conversations, messages, streaming, tools, sessions |
| `authStore` | `src/stores/authStore.ts` | GitHub authentication state |
| `connectionStore` | `src/stores/connectionStore.ts` | WebSocket and backend connection status |
| `linearAuthStore` | `src/stores/linearAuthStore.ts` | Linear OAuth state |
| `navigationStore` | `src/stores/navigationStore.ts` | Per-tab back/forward navigation history (max 50 entries per tab) |
| `recentlyClosedStore` | `src/stores/recentlyClosedStore.ts` | Recently closed conversations (max 10, localStorage-persisted) |
| `selectors` | `src/stores/selectors.ts` | Optimized derived state selectors |
| `settingsStore` | `src/stores/settingsStore.ts` | User preferences (model, theme, etc.) |
| `skillsStore` | `src/stores/skillsStore.ts` | Skills catalog and installation state |
| `slashCommandStore` | `src/stores/slashCommandStore.ts` | Slash command registry |
| `tabStore` | `src/stores/tabStore.ts` | Browser tab management (active workspace/session/conversation per tab) |
| `uiStore` | `src/stores/uiStore.ts` | Toolbar configuration and tab title layout |
| `updateStore` | `src/stores/updateStore.ts` | App update state (idle/checking/available/downloading/ready) |

### StreamingState

The most critical piece of state is the per-conversation `StreamingState`:

```typescript
interface StreamingState {
  text: string;                     // Accumulated streamed text
  segments: StreamingSegment[];     // Text/tool interleaved segments
  currentSegmentId: string | null;  // Current text segment being appended to
  isStreaming: boolean;             // Whether streaming is active
  error: string | null;            // Error message if failed
  thinking: string | null;         // Extended thinking content
  isThinking: boolean;             // Thinking in progress
  planModeActive: boolean;         // Agent is in plan mode
  pendingPlanApproval: boolean;    // Waiting for user to approve plan
  startTime?: number;              // When streaming started (for elapsed timer)
}
```

This is stored as a dictionary keyed by conversation ID, so each conversation's streaming state is fully independent:

```typescript
streamingState: { [conversationId: string]: StreamingState }
```

### Key Store Actions

The appStore provides actions that WebSocket events trigger:

| Action | Triggered By | What It Does |
|--------|-------------|--------------|
| `appendStreamingText` | `assistant_text` event | Appends text to the streaming buffer |
| `setThinking` | `thinking_start` event | Marks thinking as active |
| `appendThinkingText` | `thinking_delta` / `thinking` events | Accumulates thinking text |
| `clearThinking` | `assistant_text` event | Clears thinking when text arrives |
| `addActiveTool` | `tool_start` event | Adds a tool to the active tools list |
| `completeActiveTool` | `tool_end` event | Marks a tool as completed with result |
| `setAgentTodos` | `todo_update` event | Updates the agent's todo list |
| `finalizeStreamingMessage` | `result` event | Atomically creates message and clears streaming state |
| `clearStreamingText` | `complete` event | Resets streaming state after completion |

### Atomic Message Finalization

The most important state transition is `finalizeStreamingMessage`. When an agent turn completes (the `result` event arrives), the store must atomically:

1. Create a new `Message` object with the accumulated content, run summary, tool usage, and timeline
2. Clear the `StreamingState` (while preserving `planModeActive`)
3. Clear the `activeTools` array

This happens in a single Zustand `set()` call, preventing any intermediate state where the streaming text is gone but the message doesn't yet exist.

## Streaming Rendering Pipeline

### Event Flow

When the agent produces output, events flow through this pipeline:

1. **Agent Runner** emits JSON to stdout
2. **Go Backend** parses the event and broadcasts via WebSocket hub
3. **WebSocket Hook** receives the event and dispatches to the store
4. **Zustand Store** updates the relevant state
5. **React Components** re-render based on selector subscriptions

### StreamingMessage Component

The `StreamingMessage` component renders the current streaming state:

- **Thinking display** — A collapsible section showing extended thinking content, with a spinning loader and expandable Markdown content
- **Text display** — Accumulated response text rendered as Markdown with syntax highlighting
- **Active tools** — Currently executing tools shown with name, parameters, elapsed time, and a spinner
- **Error display** — Error messages when the agent fails
- **Working indicator** — A subtle animation when the agent is working but hasn't produced text yet
- **Elapsed timer** — A running timer (`MM:SS`) showing how long the current turn has been active

### Message Rendering

Once streaming completes and the message is finalized, the `MessageBlock` component renders it:

**User messages** appear as right-aligned purple bubbles with the message text.

**Assistant messages** render as left-aligned blocks with:
1. Tool usage history (if tools were used)
2. Extended thinking (collapsible)
3. Markdown content with syntax highlighting
4. Run summary (cost, duration, turns, tool statistics)

**System messages** render as setup info cards (showing session name, branch, origin) or as italicized informational text.

### Markdown Rendering

Assistant text is rendered using ReactMarkdown with:
- **GFM support** — Tables, strikethrough, task lists via `remark-gfm`
- **Syntax highlighting** — Code blocks use Shiki for language-aware highlighting
- **Mermaid diagrams** — Mermaid code blocks are rendered as interactive diagrams
- **Copy buttons** — Code blocks have a copy-to-clipboard button

## Tool Execution Display

Tools are displayed differently based on their state:

**Active (running):** Shows a spinning loader, the tool name, parameters (file path or command), and elapsed time in seconds.

**Completed (success):** Shows a green check, the tool name, a summary of what it did, and the duration.

**Completed (failure):** Shows a red X, the tool name, error details, and any stderr output.

Each tool type has a distinctive icon:
- Read → FileText (blue)
- Write → FilePlus (green)
- Edit → FileEdit (yellow)
- Bash → Terminal (gray)
- Grep → Search (purple)
- Glob → FolderSearch (cyan)
- WebSearch/WebFetch → Globe (orange)
- Task → Users (indigo)

### Sub-Agent Tracking

When the AI spawns sub-agents via the `Task` tool, each sub-agent gets its own tracking:
- Sub-agent ID, type (Explore, Bash, general-purpose, etc.)
- The parent Task tool_use_id that spawned it
- Start/end time and completion status
- Its own list of active tools

## Performance Optimizations

### Memoization

`MessageBlock` uses `React.memo` with a custom comparator to prevent re-renders when message content hasn't changed:

```typescript
const MessageBlock = memo(
  ({ message, isLastMessage }) => { /* ... */ },
  (prev, next) => (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.isLastMessage === next.isLastMessage
  )
);
```

### Scoped Selectors

Rather than subscribing to the entire store, components use scoped selectors that only trigger re-renders when the specific data they need changes:

```typescript
// Only re-renders when this specific conversation's streaming state changes
const streamingState = useStreamingState(conversationId);

// Only re-renders when this conversation's active tools change
const activeTools = useActiveTools(conversationId);
```

### useShallow

For array-returning selectors, `useShallow` prevents re-renders when the array contents haven't changed (by reference comparison of each element):

```typescript
const messages = useAppStore(
  useShallow((state) =>
    state.messages.filter(m => m.conversationId === conversationId)
  )
);
```

### Ref-Based Scroll Tracking

Auto-scroll tracking uses refs instead of state to avoid triggering re-renders:

```typescript
const isUserScrolledRef = useRef(false);
const wasAtBottomRef = useRef(true);
```

When the user scrolls up, auto-scroll is disabled. When new content arrives and the user was at the bottom, the view auto-scrolls. A "scroll to bottom" button appears when the user has scrolled away.

### Ring Buffers

Session output (terminal/script output) uses a ring buffer limited to `MAX_OUTPUT_LINES` (10,000 lines). When the buffer is full, the oldest lines are removed:

```typescript
if (updated.length > MAX_OUTPUT_LINES) {
  updated.splice(0, updated.length - MAX_OUTPUT_LINES);
}
```

### Tab LRU Eviction

File tabs use LRU (Least Recently Used) eviction with `MAX_TABS` (20). When a new tab would exceed the limit, the oldest non-pinned, non-dirty tab is automatically closed.

### Script Output Outside Zustand

Script run output is stored in a plain `Map` outside the Zustand store to avoid O(n^2) array copies on every output line. The store only tracks the current `Map` reference, not the individual lines.

### Tool Timeout

Active tools have a timeout of `TOOL_TIMEOUT_MS` (5 minutes). If a tool hasn't completed within this time, it's considered stale and can be cleaned up.

## Plan Mode UI

Plan mode has a dedicated UI flow:

1. **Agent enters plan mode** — A banner appears: "Claude is in read-only planning mode"
2. **Agent reads and researches** — Normal tool events display, but the agent only uses read-only tools
3. **Agent calls ExitPlanMode** — The banner disappears, replaced by a plan approval UI
4. **User reviews the plan** — The plan content is displayed for review
5. **User approves or rejects** — Approval starts execution; rejection returns to plan mode

## Auto-Scroll Behavior

The conversation area maintains auto-scroll state:

- **At bottom (default)** — New messages and streaming text automatically scroll into view
- **User scrolled up** — Auto-scroll is disabled, a "scroll to bottom" button appears
- **Click scroll button** — Returns to auto-scroll mode
- **New conversation** — Resets to auto-scroll mode

The scroll detection uses a threshold of 50 pixels from the bottom to account for slight imprecision.

## Related Documentation

- [Polyglot Architecture](./polyglot-architecture.md)
- [WebSocket Streaming](./websocket-streaming.md)
- [Streaming Events System](../technical/streaming-events-system.md)
