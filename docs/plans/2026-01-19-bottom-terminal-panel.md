# Bottom Terminal Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the interactive terminal from the right sidebar to a collapsible bottom panel in the main content area, toggled with Cmd+`.

**Architecture:** Add a vertical ResizablePanelGroup inside the main content panel. The bottom panel contains the Terminal component wrapped in a new BottomTerminal component with header/close button. State managed in page.tsx alongside other sidebar states.

**Tech Stack:** React, Tauri, ResizablePanelGroup (shadcn/ui), xterm.js (existing)

---

### Task 1: Add Tauri Menu Item

**Files:**
- Modify: `src-tauri/src/lib.rs:133-150` (view_menu section)

**Step 1: Add toggle_terminal menu item**

In `create_menu` function, add to view_menu after the existing items:

```rust
// View menu - add after focus_input item
let view_menu = SubmenuBuilder::new(app, "View")
    .item(&MenuItemBuilder::with_id("toggle_left_sidebar", "Toggle Left Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?)
    .item(&MenuItemBuilder::with_id("toggle_right_sidebar", "Toggle Right Sidebar")
        .accelerator("CmdOrCtrl+Alt+B")
        .build(app)?)
    .item(&MenuItemBuilder::with_id("toggle_terminal", "Toggle Terminal")
        .accelerator("CmdOrCtrl+`")
        .build(app)?)
    .separator()
    .item(&MenuItemBuilder::with_id("toggle_thinking", "Toggle Thinking Mode")
        .accelerator("Alt+T")
        .build(app)?)
    .item(&MenuItemBuilder::with_id("toggle_plan_mode", "Toggle Plan Mode")
        .accelerator("Shift+Tab")
        .build(app)?)
    .item(&MenuItemBuilder::with_id("focus_input", "Focus Input")
        .accelerator("CmdOrCtrl+L")
        .build(app)?)
    .build()?;
```

**Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add Toggle Terminal menu item with Cmd+\` accelerator"
```

---

### Task 2: Create BottomTerminal Component

**Files:**
- Create: `src/components/BottomTerminal.tsx`

**Step 1: Create the component file**

```tsx
'use client';

import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Dynamic import for xterm.js (browser-only)
const Terminal = dynamic(
  () => import('@/components/Terminal').then((mod) => mod.Terminal),
  {
    ssr: false,
    loading: () => (
      <div className="h-full bg-black/90 flex items-center justify-center">
        <span className="text-xs text-muted-foreground">Loading terminal...</span>
      </div>
    ),
  }
);

interface BottomTerminalProps {
  sessionId: string;
  workspacePath?: string;
  onClose: () => void;
}

export function BottomTerminal({ sessionId, workspacePath, onClose }: BottomTerminalProps) {
  return (
    <div className="flex flex-col h-full bg-background border-t">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground">Terminal</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {/* Terminal */}
      <div className="flex-1 min-h-0">
        <Terminal sessionId={sessionId} workspacePath={workspacePath} />
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/BottomTerminal.tsx
git commit -m "feat: add BottomTerminal component with header and close button"
```

---

### Task 3: Update page.tsx - Add State and Keyboard Shortcut

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add showBottomTerminal state**

After line 33 (`const [showRightSidebar, setShowRightSidebar] = useState(true);`):

```tsx
const [showBottomTerminal, setShowBottomTerminal] = useState(false);
```

**Step 2: Add Cmd+` keyboard handler**

In the `handleKeyDown` function (around line 337), add after the Cmd+Option+B handler:

```tsx
// Cmd+` to toggle bottom terminal
if (e.key === '`' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
  e.preventDefault();
  setShowBottomTerminal((prev) => !prev);
}
```

**Step 3: Add menu event handler**

In the `safeListen<string>('menu-event', ...)` handler (around line 420), add a case:

```tsx
case 'toggle_terminal':
  setShowBottomTerminal((prev) => !prev);
  break;
```

**Step 4: Commit state and handlers**

```bash
git add src/app/page.tsx
git commit -m "feat: add showBottomTerminal state and Cmd+\` keyboard shortcut"
```

---

### Task 4: Update page.tsx - Add Vertical ResizablePanelGroup

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add BottomTerminal import**

Add at the top with other imports:

```tsx
import { BottomTerminal } from '@/components/BottomTerminal';
```

**Step 2: Replace main content panel structure**

Replace the main content ResizablePanel (lines 520-533) with nested vertical layout:

```tsx
{/* Main Content */}
<ResizablePanel id="main-content" defaultSize={48} minSize={30}>
  <ResizablePanelGroup direction="vertical">
    {/* Conversation Area */}
    <ResizablePanel id="conversation" defaultSize={showBottomTerminal ? 70 : 100} minSize={30}>
      <div className="flex flex-col h-full">
        <TopBar
          showLeftSidebar={showLeftSidebar}
          showRightSidebar={showRightSidebar}
          onToggleLeftSidebar={() => setShowLeftSidebar((prev) => !prev)}
          onToggleRightSidebar={() => setShowRightSidebar((prev) => !prev)}
        />
        <ConversationArea>
          <ChatInput />
        </ConversationArea>
      </div>
    </ResizablePanel>

    {/* Bottom Terminal */}
    {showBottomTerminal && selectedSessionId && (
      <>
        <ResizableHandle />
        <ResizablePanel id="bottom-terminal" defaultSize={30} minSize={15} maxSize={70}>
          <BottomTerminal
            sessionId={selectedSessionId}
            workspacePath={workspaces.find((w) => w.id === selectedWorkspaceId)?.path}
            onClose={() => setShowBottomTerminal(false)}
          />
        </ResizablePanel>
      </>
    )}
  </ResizablePanelGroup>
