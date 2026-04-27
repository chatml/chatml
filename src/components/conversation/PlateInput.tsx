'use client';

import * as React from 'react';
import { forwardRef, useImperativeHandle, useCallback } from 'react';

import type { Value } from 'platejs';

import { MentionPlugin, MentionInputPlugin } from '@platejs/mention/react';
import { SlashPlugin, SlashInputPlugin } from '@platejs/slash-command/react';
import { Plate, usePlateEditor } from 'platejs/react';

import { cn } from '@/lib/utils';
import { extractContent } from '@/lib/plate-content';
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

const emptyValue: Value = [{ type: 'p', children: [{ text: '' }] }];

const MENTION_TRIGGER_PATTERN = /^$|^[\s"']$/;
const SLASH_TRIGGER_PATTERN = /^$/;

const PLATE_PLUGINS = [
  MentionPlugin.configure({
    options: {
      trigger: '@',
      triggerPreviousCharPattern: MENTION_TRIGGER_PATTERN,
      insertSpaceAfterMention: true,
    },
  }).withComponent(MentionElement),
  MentionInputPlugin.withComponent(MentionInputElement),
  SlashPlugin.configure({
    options: {
      trigger: '/',
      triggerPreviousCharPattern: SLASH_TRIGGER_PATTERN,
    },
  }),
  SlashInputPlugin.withComponent(SlashCommandInputElement),
];

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
      plugins: PLATE_PLUGINS,
      value: emptyValue,
    });

    // Track changes and notify parent
    const handleChange = useCallback(
      ({ value }: { value: Value }) => {
        const { text } = extractContent(value);
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
        queueMicrotask(() => {
          try {
            editor.tf.focus();
          } catch { /* editor may be unmounted */ }
        });
      },
      getText: () => {
        return extractContent(editor.children).text;
      },
      getContent: () => {
        return extractContent(editor.children);
      },
      setText: (text: string) => {
        // Replace editor content synchronously to avoid the async gap between
        // reset() and insertText() that caused dictation text loss.
        editor.tf.setValue([{ type: 'p', children: [{ text }] }]);
        queueMicrotask(() => {
          try {
            editor.tf.focus({ edge: 'end' });
          } catch { /* editor may be unmounted */ }
        });
      },
    }));

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
            {/* onPasteCapture runs in the capture phase, before Plate's
                internal paste handler, so image interception via
                preventDefault() works reliably. */}
            <EditorContainer variant="default" className="p-0 rounded-none" onPasteCapture={onPaste}>
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
                onKeyDown={onKeyDown}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </EditorContainer>
          </Plate>
        </MentionItemsContext.Provider>
      </SlashCommandItemsContext.Provider>
    );
  }
);
