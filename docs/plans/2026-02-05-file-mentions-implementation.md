# File Mentions (@) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add @ file mention support with inline pills in a contenteditable input.

**Architecture:** Replace Textarea with contenteditable div. Detect @ trigger, show file picker popover, insert pill elements. Extract text + file paths on submit.

**Tech Stack:** React, contenteditable, existing listSessionFiles API, Popover component

---

## Task 1: Create useFileMentions Hook

**Files:**
- Create: `src/hooks/useFileMentions.ts`

**Step 1: Create the hook file with types and trigger detection**

```typescript
import { useState, useCallback, useMemo, useRef } from 'react';
import { listSessionFiles, type FileNodeDTO } from '@/lib/api';

// Flat file for search results
export interface FlatFile {
  path: string;
  name: string;
  directory: string;
}

interface TriggerResult {
  active: boolean;
  query: string;
  triggerPos: number;
}

// Detect @ trigger in text before cursor
function detectAtTrigger(text: string, cursorPosition: number): TriggerResult {
  const inactive: TriggerResult = { active: false, query: '', triggerPos: -1 };

  if (!text || cursorPosition === 0) return inactive;

  const textBeforeCursor = text.slice(0, cursorPosition);

  // Find the last @ that's not escaped and not part of an email
  let atPos = -1;
  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    if (textBeforeCursor[i] === '@') {
      // Check it's not part of an email (no alphanumeric before it)
      if (i === 0 || /\s/.test(textBeforeCursor[i - 1])) {
        atPos = i;
        break;
      }
    }
    // Stop if we hit whitespace (no @ trigger in this word)
    if (/\s/.test(textBeforeCursor[i])) break;
  }

  if (atPos === -1) return inactive;

  const query = textBeforeCursor.slice(atPos + 1);

  // Don't trigger if query contains space (user moved on)
  if (query.includes(' ')) return inactive;

  return { active: true, query, triggerPos: atPos };
}

// Flatten file tree into searchable list
function flattenFileTree(nodes: FileNodeDTO[], parentPath: string = ''): FlatFile[] {
  const result: FlatFile[] = [];

  for (const node of nodes) {
    if (node.isDir) {
      if (node.children) {
        result.push(...flattenFileTree(node.children, node.path));
      }
    } else {
      const directory = parentPath || node.path.split('/').slice(0, -1).join('/');
      result.push({
        path: node.path,
        name: node.name,
        directory,
      });
    }
  }

  return result;
}

// Filter files by query
function filterFiles(files: FlatFile[], query: string): FlatFile[] {
  if (!query) return files.slice(0, 50); // Limit initial display

  const lowerQuery = query.toLowerCase();

  return files
    .filter((f) => {
      const lowerPath = f.path.toLowerCase();
      const lowerName = f.name.toLowerCase();
      return lowerName.includes(lowerQuery) || lowerPath.includes(lowerQuery);
    })
    .slice(0, 50);
}

export interface UseFileMentionsReturn {
  isOpen: boolean;
  query: string;
  files: FlatFile[];
  selectedIndex: number;
  isLoading: boolean;
  triggerPos: number;

  handleTextChange: (text: string, cursorPos: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
  selectFile: (file: FlatFile) => void;
  dismiss: () => void;
  setSelectedIndex: (index: number) => void;
}

interface UseFileMentionsOptions {
  workspaceId: string | null;
  sessionId: string | null;
  onSelectFile: (file: FlatFile, triggerPos: number) => void;
}

export function useFileMentions({
  workspaceId,
  sessionId,
  onSelectFile,
}: UseFileMentionsOptions): UseFileMentionsReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allFiles, setAllFiles] = useState<FlatFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const triggerPosRef = useRef(-1);
  const cachedSessionRef = useRef<string | null>(null);

  const filteredFiles = useMemo(
    () => filterFiles(allFiles, query),
    [allFiles, query]
  );

  const loadFiles = useCallback(async () => {
    if (!workspaceId || !sessionId) return;
    if (cachedSessionRef.current === sessionId && allFiles.length > 0) return;

    setIsLoading(true);
    try {
      const data = await listSessionFiles(workspaceId, sessionId, 'all');
      const flat = flattenFileTree(data);
      setAllFiles(flat);
      cachedSessionRef.current = sessionId;
    } catch (err) {
      console.error('Failed to load files for mentions:', err);
      setAllFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, sessionId, allFiles.length]);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
    triggerPosRef.current = -1;
  }, []);

  const selectFile = useCallback(
    (file: FlatFile) => {
      const triggerPos = triggerPosRef.current;
      dismiss();
      onSelectFile(file, triggerPos);
    },
    [dismiss, onSelectFile]
  );

  const handleTextChange = useCallback(
    (text: string, cursorPos: number) => {
      const trigger = detectAtTrigger(text, cursorPos);

      if (trigger.active) {
        if (!isOpen) {
          loadFiles();
        }
        triggerPosRef.current = trigger.triggerPos;
        setQuery(trigger.query);
        setIsOpen(true);
        setSelectedIndex((prev) =>
          prev >= filterFiles(allFiles, trigger.query).length ? 0 : prev
        );
      } else {
        if (isOpen) dismiss();
      }
    },
    [isOpen, dismiss, loadFiles, allFiles]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!isOpen || filteredFiles.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredFiles.length);
          return true;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length);
          return true;
        }
        case 'Enter':
        case 'Tab': {
          e.preventDefault();
          const selected = filteredFiles[selectedIndex];
          if (selected) {
            selectFile(selected);
          }
          return true;
        }
        case 'Escape': {
          e.preventDefault();
          dismiss();
          return true;
        }
        default:
          return false;
      }
    },
    [isOpen, filteredFiles, selectedIndex, selectFile, dismiss]
  );

  return {
    isOpen,
    query,
    files: filteredFiles,
    selectedIndex,
    isLoading,
    triggerPos: triggerPosRef.current,
    handleTextChange,
    handleKeyDown,
    selectFile,
    dismiss,
    setSelectedIndex,
  };
}
```

**Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/hooks/useFileMentions.ts 2>&1 || echo "Check errors above"`

Note: May show path alias errors when run standalone; that's OK.

**Step 3: Commit**

```bash
git add src/hooks/useFileMentions.ts
git commit -m "feat: add useFileMentions hook for @ trigger detection"
```

---

## Task 2: Create FileMentionMenu Component

**Files:**
- Create: `src/components/conversation/FileMentionMenu.tsx`

**Step 1: Create the menu component**

```typescript
'use client';

import { useRef, useEffect } from 'react';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/files/FileTree';
import { Loader2 } from 'lucide-react';
import type { FlatFile } from '@/hooks/useFileMentions';

interface FileMentionMenuProps {
  isOpen: boolean;
  files: FlatFile[];
  selectedIndex: number;
  query: string;
  isLoading: boolean;
  onSelect: (file: FlatFile) => void;
  onHover: (index: number) => void;
  onDismiss: () => void;
}

export function FileMentionMenu({
  isOpen,
  files,
  selectedIndex,
  query,
  isLoading,
  onSelect,
  onHover,
  onDismiss,
}: FileMentionMenuProps) {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <Popover open={isOpen} modal={false}>
      <PopoverAnchor asChild>
        <div className="absolute top-0 left-3 w-0 h-0" />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-80 p-1 max-h-[280px] overflow-y-auto"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={() => onDismiss()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
          Files
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query ? 'No files match your search' : 'No files found'}
          </div>
        ) : (
          files.map((file, idx) => {
            const isSelected = idx === selectedIndex;

            return (
              <div
                key={file.path}
                ref={isSelected ? selectedRef : undefined}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-default select-none',
                  isSelected && 'bg-accent text-accent-foreground',
                  !isSelected && 'hover:bg-muted'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(file);
                }}
                onMouseEnter={() => onHover(idx)}
              >
                <FileIcon filename={file.name} className="shrink-0" />
                <div className="flex flex-col min-w-0 gap-0">
                  <span className="text-sm truncate">
                    <HighlightMatch text={file.name} query={query} isSelected={isSelected} />
                  </span>
                  <span
                    className={cn(
                      'text-xs truncate',
                      isSelected ? 'text-accent-foreground/60' : 'text-muted-foreground/70'
                    )}
                  >
                    {file.directory}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}

function HighlightMatch({
  text,
  query,
  isSelected,
}: {
  text: string;
  query: string;
  isSelected: boolean;
}) {
  if (!query) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) return <>{text}</>;

  const before = text.slice(0, matchIndex);
  const match = text.slice(matchIndex, matchIndex + query.length);
  const after = text.slice(matchIndex + query.length);

  return (
    <>
      {before}
      <span
        className={cn(
          'font-semibold',
          isSelected ? 'text-accent-foreground' : 'text-foreground'
        )}
      >
        {match}
      </span>
      {after}
    </>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/conversation/FileMentionMenu.tsx
git commit -m "feat: add FileMentionMenu popover component"
```

---

## Task 3: Create RichTextInput Component

**Files:**
- Create: `src/components/conversation/RichTextInput.tsx`

**Step 1: Create the contenteditable wrapper**

```typescript
'use client';

import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { cn } from '@/lib/utils';
import { FileText } from 'lucide-react';

export interface FileReference {
  id: string;
  path: string;
  name: string;
}

export interface RichTextInputHandle {
  focus: () => void;
  clear: () => void;
  insertFilePill: (file: { path: string; name: string }, triggerPos: number) => void;
  getContent: () => { text: string; mentionedFiles: string[] };
  getText: () => string;
}

interface RichTextInputProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onInput?: (text: string, cursorPos: number) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}

export const RichTextInput = forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(
    {
      placeholder,
      disabled,
      className,
      onInput,
      onKeyDown,
      onFocus,
      onBlur,
      onPaste,
    },
    ref
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const isComposingRef = useRef(false);

    // Get current cursor position
    const getCursorPosition = useCallback((): number => {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !editorRef.current) return 0;

      const range = selection.getRangeAt(0);
      const preCaretRange = range.cloneRange();
      preCaretRange.selectNodeContents(editorRef.current);
      preCaretRange.setEnd(range.startContainer, range.startOffset);

      return preCaretRange.toString().length;
    }, []);

    // Set cursor position
    const setCursorPosition = useCallback((pos: number) => {
      const editor = editorRef.current;
      if (!editor) return;

      const selection = window.getSelection();
      if (!selection) return;

      let currentPos = 0;
      const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null
      );

      let node: Node | null = walker.nextNode();
      while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          const len = node.textContent?.length || 0;
          if (currentPos + len >= pos) {
            const range = document.createRange();
            range.setStart(node, pos - currentPos);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
          }
          currentPos += len;
        } else if (node instanceof HTMLElement && node.dataset.mentionPath) {
          // Pill counts as its display text length for cursor math
          const pillText = `@${node.dataset.mentionPath}`;
          if (currentPos + pillText.length >= pos) {
            // Place cursor after pill
            const range = document.createRange();
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
          }
          currentPos += pillText.length;
        }
        node = walker.nextNode();
      }

      // If position exceeds content, place at end
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }, []);

    // Extract content from DOM
    const getContent = useCallback((): { text: string; mentionedFiles: string[] } => {
      const editor = editorRef.current;
      if (!editor) return { text: '', mentionedFiles: [] };

      const mentionedFiles: string[] = [];
      let text = '';

      const processNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || '';
        } else if (node instanceof HTMLElement) {
          if (node.dataset.mentionPath) {
            mentionedFiles.push(node.dataset.mentionPath);
            text += `@${node.dataset.mentionPath}`;
          } else if (node.tagName === 'BR') {
            text += '\n';
          } else if (node.tagName === 'DIV' && text.length > 0 && !text.endsWith('\n')) {
            // Div typically creates a new line
            text += '\n';
            node.childNodes.forEach(processNode);
          } else {
            node.childNodes.forEach(processNode);
          }
        }
      };

      editor.childNodes.forEach(processNode);

      return { text: text.trim(), mentionedFiles };
    }, []);

    // Get plain text (for display/placeholder logic)
    const getText = useCallback((): string => {
      return getContent().text;
    }, [getContent]);

    // Clear the editor
    const clear = useCallback(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
    }, []);

    // Focus the editor
    const focus = useCallback(() => {
      editorRef.current?.focus();
    }, []);

    // Insert a file pill at the trigger position
    const insertFilePill = useCallback(
      (file: { path: string; name: string }, triggerPos: number) => {
        const editor = editorRef.current;
        if (!editor) return;

        // Create pill element
        const pill = document.createElement('span');
        pill.contentEditable = 'false';
        pill.dataset.mentionPath = file.path;
        pill.className =
          'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-muted text-sm align-baseline cursor-default select-none';
        pill.innerHTML = `<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg><span>${file.name}</span>`;

        // Find the @ trigger and replace it with the pill
        const content = getContent().text;
        const cursorPos = getCursorPosition();

        // Walk DOM to find and replace @ trigger
        let currentPos = 0;
        const walker = document.createTreeWalker(
          editor,
          NodeFilter.SHOW_TEXT,
          null
        );

        let textNode: Text | null = walker.nextNode() as Text | null;
        while (textNode) {
          const nodeText = textNode.textContent || '';
          const nodeStart = currentPos;
          const nodeEnd = currentPos + nodeText.length;

          if (triggerPos >= nodeStart && triggerPos < nodeEnd) {
            // Found the node containing the @ trigger
            const offsetInNode = triggerPos - nodeStart;
            const queryEndOffset = cursorPos - nodeStart;

            // Split: before @ | pill | after query
            const before = nodeText.slice(0, offsetInNode);
            const after = nodeText.slice(queryEndOffset);

            const parent = textNode.parentNode;
            if (parent) {
              const beforeNode = document.createTextNode(before);
              const afterNode = document.createTextNode(after + ' ');

              parent.insertBefore(beforeNode, textNode);
              parent.insertBefore(pill, textNode);
              parent.insertBefore(afterNode, textNode);
              parent.removeChild(textNode);

              // Place cursor after the space
              const selection = window.getSelection();
              if (selection) {
                const range = document.createRange();
                range.setStart(afterNode, 1);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              }
            }
            break;
          }

          currentPos = nodeEnd;
          textNode = walker.nextNode() as Text | null;
        }

        // Trigger input event to update any listeners
        const newCursorPos = getCursorPosition();
        onInput?.(getText(), newCursorPos);
      },
      [getContent, getCursorPosition, getText, onInput]
    );

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      focus,
      clear,
      insertFilePill,
      getContent,
      getText,
    }));

    // Handle input events
    const handleInput = useCallback(() => {
      if (isComposingRef.current) return;

      const text = getText();
      const cursorPos = getCursorPosition();
      onInput?.(text, cursorPos);
    }, [getText, getCursorPosition, onInput]);

    // Handle composition (IME input)
    const handleCompositionStart = useCallback(() => {
      isComposingRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
      isComposingRef.current = false;
      handleInput();
    }, [handleInput]);

    // Handle paste - strip formatting
    const handlePasteInternal = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();

        // Get plain text
        const text = e.clipboardData.getData('text/plain');

        // Insert at cursor
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
        }

        handleInput();
        onPaste?.(e);
      },
      [handleInput, onPaste]
    );

    // Handle keydown
    const handleKeyDownInternal = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Handle backspace into pills
        if (e.key === 'Backspace') {
          const selection = window.getSelection();
          if (selection && selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.startContainer;

            // Check if we're at the start of a text node after a pill
            if (
              container.nodeType === Node.TEXT_NODE &&
              range.startOffset === 0
            ) {
              const prev = container.previousSibling;
              if (prev instanceof HTMLElement && prev.dataset.mentionPath) {
                e.preventDefault();
                prev.remove();
                handleInput();
                return;
              }
            }
          }
        }

        onKeyDown?.(e);
      },
      [handleInput, onKeyDown]
    );

    // Show/hide placeholder
    const isEmpty = getText() === '';

    return (
      <div className="relative">
        {/* Placeholder */}
        {isEmpty && placeholder && !disabled && (
          <div className="absolute top-0 left-0 pointer-events-none text-muted-foreground/60">
            {placeholder}
          </div>
        )}

        {/* Contenteditable */}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className={cn(
            'outline-none min-h-[100px] max-h-[200px] overflow-y-auto',
            'whitespace-pre-wrap break-words',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
          onInput={handleInput}
          onKeyDown={handleKeyDownInternal}
          onFocus={onFocus}
          onBlur={onBlur}
          onPaste={handlePasteInternal}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
        />
      </div>
    );
  }
);
```

**Step 2: Commit**

```bash
git add src/components/conversation/RichTextInput.tsx
git commit -m "feat: add RichTextInput contenteditable component with pill support"
```

---

## Task 4: Update API to Support mentionedFiles

**Files:**
- Modify: `src/lib/api.ts`

**Step 1: Update sendConversationMessage signature**

Find the `sendConversationMessage` function (around line 1004) and update it:

```typescript
export async function sendConversationMessage(
  convId: string,
  content: string,
  attachments?: AttachmentDTO[],
  model?: string,
  mentionedFiles?: string[]
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, attachments, model, mentionedFiles }),
  });
  await handleVoidResponse(res, 'Failed to send message');
}
```

**Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add mentionedFiles param to sendConversationMessage API"
```

