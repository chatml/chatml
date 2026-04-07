# Custom Text Selection Engine for NativeLoop CLI

## Problem

Terminal mouse reporting is all-or-nothing — enabling mouse capture for scroll wheel
breaks native text selection. Claude Code solves this with a custom selection engine
built into Ink. We need the same for BubbleTea.

## How Claude Code Does It

From `/src/ink/selection.ts` and `/src/ink/hooks/use-selection.ts`:

1. **Full mouse capture** enabled (mode 1002 + 1006)
2. **Custom hit-testing** — maps mouse coordinates to rendered content cells
3. **Selection state** — tracks start/end positions of drag selection
4. **Highlight rendering** — inverts colors on selected cells during render
5. **Clipboard integration** — copies selected text on mouse-up
6. **NoSelect zones** — gutters, line numbers, tree chars excluded from selection

## Implementation Plan for BubbleTea

### Phase 1: Mouse Event Parsing

Enable `WithMouseCellMotion()` and parse raw mouse events:
- Button press (left click) → start selection at (x, y)
- Mouse motion with button held → extend selection to (x, y)
- Button release → finalize selection, copy to clipboard

BubbleTea already provides `tea.MouseMsg` with X, Y coordinates and button info.

### Phase 2: Content Cell Map

Build a map from screen coordinates to content characters:
- After `renderMessages()` produces the viewport content string
- Parse ANSI codes to track actual character positions (strip formatting)
- Map each (x, y) position to the underlying text character
- Track which zones are "no-select" (tool headers, tree chars, bullet points)

Use `github.com/muesli/ansi` for ANSI-aware string operations.

### Phase 3: Selection Rendering

On each frame while selection is active:
- Overlay inverse video (swap fg/bg colors) on selected cells
- Use ANSI SGC escape codes for inversion: `\x1b[7m` (reverse) / `\x1b[27m` (normal)
- Apply to the viewport content before display

### Phase 4: Clipboard Integration

On mouse-up (selection finalized):
- Extract selected text (plain, no ANSI codes)
- Copy to system clipboard via:
  - macOS: `pbcopy` (exec)
  - Linux: `xclip` or `xsel` (exec)
  - Fallback: OSC 52 escape sequence (works in iTerm2, Kitty, etc.)

OSC 52 is preferred — no subprocess needed:
```
\x1b]52;c;BASE64_CONTENT\x07
```

### Phase 5: NoSelect Zones

Mark non-selectable content:
- Tool header bullets (●)
- Tree drawing characters (├─/└─/│)
- Result line prefix (⎿)
- Line numbers in code blocks
- Status bar and input area

### Key Files

```
core/cmd/nativeloop/
  selection.go      — SelectionState, hit-testing, coordinate mapping
  selection_render.go — Overlay rendering for selected cells
  clipboard.go      — OSC 52 + pbcopy/xclip clipboard integration
```

### Dependencies

- `github.com/muesli/ansi` — ANSI-aware string width/truncation (already indirect dep)
- No new external dependencies needed

### Estimated Effort

- Phase 1 (mouse events): S — BubbleTea already provides parsed mouse events
- Phase 2 (cell map): L — the hardest part, ANSI-aware coordinate mapping
- Phase 3 (selection rendering): M — inverse video overlay
- Phase 4 (clipboard): S — OSC 52 is simple
- Phase 5 (no-select): M — marking zones in rendered content

Total: ~L effort, estimated 2-3 focused sessions.

### References

- Claude Code: `src/ink/selection.ts`, `src/ink/hooks/use-selection.ts`, `src/ink/hit-test.ts`
- OSC 52: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands
- BubbleTea mouse: https://github.com/charmbracelet/bubbletea/blob/main/mouse.go
- ANSI string width: https://github.com/muesli/ansi
