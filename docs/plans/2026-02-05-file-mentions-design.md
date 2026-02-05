# File Mentions (@) Design

## Overview

Add `@` file mention support to the chat input. Users type `@`, see a file picker popover, select files, and those appear as inline pills in the message. When sent, file paths are passed to the agent as references (not full contents).

## User Experience

1. User types `@` anywhere in the input
2. File picker popover appears with searchable file list
3. Arrow keys navigate, Enter/Tab selects, Escape dismisses
4. Selected file appears as inline pill: `[📄 Button.tsx]`
5. Multiple files can be selected, user continues typing around pills
6. Backspace into pill selects it, another backspace deletes it
7. On send, message includes file paths as metadata for agent

**Visual:**
```
┌─────────────────────────────────────────────────────┐
│ Can you refactor [📄 Button.tsx] to match the      │
│ pattern in [📄 Card.tsx] please?                   │
└─────────────────────────────────────────────────────┘
```

Pills are inline DOM elements in a contenteditable div.

## Technical Approach

### Contenteditable Input

Replace `<Textarea>` with `<div contenteditable>` to support inline pill elements. This matches industry standard (Slack, Discord, Cursor, Claude.ai).

**Pill DOM structure:**
```html
<span
  contenteditable="false"
  data-mention-path="src/components/Button.tsx"
  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-sm"
>
  📄 Button.tsx
</span>
```

`contenteditable="false"` makes pills behave as atomic units.

### Component Structure

```
ChatInput.tsx
├── RichTextInput.tsx (new)        # Contenteditable wrapper
│   ├── handles input, paste, keydown
│   ├── manages cursor position
│   └── renders inline pills
├── FileMentionMenu.tsx (new)      # @ popover (similar to SlashCommandMenu)
└── useFileMentions.ts (new)       # Hook for @ trigger detection + state
```

### Hook Interface (useFileMentions)

```typescript
interface UseFileMentionsReturn {
  isOpen: boolean;
  query: string;
  files: FlatFile[];              // Filtered file list
  selectedIndex: number;
  isLoading: boolean;

  handleInput: (element: HTMLDivElement) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  selectFile: (file: FlatFile) => void;
  dismiss: () => void;
  setSelectedIndex: (index: number) => void;
}
```

Mirrors existing `useSlashCommands` pattern.

### Data Model

**FileReference type:**
```typescript
interface FileReference {
  id: string;    // Unique ID for React keys
  path: string;  // "src/components/Button.tsx"
  name: string;  // "Button.tsx"
}
```

**Message payload:**
```typescript
{
  content: "Can you refactor @src/components/Button.tsx to match @src/components/Card.tsx",
  mentionedFiles: [
    "src/components/Button.tsx",
    "src/components/Card.tsx"
  ],
  attachments: [...]  // Existing drag-drop attachments unchanged
}
```

### Content Extraction

On submit, walk the contenteditable DOM:

```typescript
function extractContent(element: HTMLDivElement): {
  text: string;
  mentionedFiles: string[];
} {
  const mentionedFiles: string[] = [];
  let text = '';

  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node instanceof HTMLElement && node.dataset.mentionPath) {
      mentionedFiles.push(node.dataset.mentionPath);
      text += `@${node.dataset.mentionPath}`;
    }
  }

  return { text: text.trim(), mentionedFiles };
}
```

## File Changes

### Modified Files

| File | Change |
|------|--------|
| `ChatInput.tsx` | Replace `<Textarea>` with `<RichTextInput>`, wire up `useFileMentions` |
| `api.ts` | Update `sendConversationMessage` to accept `mentionedFiles` |
| `types.ts` | Add `mentionedFiles?: string[]` to message type |

### New Files

| File | Purpose |
|------|---------|
| `src/components/conversation/RichTextInput.tsx` | Contenteditable wrapper |
| `src/components/conversation/FileMentionMenu.tsx` | @ file picker popover |
| `src/hooks/useFileMentions.ts` | @ trigger detection + file state |

### Reused Code

From existing `FilePicker.tsx`:
- `listSessionFiles` API
- `flattenFileTree` helper
- `fileFilter` search logic
- `FileIcon` component

## Edge Cases

- **Paste**: Strip HTML formatting, preserve pills if pasting from same input
- **Undo/redo**: Browser native contenteditable undo should work
- **Empty state**: No session selected → disable @ trigger
- **Coexistence**: Both `/` (slash commands) and `@` (file mentions) work independently
- **Large repos**: File list is cached per session, search filters client-side

## Backend Handling

Backend passes `mentionedFiles` to the agent as context. Agent sees referenced files and can read them via normal file tools. This keeps mentions lightweight (paths only, not contents) and works for any file size or type.