---

## Task 5: Integrate into ChatInput

**Files:**
- Modify: `src/components/conversation/ChatInput.tsx`

**Step 1: Add imports**

At the top of the file, add:

```typescript
import { RichTextInput, type RichTextInputHandle } from './RichTextInput';
import { FileMentionMenu } from './FileMentionMenu';
import { useFileMentions, type FlatFile } from '@/hooks/useFileMentions';
```

**Step 2: Add ref and hook setup**

Inside `ChatInput` function, after other refs (around line 600), add:

```typescript
const richInputRef = useRef<RichTextInputHandle>(null);

const handleFileSelect = useCallback((file: FlatFile, triggerPos: number) => {
  richInputRef.current?.insertFilePill(file, triggerPos);
}, []);

const fileMentions = useFileMentions({
  workspaceId: selectedWorkspaceId,
  sessionId: selectedSessionId,
  onSelectFile: handleFileSelect,
});
```

**Step 3: Update message state handling**

Replace the `message` state and related logic. Instead of `const [message, setMessage] = useState('')`, the RichTextInput manages its own content. Update the send logic to extract from the ref:

In the send handler, change:

```typescript
// Old:
const content = message.trim();

// New:
const { text: content, mentionedFiles } = richInputRef.current?.getContent() ?? { text: '', mentionedFiles: [] };
```

