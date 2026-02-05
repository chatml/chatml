'use client';

import {
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

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
    const [isEmpty, setIsEmpty] = useState(true);

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

    // Get plain text
    const getText = useCallback((): string => {
      return getContent().text;
    }, [getContent]);

    // Clear the editor
    const clear = useCallback(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
        setIsEmpty(true);
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
            const offsetInNode = triggerPos - nodeStart;
            const queryEndOffset = cursorPos - nodeStart;

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

        setIsEmpty(false);
        const newCursorPos = getCursorPosition();
        onInput?.(getText(), newCursorPos);
      },
      [getCursorPosition, getText, onInput]
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
      setIsEmpty(text === '');
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

        const text = e.clipboardData.getData('text/plain');

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }

        handleInput();
        onPaste?.(e);
      },
      [handleInput, onPaste]
    );

    // Handle keydown
    const handleKeyDownInternal = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Backspace') {
          const selection = window.getSelection();
          if (selection && selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.startContainer;

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
