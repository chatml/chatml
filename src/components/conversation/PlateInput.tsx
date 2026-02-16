'use client';

import * as React from 'react';
import { forwardRef, useImperativeHandle, useCallback } from 'react';

import type { Value } from 'platejs';

import { MentionPlugin, MentionInputPlugin } from '@platejs/mention/react';
import { SlashPlugin, SlashInputPlugin } from '@platejs/slash-command/react';
import { Plate, usePlateEditor } from 'platejs/react';

import { cn } from '@/lib/utils';
import { Editor, EditorContainer } from '@/components/ui/editor';
import {
  MentionElement,
  MentionInputElement,
  MentionItemsContext,
  type MentionItem,
} from '@/components/ui/mention-node';
import {
  SlashCommandInputElement,
  SlashCommandItemsContext,
} from '@/components/ui/slash-command-node';
import type { UnifiedSlashCommand } from '@/stores/slashCommandStore';

export interface PlateInputHandle {
  focus: () => void;
  clear: () => void;
  getText: () => string;
  getContent: () => { text: string; mentionedFiles: string[] };
  setText: (text: string) => void;
}

interface PlateInputProps {
  placeholder?: string;
  className?: string;
  mentionItems?: MentionItem[];
  mentionItemsLoading?: boolean;
  slashCommands?: UnifiedSlashCommand[];
  onSlashCommandExecute?: (command: UnifiedSlashCommand) => void;
  onInput?: (text: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

// Helper to extract text from Plate value
function extractText(value: Value): string {
  let text = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate nodes have dynamic structure
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Plate nodes have dynamic structure
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
      className,
      mentionItems = [],
      mentionItemsLoading = false,
      slashCommands = [],
      onSlashCommandExecute,
      onInput,
      onKeyDown,
      onPaste,
      onFocus,
      onBlur,
    },
    ref
  ) {
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
        SlashPlugin.configure({
          options: {
            trigger: '/',
            triggerPreviousCharPattern: /^$/,
          },
        }),
        SlashInputPlugin.withComponent(SlashCommandInputElement),
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
        editor.tf.focus({ edge: 'end' });
      },
      clear: () => {
        editor.tf.reset();
        editor.tf.focus();
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
      setText: (text: string) => {
        editor.tf.reset();
        // Defer until React reconciles the DOM after reset
        setTimeout(() => {
          editor.tf.focus();
          editor.tf.insertText(text);
        }, 0);
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

    const slashCommandContextValue = React.useMemo(
      () => ({
        commands: slashCommands,
        onExecute: onSlashCommandExecute ?? (() => {}),
      }),
      [slashCommands, onSlashCommandExecute]
    );

    return (
      <SlashCommandItemsContext.Provider value={slashCommandContextValue}>
        <MentionItemsContext.Provider value={mentionContextValue}>
          <Plate editor={editor} onChange={handleChange}>
            <div onKeyDown={handleKeyDown} onPasteCapture={onPaste}>
              <EditorContainer variant="default" className="p-0 rounded-none">
                <Editor
                  variant="none"
                  placeholder={placeholder}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    'min-h-[100px] max-h-[200px] py-1 text-base rounded-none',
                    'caret-foreground [&_[data-slate-editor]]:min-h-[1lh]',
                    className
                  )}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </EditorContainer>
            </div>
          </Plate>
        </MentionItemsContext.Provider>
      </SlashCommandItemsContext.Provider>
    );
  }
);