And pass `mentionedFiles` to the API call:

```typescript
await sendConversationMessage(
  selectedConversationId,
  content,
  loadedAttachments.length > 0 ? loadedAttachments : undefined,
  modelChanged ? selectedModel.id : undefined,
  mentionedFiles.length > 0 ? mentionedFiles : undefined
);
```

After successful send, clear the input:

```typescript
richInputRef.current?.clear();
```

**Step 4: Replace Textarea with RichTextInput**

Find the `<Textarea>` component (around line 1352) and replace the entire block with:

```typescript
<RichTextInput
  ref={richInputRef}
  placeholder={isStreaming ? "Agent is working..." : "Describe your task, @ to reference files, / for skills and commands"}
  disabled={!selectedSessionId || isSending || isStreaming}
  className={cn(
    'bg-transparent dark:bg-transparent',
    'relative z-10'
  )}
  onInput={(text, cursorPos) => {
    fileMentions.handleTextChange(text, cursorPos);
    slashMenu.handleInputChange(text, cursorPos);
  }}
  onKeyDown={(e) => {
    // File mentions take priority
    if (fileMentions.handleKeyDown(e)) return;
    // Then slash commands
    if (slashMenu.handleKeyDown(e)) return;
    // Then normal handling
    handleKeyDown(e as unknown as KeyboardEvent<HTMLTextAreaElement>);
  }}
  onFocus={() => setIsFocused(true)}
  onBlur={() => setIsFocused(false)}
/>
```