</ResizablePanel>
```

**Step 3: Verify app compiles and renders**

Run: `npm run dev`
Expected: App loads, Cmd+` toggles terminal panel

**Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add bottom terminal panel with vertical ResizablePanelGroup"
```

---

### Task 5: Update ChangesPanel - Remove Terminal Tab

**Files:**
- Modify: `src/components/ChangesPanel.tsx`

**Step 1: Remove Terminal dynamic import**

Delete lines 11-14 (the Terminal dynamic import):

```tsx
// DELETE THIS:
const Terminal = dynamic(() => import('@/components/Terminal').then(mod => mod.Terminal), {
  ssr: false,
  loading: () => <div className="h-full bg-black/90 flex items-center justify-center"><span className="text-xs text-muted-foreground">Loading terminal...</span></div>,
});
```

**Step 2: Remove terminalTab state**

Delete line 77:

```tsx
// DELETE THIS:
const [terminalTab, setTerminalTab] = useState('terminal');
```

**Step 3: Find and update the terminal section**

The terminal section (around lines 418-465) needs to be simplified. Replace the terminal tabs section with just Setup/Run:

Find the terminal section with tabs (Setup, Run, Terminal buttons) and replace with:

```tsx
{/* Setup/Run Output Section */}
<div className="flex flex-col h-full">
  <div className="flex items-center gap-1 px-2 py-1 border-t bg-muted/30 shrink-0">
    <Button
      variant={terminalTab === 'setup' ? 'secondary' : 'ghost'}
      size="sm"
      className="h-6 text-xs px-2"
      onClick={() => setTerminalTab('setup')}
    >
      Setup
    </Button>
    <Button
      variant={terminalTab === 'run' ? 'secondary' : 'ghost'}
      size="sm"
      className="h-6 text-xs px-2"
      onClick={() => setTerminalTab('run')}
    >
      Run
    </Button>
  </div>
  <div className="flex-1 min-h-0">
    {terminalTab === 'setup' && selectedSessionId && (
      <TerminalOutput sessionId={selectedSessionId} type="setup" />
    )}
    {terminalTab === 'run' && selectedSessionId && (
      <TerminalOutput sessionId={selectedSessionId} type="run" />
    )}
  </div>
</div>
```

Wait - we still need terminalTab state for Setup/Run toggle. Let me revise:

**Step 2 (revised): Rename terminalTab to outputTab**

Change line 77 from:
```tsx
const [terminalTab, setTerminalTab] = useState('terminal');
```
To:
```tsx
const [outputTab, setOutputTab] = useState<'setup' | 'run'>('setup');
```

**Step 3 (revised): Update the output section**

Replace the full terminal section (Setup/Run/Terminal tabs and content) with just Setup/Run:

```tsx
{/* Setup/Run Output Section */}
<div className="flex flex-col h-full">
  <div className="flex items-center gap-1 px-2 py-1 border-t bg-muted/30 shrink-0">
    <Button
      variant={outputTab === 'setup' ? 'secondary' : 'ghost'}
      size="sm"
      className="h-6 text-xs px-2"
      onClick={() => setOutputTab('setup')}
    >
      Setup
    </Button>
    <Button
      variant={outputTab === 'run' ? 'secondary' : 'ghost'}
      size="sm"
      className="h-6 text-xs px-2"
      onClick={() => setOutputTab('run')}
    >
      Run
    </Button>
  </div>
  <div className="flex-1 min-h-0">
    {outputTab === 'setup' && selectedSessionId && (
      <TerminalOutput sessionId={selectedSessionId} type="setup" />
    )}
    {outputTab === 'run' && selectedSessionId && (
      <TerminalOutput sessionId={selectedSessionId} type="run" />
    )}
  </div>
</div>
```

**Step 4: Remove Terminal case from conditional rendering**

Delete the Terminal rendering code:

```tsx
// DELETE THIS:
{terminalTab === 'terminal' && selectedSessionId && (
  <Terminal
    sessionId={selectedSessionId}
    workspacePath={currentWorkspace?.path}
  />
)}
```

**Step 5: Verify app compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 6: Commit**

```bash
git add src/components/ChangesPanel.tsx
git commit -m "refactor: remove Terminal tab from ChangesPanel, keep Setup/Run output"
```

---

### Task 6: Test and Final Commit

**Step 1: Test the feature**

Run: `npm run dev`

Verify:
- [ ] Cmd+` toggles bottom terminal panel
- [ ] Terminal appears below conversation area
- [ ] Terminal is resizable (drag handle)
- [ ] Close button (X) hides terminal
- [ ] View menu has "Toggle Terminal" option
- [ ] Right sidebar still has Files/Changes/Todo tabs
- [ ] Right sidebar has Setup/Run output section
- [ ] Terminal PTY works (type commands)

**Step 2: Test Tauri build**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors

**Step 3: Final cleanup commit if needed**

If any fixes were required:
```bash
git add -A
git commit -m "fix: bottom terminal panel polish"
```

---

## Verification Checklist

- [ ] Cmd+` toggles terminal (keyboard)
- [ ] View > Toggle Terminal works (menu)
- [ ] Terminal panel is resizable
- [ ] Terminal close button works
- [ ] Right sidebar unchanged (Files/Changes/Todo + Setup/Run)
- [ ] No TypeScript errors
- [ ] Rust compiles
