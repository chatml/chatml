# Workspace-Scoped Terminal Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement multi-tab terminal sessions scoped to workspaces with persistent panel visibility.

**Architecture:** Store terminal instances in appStore (ephemeral), panel visibility in settingsStore (persisted). BottomTerminal component manages tabs and renders Terminal components with display toggling to preserve PTY connections.

**Tech Stack:** React, Zustand, xterm.js, tauri-pty (existing)

---

### Task 1: Add showBottomTerminal to settingsStore

**Files:**
- Modify: `src/stores/settingsStore.ts`

**Step 1: Add state and action to interface**

```typescript
// Add to SettingsState interface
showBottomTerminal: boolean;
setShowBottomTerminal: (value: boolean) => void;
```

**Step 2: Add default and action implementation**

```typescript
// Add to store defaults
showBottomTerminal: false,

// Add to actions
setShowBottomTerminal: (value) => set({ showBottomTerminal: value }),
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat: add showBottomTerminal to settingsStore (persisted)"
```

---

### Task 2: Add terminal state to appStore

**Files:**
- Modify: `src/stores/appStore.ts`
- Modify: `src/lib/types.ts`

**Step 1: Add TerminalInstance type to types.ts**

```typescript
export interface TerminalInstance {
  id: string;           // "workspaceId-term-slotNumber"
  workspaceId: string;
  slotNumber: number;   // 1-5
  status: 'active' | 'exited';
}
```

**Step 2: Add terminal state to appStore interface**

```typescript
// Add to AppState interface
terminalInstances: Record<string, TerminalInstance[]>; // keyed by workspaceId
activeTerminalId: Record<string, string | null>;       // keyed by workspaceId

// Add actions
createTerminal: (workspaceId: string) => TerminalInstance | null;
closeTerminal: (workspaceId: string, terminalId: string) => void;
setActiveTerminal: (workspaceId: string, terminalId: string) => void;
markTerminalExited: (terminalId: string) => void;
```

**Step 3: Add state defaults and action implementations**

```typescript
// Defaults
terminalInstances: {},
activeTerminalId: {},

// Actions
createTerminal: (workspaceId) => {
  const state = get();
  const existing = state.terminalInstances[workspaceId] || [];

  // Max 5 terminals per workspace
  if (existing.length >= 5) return null;

  // Find lowest available slot (1-5)
  const usedSlots = new Set(existing.map(t => t.slotNumber));
  let slot = 1;
  while (usedSlots.has(slot) && slot <= 5) slot++;

  const terminal: TerminalInstance = {
    id: `${workspaceId}-term-${slot}`,
    workspaceId,
    slotNumber: slot,
    status: 'active',
  };

  set({
    terminalInstances: {
      ...state.terminalInstances,
      [workspaceId]: [...existing, terminal],
    },
    activeTerminalId: {
      ...state.activeTerminalId,
      [workspaceId]: terminal.id,
    },
  });

  return terminal;
},

closeTerminal: (workspaceId, terminalId) => {
  const state = get();
  const existing = state.terminalInstances[workspaceId] || [];
  const filtered = existing.filter(t => t.id !== terminalId);
  const wasActive = state.activeTerminalId[workspaceId] === terminalId;

  let newActiveId = state.activeTerminalId[workspaceId];
  if (wasActive && filtered.length > 0) {
    // Select next available or last
    const closedIndex = existing.findIndex(t => t.id === terminalId);
    const nextIndex = Math.min(closedIndex, filtered.length - 1);
    newActiveId = filtered[nextIndex]?.id || null;
  } else if (filtered.length === 0) {
    newActiveId = null;
  }

  set({
    terminalInstances: {
      ...state.terminalInstances,
      [workspaceId]: filtered,
    },
    activeTerminalId: {
      ...state.activeTerminalId,
      [workspaceId]: newActiveId,
    },
  });
},

setActiveTerminal: (workspaceId, terminalId) => {
  set({
    activeTerminalId: {
      ...get().activeTerminalId,
      [workspaceId]: terminalId,
    },
  });
},

markTerminalExited: (terminalId) => {
  const state = get();
  const updated = { ...state.terminalInstances };
  for (const wsId of Object.keys(updated)) {
    updated[wsId] = updated[wsId].map(t =>
      t.id === terminalId ? { ...t, status: 'exited' as const } : t
    );
  }
  set({ terminalInstances: updated });
},
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/stores/appStore.ts src/lib/types.ts
git commit -m "feat: add terminal instance state and actions to appStore"
```

---

### Task 3: Update page.tsx to use settingsStore for panel visibility

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Import setShowBottomTerminal from settingsStore**

Add to existing settingsStore import or add new import:

```typescript
import { useSettingsStore } from '@/stores/settingsStore';
```

**Step 2: Replace local showBottomTerminal state**

Remove:
```typescript
const [showBottomTerminal, setShowBottomTerminal] = useState(false);
```

Replace with:
```typescript
const { showBottomTerminal, setShowBottomTerminal } = useSettingsStore();
```

**Step 3: Update BottomTerminal props**

Change:
```typescript
<BottomTerminal
  sessionId={selectedSessionId}
  workspacePath={workspaces.find((w) => w.id === selectedWorkspaceId)?.path}
  onClose={() => setShowBottomTerminal(false)}
/>
```

To:
```typescript
<BottomTerminal
  workspaceId={selectedWorkspaceId!}
  workspacePath={workspaces.find((w) => w.id === selectedWorkspaceId)?.path || ''}
  onHide={() => setShowBottomTerminal(false)}
/>
```