**Step 5: Add FileMentionMenu**

After the `SlashCommandMenu` component, add:

```typescript
<FileMentionMenu
  isOpen={fileMentions.isOpen}
  files={fileMentions.files}
  selectedIndex={fileMentions.selectedIndex}
  query={fileMentions.query}
  isLoading={fileMentions.isLoading}
  onSelect={fileMentions.selectFile}
  onHover={fileMentions.setSelectedIndex}
  onDismiss={fileMentions.dismiss}
/>
```

**Step 6: Update focus shortcut**

Find the Cmd+L focus handler and update it to use the new ref:

```typescript
// Old:
textareaRef.current?.focus();

// New:
richInputRef.current?.focus();
```

**Step 7: Remove old ghost text overlay (simplify)**

The ghost text suggestion logic was tied to the textarea. For now, remove the ghost text overlay div and related state (`suggestion`, `ghostTextRef`). This can be re-added later with contenteditable support.

**Step 8: Commit**

```bash
git add src/components/conversation/ChatInput.tsx
git commit -m "feat: integrate RichTextInput and file mentions into ChatInput"
```

---

## Task 6: Test and Fix Issues

**Step 1: Run the app**

```bash
make dev
```

**Step 2: Test the flow**

1. Open a session
2. Type `@` - verify popover appears
3. Type to filter files
4. Select a file with Enter/Tab/click
5. Verify pill appears inline
6. Continue typing message
7. Send message
8. Verify message sends with mentionedFiles in payload

**Step 3: Fix any issues found**

Common issues to check:
- Cursor positioning after pill insert
- Backspace to delete pills
- Multiple pills in one message
- Slash commands still work
- Keyboard navigation in popover

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: address integration issues with file mentions"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | useFileMentions hook | `src/hooks/useFileMentions.ts` |
| 2 | FileMentionMenu component | `src/components/conversation/FileMentionMenu.tsx` |
| 3 | RichTextInput component | `src/components/conversation/RichTextInput.tsx` |
| 4 | API update | `src/lib/api.ts` |
| 5 | ChatInput integration | `src/components/conversation/ChatInput.tsx` |
| 6 | Testing & fixes | Various |
