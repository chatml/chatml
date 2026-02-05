'use client';

import * as React from 'react';
import { forwardRef, useImperativeHandle, useCallback, useRef, useEffect } from 'react';

import type { Value } from 'platejs';

import { MentionPlugin, MentionInputPlugin } from '@platejs/mention/react';
import { Plate, usePlateEditor } from 'platejs/react';

import { cn } from '@/lib/utils';
import { Editor, EditorContainer } from '@/components/ui/editor';
import {
  MentionElement,
  MentionInputElement,
  MentionItemsContext,
  type MentionItem,
} from '@/components/ui/mention-node';

export interface PlateInputHandle {
  focus: () => void;
  clear: () => void;
  getText: () => string;
  getContent: () => { text: string; mentionedFiles: string[] };
}

interface PlateInputProps {
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  mentionItems?: MentionItem[];
  mentionItemsLoading?: boolean;
  onInput?: (text: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

// Helper to extract text from Plate value
function extractText(value: Value): string {
  let text = '';

  const processNode = (node: any) => {
    if (node.text !== undefined) {
      text += node.text;
    } else if (node.type === 'mention') {
      // Mention nodes store the value (file path)
      text += `@${node.value}`;
    } else if (node.children) {
      node.children.forEach(processNode);
    }
  };

  value.forEach((node, index) => {
    processNode(node);
    // Add newline between paragraphs (except after last one)
    if (index < value.length - 1) {
      text += '\n';
    }
  });

  return text.trim();
}

// Helper to extract mentioned files from Plate value
function extractMentionedFiles(value: Value): string[] {
  const files: string[] = [];

  const processNode = (node: any) => {
    if (node.type === 'mention' && node.value) {
      files.push(node.value);
    } else if (node.children) {
      node.children.forEach(processNode);
    }
  };

  value.forEach(processNode);

  return files;
}

const emptyValue: Value = [{ type: 'p', children: [{ text: '' }] }];

export const PlateInput = forwardRef<PlateInputHandle, PlateInputProps>(
  function PlateInput(
    {
      placeholder,
      disabled,
      className,
      mentionItems = [],
      mentionItemsLoading = false,
      onInput,
      onKeyDown,
      onFocus,
      onBlur,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);

    const editor = usePlateEditor({
      plugins: [
        MentionPlugin.configure({
          options: {
            trigger: '@',
            triggerPreviousCharPattern: /^$|^[\s"']$/,
            insertSpaceAfterMention: true,
          },
        }).withComponent(MentionElement),
        MentionInputPlugin.withComponent(MentionInputElement),
      ],
      value: emptyValue,
    });

    // Track changes and notify parent
    const handleChange = useCallback(
      ({ value }: { value: Value }) => {
        const text = extractText(value);
        onInput?.(text);
      },
      [onInput]
    );

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      focus: () => {
        // Focus the editor
        if (containerRef.current) {
          const editorEl = containerRef.current.querySelector('[data-slate-editor]') as HTMLElement;
          editorEl?.focus();
        }
      },
      clear: () => {
        editor.tf.setValue(emptyValue);
      },
      getText: () => {
        return extractText(editor.children);
      },
      getContent: () => {
        return {
          text: extractText(editor.children),
          mentionedFiles: extractMentionedFiles(editor.children),
        };
      },
    }));

    // Handle keyboard events
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        onKeyDown?.(e);
      },
      [onKeyDown]
    );

    const mentionContextValue = React.useMemo(
      () => ({
        items: mentionItems,
        isLoading: mentionItemsLoading,
      }),
      [mentionItems, mentionItemsLoading]
    );

    return (
      <MentionItemsContext.Provider value={mentionContextValue}>
        <Plate editor={editor} onChange={handleChange}>
          <div ref={containerRef} onKeyDown={handleKeyDown}>
            <EditorContainer variant="default" className="p-0">
              <Editor
                variant="none"
                placeholder={placeholder}
                disabled={disabled}
                className={cn(
                  'min-h-[100px] max-h-[200px] text-base',
                  disabled && 'opacity-50 cursor-not-allowed',
                  className
                )}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </EditorContainer>
          </div>
        </Plate>
      </MentionItemsContext.Provider>
    );
  }
);
