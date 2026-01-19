# Workspace-Scoped Terminal Sessions Design

Terminal sessions scoped to workspaces with multi-tab support.

## Requirements

- Terminal sessions scoped to workspaces
- Multiple sessions per workspace (max 5) with tabs
- Reuse closed slot numbers (Terminal 1, Terminal 2, etc.)
- Switch terminal context when workspace changes
- Terminal starts in workspace path
- Ephemeral - no persistence across app restarts
- Persist bottom panel visibility across restarts
- Panel visibility user-controlled (doesn't change on workspace switch)

## State Management

**appStore (ephemeral):**

```typescript
interface TerminalInstance {
  id: string;           // "ws-123-term-1"
  workspaceId: string;
  slotNumber: number;   // 1-5, reused when closed
  status: 'active' | 'exited';
}

terminalInstances: Record<string, TerminalInstance[]>; // keyed by workspaceId
activeTerminalId: Record<string, string>;              // keyed by workspaceId
```

**settingsStore (persisted):**

```typescript
showBottomTerminal: boolean;  // persisted across restarts
```

## UI Design

```
┌─────────────────────────────────────────────────────────────┐
│ [Terminal 1] [Terminal 2] [+]                          [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Terminal content here                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Tabs**: Active terminals for current workspace
- **[+] button**: Create new terminal (disabled at max 5)
- **[X] on tab**: Close terminal session (kills PTY)
- **[X] on right**: Hide panel (keeps PTYs running)
- **Empty state**: "Click + to create terminal" when no terminals

## Component Architecture

**Files to modify:**
- `appStore.ts` - Add terminal state and actions
- `settingsStore.ts` - Add `showBottomTerminal`
- `page.tsx` - Use settingsStore for panel visibility
- `BottomTerminal.tsx` - Rewrite with tabs and multi-terminal

**BottomTerminal props:**

```typescript
interface BottomTerminalProps {
  workspaceId: string;
  workspacePath: string;
  onHide: () => void;
}
```

**Terminal rendering:**
- Each tab renders its own `<Terminal>` component
- Hidden tabs use `display: none` to preserve PTY
- Active tab shown normally

## Terminal Lifecycle

**Creating:**
1. Find lowest available slot (1-5)
2. Generate ID: `${workspaceId}-term-${slotNumber}`
3. Start PTY with `cwd: workspacePath`
4. Add to `terminalInstances[workspaceId]`
5. Set as active

**Closing:**
1. Kill PTY process
2. Remove from instances
3. Slot becomes available
4. Select adjacent tab (or show empty state)

**Workspace switching:**
- Instances stay in memory (PTY keeps running)
- UI shows that workspace's terminals
- Restores workspace's active terminal

**Panel hide/show:**
- Hide: Collapse panel, PTYs keep running
- Show: Expand, show workspace terminals
- Auto-create "Terminal 1" if none exist
