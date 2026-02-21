# Plan: Refactor page.tsx (1,763 lines → ~560 lines)

**Goal**: Break the monolithic `src/app/page.tsx` into focused, testable modules while preserving all existing functionality.

**Estimated effort**: 5-7 days for a single engineer.
**Risk level**: Low-Medium (each extraction is independently testable).

---

## Current Problems

1. **God Component**: `Home` component does everything — auth, data loading, keyboard shortcuts, menu events, zen mode, conversation lifecycle, layout, and 15+ dialog orchestrations
2. **18 useEffect calls**: Side effects are interleaved with UI logic
3. **10+ refs**: Tracking duplicate state, making the component hard to reason about
4. **Untestable**: Can't unit test keyboard shortcuts without rendering the entire app
5. **Onboarding barrier**: New contributors face a 1,763-line wall

## Target State

```
src/app/page.tsx                        →  ~560 lines (orchestrator only)
src/components/skeletons/               →  ConversationSkeleton.tsx (62 lines)
src/components/layout/MainLayout.tsx    →  ~320 lines (JSX structure)
src/hooks/useAuthInitialization.ts      →  ~99 lines
src/hooks/useDataLoader.ts             →  ~126 lines
src/hooks/useConversationLifecycle.ts   →  ~147 lines
src/hooks/useZenMode.ts                →  ~39 lines
src/hooks/useLayoutManager.ts          →  ~40 lines
src/hooks/useFileTabManager.ts         →  ~31 lines
src/hooks/useWindowEvents.ts           →  ~56 lines
src/lib/menuEventHandler.ts            →  ~213 lines
src/lib/keyboardShortcuts.ts           →  ~96 lines
```

**Result**: 68% reduction in page.tsx, 11 new focused files.

---

## Phase 1: Extract Pure Utilities (Day 1)

**Impact**: Remove ~309 lines. Zero risk — these are pure functions with no component dependencies.

### 1.1 Extract Menu Event Handler

**From**: `page.tsx` lines 1120-1333 (213 lines)
**To**: `src/lib/menuEventHandler.ts`

This is the single largest extraction. The menu handler is a giant switch statement over 50+ Tauri menu event types. It accesses stores via `getState()` (not hooks), making it a pure function.

```typescript
// src/lib/menuEventHandler.ts

import { useAppStore } from "@/stores/appStore";
import { useSettingsStore } from "@/stores/settingsStore";
// ... other store imports

interface MenuHandlerContext {
  // Callback refs from Home component
  handleNewSession: () => void;
  handleNewConversation: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomTerminal: () => void;
  setShowSettings: (show: boolean) => void;
  setShowShortcuts: (show: boolean) => void;
  // ... other callbacks
}

export function handleMenuEvent(event: string, ctx: MenuHandlerContext): void {
  switch (event) {
    case "new-session":
      ctx.handleNewSession();
      break;
    case "new-conversation":
      ctx.handleNewConversation();
      break;
    case "toggle-sidebar":
      ctx.toggleLeftSidebar();
      break;
    // ... 50+ cases moved verbatim
  }
}
```

**In page.tsx**: Replace the inline handler with:
```typescript
import { handleMenuEvent } from "@/lib/menuEventHandler";

useEffect(() => {
  const unlisten = listen("menu-event", (e) => {
    handleMenuEvent(e.payload as string, {
      handleNewSession: handleNewSessionRef.current,
      handleNewConversation: handleNewConversationRef.current,
      // ... pass callback refs
    });
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

### 1.2 Extract Keyboard Shortcuts

**From**: `page.tsx` lines 1021-1117 (96 lines)
**To**: `src/lib/keyboardShortcuts.ts`

The global `keydown` handler is another pure function — it reads store state via `getState()` and calls callbacks.

```typescript
// src/lib/keyboardShortcuts.ts

interface ShortcutContext {
  handleNewSession: () => void;
  handleNewConversation: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomTerminal: () => void;
  setShowSettings: (show: boolean) => void;
  // ... other callbacks
}

export function handleGlobalKeydown(e: KeyboardEvent, ctx: ShortcutContext): void {
  const isMod = e.metaKey || e.ctrlKey;

  if (isMod && e.key === "n") {
    e.preventDefault();
    ctx.handleNewSession();
    return;
  }
  // ... 40+ shortcut cases moved verbatim
}
```

---

## Phase 2: Extract Skeleton Components (Day 1-2)

**Impact**: Remove ~62 lines. Trivial extraction.

### 2.1 Extract ConversationSkeleton

**From**: `page.tsx` lines 92-154 (62 lines)
**To**: `src/components/skeletons/ConversationSkeleton.tsx`

This is a self-contained loading skeleton with zero dependencies on Home state. Direct copy-paste extraction.

```typescript
// src/components/skeletons/ConversationSkeleton.tsx
import { Loader2 } from "lucide-react";