**Step 4: Update conditional rendering**

Change `selectedSessionId` checks to `selectedWorkspaceId`:

```typescript
{selectedWorkspaceId && (
  <ResizablePanel ...>
    <div className={showBottomTerminal ? 'h-full' : 'h-0 overflow-hidden'}>
      <BottomTerminal
        workspaceId={selectedWorkspaceId}
        workspacePath={workspaces.find((w) => w.id === selectedWorkspaceId)?.path || ''}
        onHide={() => setShowBottomTerminal(false)}
      />
    </div>
  </ResizablePanel>
)}
```

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors about BottomTerminal props (expected, will fix in next task)

**Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: use settingsStore for bottom terminal visibility"
```

---

### Task 4: Rewrite BottomTerminal with tabs

**Files:**
- Modify: `src/components/BottomTerminal.tsx`

**Step 1: Rewrite the component**

```typescript
'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/appStore';
import { cn } from '@/lib/utils';

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
  workspaceId: string;
  workspacePath: string;
  onHide: () => void;
}

export function BottomTerminal({ workspaceId, workspacePath, onHide }: BottomTerminalProps) {
  const {
    terminalInstances,
    activeTerminalId,
    createTerminal,
    closeTerminal,
    setActiveTerminal,
    markTerminalExited,
  } = useAppStore();

  const instances = terminalInstances[workspaceId] || [];
  const activeId = activeTerminalId[workspaceId];
  const canCreateMore = instances.length < 5;

  // Auto-create first terminal when panel is shown and no terminals exist
  useEffect(() => {
    if (instances.length === 0) {
      createTerminal(workspaceId);
    }
  }, [workspaceId, instances.length, createTerminal]);

  const handleCreateTerminal = () => {
    if (canCreateMore) {
      createTerminal(workspaceId);
    }
  };

  const handleCloseTerminal = (terminalId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeTerminal(workspaceId, terminalId);
  };

  const handleTerminalExit = (terminalId: string) => {
    markTerminalExited(terminalId);
  };

  return (
    <div className="flex flex-col h-full bg-background border-t">
      {/* Header with tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-muted/30 shrink-0">
        {/* Terminal tabs */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          {instances.map((terminal) => (
            <button
              key={terminal.id}
              onClick={() => setActiveTerminal(workspaceId, terminal.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs rounded-sm shrink-0',
                'hover:bg-accent/50 transition-colors',
                activeId === terminal.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground'
              )}
            >
              <span>Terminal {terminal.slotNumber}</span>
              {terminal.status === 'exited' && (
                <span className="text-[10px] text-yellow-500">(exited)</span>
              )}
              <X
                className="h-3 w-3 hover:text-destructive"
                onClick={(e) => handleCloseTerminal(terminal.id, e)}
              />
            </button>
          ))}

          {/* Add terminal button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleCreateTerminal}
            disabled={!canCreateMore}
            title={canCreateMore ? 'New terminal' : 'Maximum 5 terminals'}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Hide panel button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onHide}
          title="Hide terminal panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 min-h-0 relative">
        {instances.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Click + to create a terminal
          </div>
        ) : (
          instances.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                'absolute inset-0',
                activeId === terminal.id ? 'block' : 'hidden'
              )}
            >
              <Terminal
                sessionId={terminal.id}
                workspacePath={workspacePath}
                onExit={() => handleTerminalExit(terminal.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/BottomTerminal.tsx
git commit -m "feat: rewrite BottomTerminal with multi-tab support"
```

---

### Task 5: Update Terminal component to use unique keys

**Files:**
- Modify: `src/components/Terminal.tsx`

**Step 1: Add key prop handling**

The Terminal component already uses `sessionId` as a data attribute. Ensure the component properly reinitializes when sessionId changes by adding it to the useTerminal dependency.

Check if `useTerminal` hook needs the sessionId/terminalId to distinguish instances. The hook already creates a new instance per mount, so multiple Terminal components with different IDs will each have their own PTY.

No changes needed if the component already works with multiple instances. Verify by reviewing `useTerminal.ts`.

**Step 2: Verify multiple terminals work**

Run: `npm run dev`
Test: Open terminal panel, create multiple terminals, switch between them

**Step 3: Commit (if changes were needed)**

```bash
git add src/components/Terminal.tsx
git commit -m "fix: ensure Terminal component supports multiple instances"
```

---

### Task 6: Test and polish

**Step 1: Test all functionality**

Run: `npm run dev`

Verify:
- [ ] Panel visibility persists across page refresh
- [ ] Creating terminals (up to 5)
- [ ] Switching between tabs
- [ ] Closing terminals (slot reuse)
- [ ] Switching workspaces (terminals preserved, UI switches)
- [ ] Terminal starts in workspace path
- [ ] Cmd+K clears terminal
- [ ] Ctrl+` toggles panel
- [ ] PTY stays alive when panel hidden
- [ ] PTY stays alive when switching tabs

**Step 2: Fix any issues found**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: workspace-scoped terminal sessions with multi-tab support"
```

---

## Verification Checklist

- [ ] Panel visibility persisted in settingsStore
- [ ] Max 5 terminals per workspace
- [ ] Slot numbers reused (Terminal 1, 2, etc.)
- [ ] Workspace switch shows that workspace's terminals
- [ ] Auto-create Terminal 1 when panel opened with none
- [ ] Close tab kills PTY
- [ ] Hide panel keeps PTYs alive
- [ ] TypeScript compiles
