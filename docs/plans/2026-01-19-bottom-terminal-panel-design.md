# Bottom Terminal Panel Design

Move the interactive terminal from the right sidebar to a collapsible bottom panel in the main content area, toggled with Cmd+`.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Left Sidebar │        Main Content Area        │ Right Sidebar │
│              │ ┌─────────────────────────────┐ │               │
│ Workspaces   │ │ TopBar                      │ │ Files/Changes │
│ Sessions     │ │ ConversationArea            │ │ Todo          │
│              │ │ ChatInput                   │ │ Setup/Run     │
│              │ ├─────────────────────────────┤ │               │
│              │ │ Terminal (collapsible)      │ │               │
│              │ └─────────────────────────────┘ │               │
└─────────────────────────────────────────────────────────────────┘
```

- Terminal panel lives inside the main content column only
- When collapsed: ConversationArea expands to full height
- Resizable handle between conversation and terminal when open
- Default height ~30% when open

## Behavior

- **Default state:** Closed
- **Toggle:** Cmd+` (keyboard) or View menu
- **Collapse:** Panel disappears completely, content takes full height
- **Persistence:** Terminal PTY stays connected when panel is hidden
- **Resize:** Remembers last height setting

## Right Sidebar Changes

After moving Terminal out:
- Tabs: Files | Changes | Todo
- Bottom section: Setup/Run output (collapsible)
- No Terminal tab

## Files to Change

| File | Changes |
|------|---------|
| `src/app/page.tsx` | Add `showBottomTerminal` state, Cmd+` handler, nested vertical ResizablePanelGroup |
| `src/components/ChangesPanel.tsx` | Remove Terminal tab/import, keep Setup/Run output section |
| `src/components/BottomTerminal.tsx` | **NEW** - Header bar with close button + Terminal component |
| `src-tauri/src/lib.rs` | Add "Toggle Terminal" menu item with Cmd+` accelerator |

## Keyboard Shortcuts

- `Cmd+`` - Toggle bottom terminal panel
- Existing shortcuts unchanged

## Components Reused

- `Terminal.tsx` - Interactive terminal (no changes)
- `TerminalOutput.tsx` - Setup/Run output in right sidebar (no changes)
- `useTerminal.ts` - Terminal hook (no changes)