export function ConversationSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* ... skeleton UI moved verbatim */}
    </div>
  );
}
```

---

## Phase 3: Extract Data & Auth Hooks (Day 2-3)

**Impact**: Remove ~225 lines. Medium complexity — these hooks have async orchestration.

### 3.1 Extract useAuthInitialization

**From**: `page.tsx` lines 273-372 (99 lines)
**To**: `src/hooks/useAuthInitialization.ts`

This hook handles:
- Initial token validation on mount
- GitHub OAuth callback processing
- Linear OAuth callback processing
- Auth state synchronization

```typescript
// src/hooks/useAuthInitialization.ts

export function useAuthInitialization() {
  const [backendConnected, setBackendConnected] = useState(false);

  useEffect(() => {
    // Token validation logic (lines 273-310)
    // ...
  }, []);

  useEffect(() => {
    // GitHub OAuth callback (lines 312-340)
    // ...
  }, []);

  useEffect(() => {
    // Linear OAuth callback (lines 342-372)
    // ...
  }, []);

  return { backendConnected };
}
```

### 3.2 Extract useDataLoader

**From**: `page.tsx` lines 573-699 (126 lines)
**To**: `src/hooks/useDataLoader.ts`

This is the most complex extraction in this phase. It orchestrates:
1. Fetch all workspaces
2. Fetch all sessions (parallel)
3. Fetch conversations for each session
4. Eager-load messages for the first conversation
5. Restore last-active workspace/session/conversation
6. Handle onboarding for new users

```typescript
// src/hooks/useDataLoader.ts

interface DataLoaderOptions {
  backendConnected: boolean;
  onLoadComplete: () => void;
}

export function useDataLoader({ backendConnected, onLoadComplete }: DataLoaderOptions) {
  const [isLoadingData, setIsLoadingData] = useState(true);

  useEffect(() => {
    if (!backendConnected) return;

    async function loadInitialData() {
      // 1. Fetch workspaces (line 580)
      const repos = await listRepos();
      // 2. Fetch sessions (line 591)
      const sessions = await listAllSessions(true);
      // 3. Fetch conversations in parallel (line 623)
      // 4. Eager load messages (line 683)
      // 5. Restore selection (line 690)
      // 6. Set loaded (line 695)
      setIsLoadingData(false);
      onLoadComplete();
    }

    loadInitialData();
  }, [backendConnected]);

  return { isLoadingData };
}
```

**Dependency note**: This hook needs access to `useAppStore` actions and the onboarding resolution logic. Pass the onboarding check as a parameter rather than importing directly.

---

## Phase 4: Extract State Management Hooks (Day 3-4)

**Impact**: Remove ~257 lines. Medium risk — zen mode has tricky ref management.

### 4.1 Extract useConversationLifecycle

**From**: `page.tsx` lines 736-883 (147 lines)
**To**: `src/hooks/useConversationLifecycle.ts`

Handles create, close, confirm-close, and delete for conversations:

```typescript
// src/hooks/useConversationLifecycle.ts

interface ConversationLifecycleOptions {
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
}

export function useConversationLifecycle(opts: ConversationLifecycleOptions) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [pendingCloseConvId, setPendingCloseConvId] = useState<string | null>(null);

  const handleNewSession = useCallback(async () => {
    // Generate city-based name, create session, create conversation (lines 745-800)
  }, [opts.selectedWorkspaceId]);

  const handleNewConversation = useCallback(async () => {
    // Create task conversation for current session (lines 800-840)
  }, [opts.selectedSessionId]);

  const doCloseTab = useCallback(async (convId: string) => {
    // Delete conversation with streaming check (lines 843-870)
  }, []);

  const handleCloseTab = useCallback((convId: string) => {
    // Close with confirmation if active streaming (lines 870-883)
  }, []);

  const handleConfirmClose = useCallback(() => {
    // Confirm close dialog handler
  }, [pendingCloseConvId]);

  return {
    showCloseConfirm,
    pendingCloseConvId,
    handleNewSession,
    handleNewConversation,
    handleCloseTab,
    handleConfirmClose,
    setShowCloseConfirm,
  };
}
```

### 4.2 Extract useZenMode

**From**: `page.tsx` lines 374-413 (39 lines)
**To**: `src/hooks/useZenMode.ts`

Zen mode is a state machine that collapses/expands sidebars:

```typescript
// src/hooks/useZenMode.ts
import type { ImperativePanel } from "react-resizable-panels";

