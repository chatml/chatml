# Frontend Rendering Pipeline

This document covers the frontend message rendering system, including Zustand state management, component architecture, streaming display, and performance optimizations.

## Table of Contents

1. [Component Architecture](#component-architecture)
2. [State Management](#state-management)
3. [Message Rendering](#message-rendering)
4. [Streaming Display](#streaming-display)
5. [Tool Execution Display](#tool-execution-display)
6. [Performance Optimizations](#performance-optimizations)
7. [Auto-Scroll Behavior](#auto-scroll-behavior)

## Component Architecture

### Component Hierarchy

```mermaid
graph TB
    subgraph ConversationArea["ConversationArea.tsx"]
        CA[ConversationArea]
        Search[Search Bar]
        TabBar[TabBar]
        MessageList[Message List]
        StreamingMsg[StreamingMessage]
        ScrollBtn[Scroll Button]
    end

    subgraph MessageRendering["Message Components"]
        MB[MessageBlock]
        TB[ToolUsageBlock]
        TH[ToolUsageHistory]
        VB[VerificationBlock]
        SI[SetupInfo]
        RS[RunSummary]
    end

    subgraph Streaming["Streaming Components"]
        SM[StreamingMessage]
        TI[ThinkingIndicator]
        ATD[ActiveToolsDisplay]
        EI[ErrorIndicator]
    end

    CA --> Search
    CA --> TabBar
    CA --> MessageList
    CA --> StreamingMsg
    CA --> ScrollBtn

    MessageList --> MB
    MB --> TB
    MB --> TH
    MB --> VB
    MB --> SI
    MB --> RS

    StreamingMsg --> SM
    SM --> TI
    SM --> ATD
    SM --> EI
```

### Key Files

| File | Purpose |
|------|---------|
| `src/components/ConversationArea.tsx` | Main conversation container |
| `src/components/StreamingMessage.tsx` | Real-time streaming display |
| `src/components/ToolUsageBlock.tsx` | Individual tool display |
| `src/components/ToolUsageHistory.tsx` | Tool history list |
| `src/stores/appStore.ts` | Zustand state store |
| `src/stores/selectors.ts` | Optimized state selectors |
| `src/hooks/useWebSocket.ts` | WebSocket connection |

## State Management

### Zustand Store Structure

**File: `src/stores/appStore.ts:54-96`**

```typescript
interface AppState {
  // Conversation State
  conversations: Conversation[];
  messages: Message[];

  // Streaming State (per conversation)
  streamingState: { [conversationId: string]: StreamingState };
  activeTools: { [conversationId: string]: ActiveTool[] };
  agentTodos: { [conversationId: string]: AgentTodoItem[] };

  // UI State
  selectedConversationId: string | null;
  fileTabs: FileTab[];
  // ...
}
```

### StreamingState Interface

**File: `src/stores/appStore.ts:31-40`**

```typescript
interface StreamingState {
  text: string;                    // Accumulated streamed text
  isStreaming: boolean;            // Active streaming flag
  error: string | null;            // Error message if failed
  thinking: string | null;         // Extended thinking content
  isThinking: boolean;             // Thinking in progress
  startTime?: number;              // When streaming started
  planModeActive: boolean;         // Plan mode state
  awaitingPlanApproval: boolean;   // Waiting for ExitPlanMode
}
```

### ActiveTool Interface

```typescript
interface ActiveTool {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  startTime: number;
  endTime?: number;
  success?: boolean;
  summary?: string;
  stdout?: string;
  stderr?: string;
}
```

### State Flow Diagram

```mermaid
flowchart TB
    subgraph WebSocket["WebSocket Events"]
        WS[useWebSocket hook]
    end

    subgraph Store["Zustand Store"]
        SS[streamingState]
        AT[activeTools]
        TD[agentTodos]
        MSG[messages]
    end

    subgraph Actions["Store Actions"]
        A1[appendStreamingText]
        A2[appendThinkingText]
        A3[setStreaming]
        A4[addActiveTool]
        A5[completeActiveTool]
        A6[setAgentTodos]
        A7[finalizeStreamingMessage]
    end

    subgraph Components["UI Components"]
        SM[StreamingMessage]
        MB[MessageBlock]
        ATD[ActiveToolsDisplay]
    end

    WS -->|assistant_text| A1
    WS -->|thinking_*| A2
    WS -->|tool_start| A4
    WS -->|tool_end| A5
    WS -->|todo_update| A6
    WS -->|result| A7

    A1 --> SS
    A2 --> SS
    A3 --> SS
    A4 --> AT
    A5 --> AT
    A6 --> TD
    A7 --> MSG

    SS --> SM
    MSG --> MB
    AT --> ATD
```

### Atomic Message Finalization

**File: `src/stores/appStore.ts:860-914`**

The `finalizeStreamingMessage` action atomically creates a message AND clears streaming state to prevent race conditions:

```typescript
finalizeStreamingMessage: (conversationId, content, runSummary, toolUsage) => {
  set((state) => {
    // 1. Create new message
    const newMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: content,
      runSummary: runSummary,
      timestamp: new Date().toISOString(),
    };

    // 2. Clear streaming state (preserving planModeActive)
    const currentStreamingState = state.streamingState[conversationId];
    const newStreamingState = {
      text: '',
      isStreaming: false,
      error: null,
      thinking: null,
      isThinking: false,
      startTime: undefined,
      planModeActive: currentStreamingState?.planModeActive || false,
      awaitingPlanApproval: false,
    };

    // 3. Return atomic update
    return {
      messages: [...state.messages, newMessage],
      streamingState: {
        ...state.streamingState,
        [conversationId]: newStreamingState,
      },
      activeTools: {
        ...state.activeTools,
        [conversationId]: [],
      },
    };
  });
},
```

## Message Rendering

### MessageBlock Component

**File: `src/components/ConversationArea.tsx:976-1119`**

```mermaid
flowchart TB
    MB[MessageBlock]
    Role{message.role}

    subgraph System["System Message"]
        SI[SetupInfo Card]
        ST[Italic Text]
    end

    subgraph User["User Message"]
        UM[Purple Chat Bubble]
    end

    subgraph Assistant["Assistant Message"]
        TU[ToolUsageHistory]
        VR[VerificationBlock]
        MD[Markdown Content]
        FC[FileChanges]
        RS[RunSummary]
    end

    MB --> Role
    Role -->|system| System
    Role -->|user| User
    Role -->|assistant| Assistant

    SI --> ST
    TU --> VR --> MD --> FC --> RS
```

### Message Role Styling

| Role | Styling |
|------|---------|
| `user` | Right-aligned, purple background bubble |
| `assistant` | Left-aligned, rich content with tools/code |
| `system` | SetupInfo card or italicized text |

### Markdown Rendering

Assistant messages use ReactMarkdown with syntax highlighting:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter
          language={match[1]}
          style={vscDarkPlus}
          PreTag="div"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  }}
>
  {content}
</ReactMarkdown>
```

## Streaming Display

### StreamingMessage Component

**File: `src/components/StreamingMessage.tsx`**

```mermaid
flowchart TB
    SM[StreamingMessage]
    SS{streamingState}

    subgraph Conditions
        Streaming{isStreaming?}
        Thinking{isThinking?}
        HasError{error?}
        HasText{text?}
    end

    subgraph Display
        TD[ThinkingDisplay]
        TXT[StreamingText]
        ERR[ErrorDisplay]
        WRK[WorkingIndicator]
        ATD[ActiveToolsDisplay]
    end

    SM --> SS
    SS --> Streaming
    SS --> Thinking
    SS --> HasError
    SS --> HasText

    Thinking -->|Yes| TD
    HasText -->|Yes| TXT
    HasError -->|Yes| ERR
    Streaming -->|Yes, no text| WRK
    Streaming -->|Yes| ATD
```

### Elapsed Time Tracking

**File: `src/components/StreamingMessage.tsx:92-121`**

```tsx
const [elapsedTime, setElapsedTime] = useState<string>('');

useEffect(() => {
  if (!isStreaming || !startTime) {
    setElapsedTime('');
    return;
  }

  const updateElapsed = () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    setElapsedTime(
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    );
  };

  updateElapsed();
  const interval = setInterval(updateElapsed, 1000);
  return () => clearInterval(interval);
}, [isStreaming, startTime]);
```

### Extended Thinking Display

**File: `src/components/StreamingMessage.tsx:153-203`**

```tsx
{isThinking && (
  <div className="thinking-container">
    <div className="thinking-header">
      <span className="thinking-indicator">
        <Loader2 className="animate-spin" />
        Extended thinking...
      </span>
      <button onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronUp /> : <ChevronDown />}
      </button>
    </div>
    {expanded && thinking && (
      <div className="thinking-content">
        <ReactMarkdown>{thinking}</ReactMarkdown>
      </div>
    )}
  </div>
)}
```

## Tool Execution Display

### ToolUsageBlock Component

**File: `src/components/ToolUsageBlock.tsx:74-84`**

```mermaid
flowchart LR
    TUB[ToolUsageBlock]

    subgraph Icon
        Read[FileText]
        Write[FilePlus]
        Edit[FileEdit]
        Bash[Terminal]
        Grep[Search]
        Glob[FolderSearch]
        Web[Globe]
        Task[Users]
    end

    subgraph Status
        Active[Spinner]
        Success[CheckCircle]
        Failure[XCircle]
    end

    subgraph Content
        Target[File/Command]
        Stats[Additions/Deletions]
        Output[stdout/stderr]
    end

    TUB --> Icon
    TUB --> Status
    TUB --> Content
```

### Tool Icons and Colors

| Tool | Icon | Color |
|------|------|-------|
| `Read` | FileText | Blue |
| `Write` | FilePlus | Green |
| `Edit` | FileEdit | Yellow |
| `Bash` | Terminal | Gray |
| `Grep` | Search | Purple |
| `Glob` | FolderSearch | Cyan |
| `WebSearch` | Globe | Orange |
| `WebFetch` | Download | Orange |
| `Task` | Users | Indigo |

### Active Tools Display

```tsx
const ActiveToolsDisplay = ({ conversationId }: Props) => {
  const activeTools = useActiveTools(conversationId);

  return (
    <div className="active-tools">
      {activeTools.map((tool) => (
        <ToolUsageBlock
          key={tool.id}
          tool={tool.tool}
          params={tool.params}
          isActive={!tool.endTime}
          success={tool.success}
          startTime={tool.startTime}
        />
      ))}
    </div>
  );
};
```

## Performance Optimizations

### Memoization Strategy

**File: `src/components/ConversationArea.tsx:1110-1118`**

```tsx
const MessageBlock = memo(
  ({ message, isLastMessage }: MessageBlockProps) => {
    // Component implementation
  },
  (prevProps, nextProps) => {
    // Custom comparison - only re-render if these change
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.isLastMessage === nextProps.isLastMessage
    );
  }
);
```

### Optimized Selectors

**File: `src/stores/selectors.ts`**

```typescript
// Scoped streaming state selector
export const useStreamingState = (conversationId: string) =>
  useAppStore(
    useCallback(
      (state) => state.streamingState[conversationId] || defaultStreamingState,
      [conversationId]
    )
  );

// Scoped active tools selector
export const useActiveTools = (conversationId: string) =>
  useAppStore(
    useCallback(
      (state) => state.activeTools[conversationId] || [],
      [conversationId]
    )
  );

// Messages filtered by conversation with shallow comparison
export const useMessages = (conversationId: string) =>
  useAppStore(
    useShallow((state) =>
      state.messages.filter((m) => m.conversationId === conversationId)
    )
  );
```

### Key Optimization Patterns

```mermaid
flowchart TB
    subgraph Patterns["Optimization Patterns"]
        P1[Memoization]
        P2[Selector Scoping]
        P3[useShallow]
        P4[Ref-based Tracking]
        P5[Atomic Updates]
        P6[Ring Buffers]
    end

    subgraph Benefits["Benefits"]
        B1[Prevent re-renders]
        B2[Avoid subscription churn]
        B3[Shallow object comparison]
        B4[No state-triggered renders]
        B5[Prevent race conditions]
        B6[Memory bounds]
    end

    P1 --> B1
    P2 --> B2
    P3 --> B3
    P4 --> B4
    P5 --> B5
    P6 --> B6
```

### Memory Management

**Session Output Ring Buffer (Line 661)**
```typescript
const MAX_OUTPUT_LINES = 10000;

addSessionOutput: (sessionId, line) => {
  set((state) => {
    const current = state.sessionOutput[sessionId] || [];
    const updated = [...current, line];
    // Ring buffer: keep only last MAX_OUTPUT_LINES
    if (updated.length > MAX_OUTPUT_LINES) {
      updated.splice(0, updated.length - MAX_OUTPUT_LINES);
    }
    return {
      sessionOutput: { ...state.sessionOutput, [sessionId]: updated },
    };
  });
},
```

**Tab LRU Eviction (Lines 538-550)**
```typescript
const MAX_FILE_TABS = 20;

// Auto-close oldest non-pinned, non-dirty tabs
if (fileTabs.length >= MAX_FILE_TABS) {
  const closeable = fileTabs
    .filter((t) => !t.isPinned && !t.isDirty)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);

  if (closeable.length > 0) {
    // Close oldest tab
    return removeFileTab(closeable[0].id);
  }
}
```

## Auto-Scroll Behavior

### Scroll Management

**File: `src/components/ConversationArea.tsx:330-438`**

```mermaid
stateDiagram-v2
    [*] --> AtBottom
    AtBottom --> UserScrolled: User scrolls up
    UserScrolled --> AtBottom: User scrolls to bottom
    UserScrolled --> AtBottom: Click scroll button
    AtBottom --> AtBottom: New message (auto-scroll)
    UserScrolled --> UserScrolled: New message (no scroll)

    note right of AtBottom
        Auto-scroll enabled
        New content scrolls view
    end note

    note right of UserScrolled
        Auto-scroll disabled
        Show scroll button
    end note
```

### Ref-Based Tracking

```typescript
// Refs for scroll tracking (no re-renders)
const scrollContainerRef = useRef<HTMLDivElement>(null);
const isUserScrolledRef = useRef(false);
const wasAtBottomRef = useRef(true);
const [showScrollButton, setShowScrollButton] = useState(false);

// Scroll event handler
const handleScroll = useCallback(() => {
  const container = scrollContainerRef.current;
  if (!container) return;

  const { scrollTop, scrollHeight, clientHeight } = container;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

  wasAtBottomRef.current = isAtBottom;
  isUserScrolledRef.current = !isAtBottom;
  setShowScrollButton(!isAtBottom);
}, []);

// Auto-scroll on new content
useEffect(() => {
  if (wasAtBottomRef.current && !isUserScrolledRef.current) {
    scrollContainerRef.current?.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }
}, [messages, streamingText]);
```

### Force Scroll Function

```typescript
const forceScrollToBottom = useCallback(() => {
  const container = scrollContainerRef.current;
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
    isUserScrolledRef.current = false;
    wasAtBottomRef.current = true;
    setShowScrollButton(false);
  }
}, []);
```

## Plan Mode UI

### Plan Mode Banner

**File: `src/components/ConversationArea.tsx:828-838`**

```tsx
{streamingState?.planModeActive && !streamingState?.awaitingPlanApproval && (
  <div className="plan-mode-banner">
    <Info className="icon" />
    <span>Claude is in read-only planning mode</span>
  </div>
)}
```

### Plan Mode State Flow

```mermaid
sequenceDiagram
    participant Claude
    participant Agent
    participant Store
    participant UI

    Claude->>Agent: EnterPlanMode tool
    Agent-->>Store: permission_mode_changed (plan)
    Store->>UI: planModeActive = true
    UI->>UI: Show plan mode banner

    Note over Claude: Read-only operations only

    Claude->>Agent: ExitPlanMode tool
    Agent-->>Store: permission_mode_changed (plan_approval)
    Store->>UI: awaitingPlanApproval = true
    UI->>UI: Hide banner, show approval UI

    alt User Approves
        UI->>Agent: Approval message
        Agent-->>Store: permission_mode_changed (normal)
        Store->>UI: planModeActive = false
    else User Rejects
        UI->>Agent: Rejection message
        Agent-->>Store: Re-enter plan mode
    end
```

## Related Documentation

- [Conversation Architecture Overview](./conversation-architecture.md)
- [WebSocket Streaming](./websocket-streaming.md)
- [Claude SDK Events](./claude-sdk-events.md)
- [State Management](./data-models-persistence.md)
