# Sidebar Session Grouping Redesign

## Problem

The current sidebar organizes sessions as a flat list under each project, sorted by recency. There is no visual workflow guidance — users can't see at a glance what's in-progress, what needs review, and what's done. Pinning exists as a workaround but doesn't scale. Branches and Pull Requests occupy prime sidebar real estate despite infrequent use.

## Design

### Top-Level Structure

The sidebar structure becomes:

```
Dashboard                         <- top nav (unchanged)
Sessions                          <- top nav (unchanged)
Skills                            <- top nav (unchanged)
──────────────────────────────────
[Group: Project v]  [Sort: Recent v]   <- control row
──────────────────────────────────
<session list>                    <- dynamic based on grouping
──────────────────────────────────
[+]  Search sessions...      [filter]  <- footer (unchanged)
```

### Grouping Modes

Four grouping modes controlled by a dropdown in the control row:

| Mode | Behavior |
|------|----------|
| **None** | Flat list of all sessions across all projects. Project shown inline as colored dot + name on second line of each session row. |
| **Project** (default) | Collapsible project headers with sessions underneath. Same as today minus Branches/PRs. |
| **Status** | Collapsible status headers (In Progress, Needs Review, Backlog, Done, Cancelled). Project shown inline on each session row. "Done" collapsed by default. |
| **Project > Status** | Collapsible project headers, with collapsible status sub-groups within each project. "Done" sub-groups collapsed by default. |

### Sort Options

Sort applies within the innermost group (or to the whole list when ungrouped):

- **Recent** (default) — last updated first
- **Status** — in_progress > in_review > backlog > done > cancelled, sub-sorted by recency
- **Priority** — urgent > high > medium > low > none, sub-sorted by recency
- **Name** — alphabetical by branch name

### Control Row UI

Two controls, always visible between the top nav and the session list:

- **Group control** (left): Dropdown chip showing current mode. Icon changes to reflect grouping (grid for project, circle-dot for status, nested for composite, dash for none).
- **Sort control** (right): Dropdown chip showing current sort field.

Both preferences persisted in `settingsStore`.

### Session Row

Two-line format (largely unchanged from today):

**Line 1:** Task status icon + branch name + time since update
**Line 2:** Project indicator (when not grouped by project) + PR status + git stats (+/-) + priority icon

Changes:
- **Pinning removed.** Status grouping replaces the need for pinning.
- Project color dot + name shown inline when session is not inside a project group header.

### Group Headers

**Project header:** Colored dot + project name + session count badge + collapse toggle. On hover: "+" (new session) and "..." (context menu).

**Status header:** Status icon + label + count in parentheses + collapse toggle. "Done" and "Cancelled" groups are collapsed by default.

### Branches & Pull Requests

Removed from the sidebar tree as top-level items under each project. Accessible via:

1. **Right-click project header** (when grouped by project) — context menu includes "Branches" and "Pull Requests"
2. **Right-click any session** — context menu includes "Branches" and "Pull Requests" for that session's parent project

### Context Menus

**Project header context menu:**
- New Session
- Branches
- Pull Requests
- Workspace Settings
- Open in Finder
- Open in Terminal
- Copy Path
- Mark as Unread
- Remove

**Session context menu:**
- Open in New Tab
- Branches (parent project)
- Pull Requests (parent project)
- Change Status >
- Archive
- Delete

### Persistence

Stored in `settingsStore`:
- `sidebarGroupBy`: `'none' | 'project' | 'status' | 'project-status'` (default: `'project'`)
- `sidebarSortBy`: `'recent' | 'status' | 'priority' | 'name'` (default: `'recent'`)
- Collapse states per group header (project IDs, status keys)

### What's Removed

- **Session pinning** — replaced by status grouping
- **Branches / Pull Requests as sidebar tree items** — moved to context menus
- Pin/unpin UI (hover button, context menu option)

### What's Unchanged

- Top nav items (Dashboard, Sessions, Skills)
- Search bar and filter system in footer
- Session row information density
- Workspace color customization
- Drag-and-drop workspace reordering (when grouped by project)
- New session creation (+ button)

## Visual Examples

### Group by Project (default)

```
● chatml (3)                        v
  ⟡ feature/real-app-icons          3m
     +12 -4
  ⟡ fix/websocket-reconnect         1h
     +3 -1
  ◌ refactor/auth-flow              2d

● other-repo (1)                    v
  ⟢ feature/new-api                 5h
     PR #42 · Ready to merge
```

### Group by Status

```
In Progress (3)                     v
  ⟡ feature/real-app-icons   ● chatml · 3m
  ⟡ fix/websocket            ● chatml · 1h
  ⟡ feature/new-api          ● other-repo · 5h

Needs Review (1)                    v
  ⟢ fix/auth-bug             ● chatml · 2h

Backlog (2)                         v
  ◌ refactor/auth-flow        ● chatml · 2d
  ◌ feature/dark-mode         ● other-repo · 3d

Done (1)                            >  (collapsed)
```

### Group by Project > Status

```
● chatml (4)                        v
  In Progress (2)                   v
    ⟡ feature/real-app-icons        3m
    ⟡ fix/websocket-reconnect       1h
  Needs Review (1)                  v
    ⟢ fix/auth-bug                  2h
  Backlog (1)                       v
    ◌ refactor/auth-flow            2d

● other-repo (2)                    v
  In Progress (1)                   v
    ⟡ feature/new-api               5h
  Backlog (1)                       v
    ◌ feature/dark-mode             3d
```

### No Grouping (flat list, sorted by recent)

```
  ⟡ feature/real-app-icons   ● chatml · 3m
  ⟡ fix/websocket-reconnect  ● chatml · 1h
  ⟢ fix/auth-bug             ● chatml · 2h
  ⟡ feature/new-api          ● other-repo · 5h
  ◌ refactor/auth-flow        ● chatml · 2d
  ◌ feature/dark-mode         ● other-repo · 3d
```