interface ZenModeOptions {
  leftSidebarPanelRef: React.RefObject<ImperativePanel | null>;
  rightSidebarPanelRef: React.RefObject<ImperativePanel | null>;
}

export function useZenMode({ leftSidebarPanelRef, rightSidebarPanelRef }: ZenModeOptions) {
  const zenMode = useSettingsStore(s => s.zenMode);
  const prevZenModeRef = useRef(zenMode);
  const preZenStateRef = useRef({ left: false, right: false });

  useEffect(() => {
    if (zenMode && !prevZenModeRef.current) {
      // Entering zen: save sidebar state, collapse both
      preZenStateRef.current = { left: !leftCollapsed, right: !rightCollapsed };
      leftSidebarPanelRef.current?.collapse();
      rightSidebarPanelRef.current?.collapse();
    } else if (!zenMode && prevZenModeRef.current) {
      // Exiting zen: restore saved state
      if (preZenStateRef.current.left) leftSidebarPanelRef.current?.expand();
      if (preZenStateRef.current.right) rightSidebarPanelRef.current?.expand();
    }
    prevZenModeRef.current = zenMode;
  }, [zenMode]);
}
```

### 4.3 Extract useLayoutManager

**From**: `page.tsx` lines 200-220, 388-427 (40 lines)
**To**: `src/hooks/useLayoutManager.ts`

Sidebar toggle logic and width tracking:

```typescript
// src/hooks/useLayoutManager.ts

export function useLayoutManager() {
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const sidebarWidthRef = useRef(220);

  const toggleLeftSidebar = useCallback(() => { /* ... */ }, []);
  const toggleRightSidebar = useCallback(() => { /* ... */ }, []);

  return {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    sidebarWidthRef,
    toggleLeftSidebar,
    toggleRightSidebar,
    setLeftSidebarCollapsed,
    setRightSidebarCollapsed,
  };
}
```

### 4.4 Extract useFileTabManager

**From**: `page.tsx` lines 967-998 (31 lines)
**To**: `src/hooks/useFileTabManager.ts`

File close/save/discard logic with dirty checking:

```typescript
// src/hooks/useFileTabManager.ts

export function useFileTabManager() {
  const handleCloseFileTab = useCallback((tabId: string) => {
    // Check dirty, show confirmation if needed
  }, []);

  const handleSaveAndCloseFile = useCallback(() => { /* ... */ }, []);
  const handleDontSaveAndCloseFile = useCallback(() => { /* ... */ }, []);

  return { handleCloseFileTab, handleSaveAndCloseFile, handleDontSaveAndCloseFile };
}
```

### 4.5 Extract useWindowEvents

**From**: `page.tsx` lines 1352-1408 (56 lines)
**To**: `src/hooks/useWindowEvents.ts`

Window-level event listeners (focus, blur, beforeunload, Tauri file watcher events):

```typescript
// src/hooks/useWindowEvents.ts

export function useWindowEvents() {
  useEffect(() => {
    // Window focus/blur handlers
    // Tauri file watcher event listener
    // beforeunload handler
    return () => { /* cleanup all listeners */ };
  }, []);
}
```

---

## Phase 5: Extract Layout Component (Day 5-6)

**Impact**: Remove ~320 lines. Highest complexity — requires prop drilling decisions.

### 5.1 Extract MainLayout

**From**: `page.tsx` lines 1441-1761 (320 lines)
**To**: `src/components/layout/MainLayout.tsx`

This is the JSX structure — the `ResizablePanelGroup` tree with all children. Two approaches:

**Option A: Prop Drilling (Simpler, Recommended)**

Pass everything as props. Verbose but explicit:

```typescript
// src/components/layout/MainLayout.tsx

interface MainLayoutProps {
  // Selection
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  selectedConversationId: string | null;
  // Sidebar state
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  // Panel refs
  leftSidebarPanelRef: React.RefObject<ImperativePanel | null>;
  rightSidebarPanelRef: React.RefObject<ImperativePanel | null>;
  // Callbacks
  onNewSession: () => void;
  onNewConversation: () => void;
  onCloseTab: (convId: string) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onToggleBottomTerminal: () => void;
  onOpenProject: () => void;
  onOpenSettings: () => void;
  onOpenWorkspaceSettings: (id: string) => void;
  // ... ~15 more props
}

export function MainLayout(props: MainLayoutProps) {
  return (
    <ResizablePanelGroup direction="horizontal" ...>
      {/* Left sidebar panel */}
      {/* Main content panel */}
      {/* Right sidebar panel */}
    </ResizablePanelGroup>
  );
}
```

**Option B: Context Provider (Cleaner API, more abstraction)**

Create a `LayoutContext` that provides all the shared state:

```typescript
const LayoutContext = createContext<LayoutContextValue>(null!);

export function LayoutProvider({ children, value }) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}
```

**Recommendation**: Start with Option A (prop drilling). Refactor to Option B later if the prop list becomes unwieldy. Explicit props are easier to review in PRs and easier for new contributors to trace.

---

## Phase 6: Overlay/Dialog Extraction (Day 6-7, Optional)

**Impact**: Further ~100 lines. These are conditional renders that could become a single `<Overlays />` component.

```typescript
// src/components/layout/Overlays.tsx

interface OverlaysProps {
  showSettings: boolean;
  showWorkspaceSettings: string | null;
  showAddWorkspace: boolean;
  showCreateFromPR: boolean;
  showCloneFromUrl: boolean;
  showGitHubRepos: boolean;
  showShortcuts: boolean;
  showCloseConfirm: boolean;
  // ... setters for each
}

export function Overlays(props: OverlaysProps) {
  return (
    <>
      {props.showSettings && <SettingsPage ... />}
      {props.showWorkspaceSettings && <WorkspaceSettings ... />}
      {props.showAddWorkspace && <AddWorkspaceModal ... />}
      {/* ... 12 more conditional dialogs */}
    </>
  );
}
```

---

## Execution Order (Critical Path)

```
Day 1:  Phase 1 (utilities) + Phase 2 (skeleton)
        → page.tsx: 1763 → 1388 lines (-375)
        → Run: npm run lint && npm run build && npm run test:run

Day 2:  Phase 3.1 (auth hook)
        → page.tsx: 1388 → 1289 lines (-99)
        → Run: npm run lint && npm run build && npm run test:run

Day 3:  Phase 3.2 (data loader hook)
        → page.tsx: 1289 → 1163 lines (-126)
        → Run: npm run lint && npm run build && npm run test:run

Day 4:  Phase 4.1 + 4.2 + 4.3 (conversation + zen + layout)
        → page.tsx: 1163 → 937 lines (-226)
        → Run: npm run lint && npm run build && npm run test:run

Day 5:  Phase 4.4 + 4.5 (file tabs + window events)
        → page.tsx: 937 → 850 lines (-87)
        → Run: npm run lint && npm run build && npm run test:run

Day 6:  Phase 5 (MainLayout extraction)
        → page.tsx: 850 → 530 lines (-320)
        → Run: full test suite + manual smoke test

Day 7:  Phase 6 (overlays, optional) + cleanup
        → page.tsx: 530 → ~430 lines (-100)
        → Final: npm run lint && npm run build && npm run test:run && make test
```

### Critical Constraint

**Every phase must independently pass lint + build + tests.** Never batch multiple extractions into one commit without verifying. This ensures any extraction can be reverted independently if issues are found.

---

## Testing Strategy

### What to Test in New Files

| Extracted Module | Test Approach |
|-----------------|---------------|
| `menuEventHandler.ts` | Unit test: mock context, verify each event calls the right callback |
| `keyboardShortcuts.ts` | Unit test: simulate KeyboardEvent, verify dispatched actions |
| `useAuthInitialization` | Hook test: mock fetch, verify auth flow state transitions |
| `useDataLoader` | Hook test: mock API calls, verify loading sequence |
| `useConversationLifecycle` | Hook test: verify create/close/confirm flows |
| `useZenMode` | Hook test: mock panel refs, verify expand/collapse |
| `useLayoutManager` | Hook test: verify toggle state transitions |
| `ConversationSkeleton` | Snapshot test: verify renders without crashing |

### What NOT to Re-Test

Don't add tests for the 30+ child components that already have their own tests. The extraction should not change their behavior.

---

## Dependency Graph (Post-Refactoring)

```
page.tsx (Home)
  ├── useAuthInitialization()         → { backendConnected }
  ├── useDataLoader()                 → { isLoadingData }
  ├── useConversationLifecycle()      → { handleNewSession, handleCloseTab, ... }
  ├── useZenMode()                    → (side effects only)
  ├── useLayoutManager()              → { leftCollapsed, toggleLeft, ... }
  ├── useFileTabManager()             → { handleCloseFile, ... }
  ├── useWindowEvents()               → (side effects only)
  ├── useWebSocket()                  → (existing, unchanged)
  ├── useMenuState()                  → (existing, unchanged)
  ├── ... (other existing hooks)
  │
  └── renders:
      ├── <ConversationSkeleton />    (loading state)
      ├── <OnboardingScreen />        (auth boundary)
      ├── <MainLayout ... />          (all panels + content)
      └── <Overlays ... />            (all dialogs/modals)
```

Home becomes a **thin orchestrator**: it initializes hooks, wires them together, and renders the layout. No business logic remains in the component itself.
