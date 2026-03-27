'use client';

import * as React from 'react';

import type { TComboboxInputElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';

import { PlateElement } from 'platejs/react';
import type { UnifiedSlashCommand } from '@/stores/slashCommandStore';
import { filterSlashCommands } from '@/lib/slashCommands';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

// Context for providing slash command items and execution callback
export interface SlashCommandItemsContextValue {
  commands: UnifiedSlashCommand[];
  onExecute: (command: UnifiedSlashCommand) => void;
}

export const SlashCommandItemsContext =
  React.createContext<SlashCommandItemsContextValue>({
    commands: [],
    onExecute: () => {},
  });

export function SlashCommandInputElement(
  props: PlateElementProps<TComboboxInputElement>
) {
  const { element } = props;
  const [search, setSearch] = React.useState('');
  const { commands, onExecute } = React.useContext(SlashCommandItemsContext);

  const filteredCommands = React.useMemo(
    () => filterSlashCommands(commands, search),
    [commands, search]
  );

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        value={search}
        element={element}
        setValue={setSearch}
        showTrigger={true}
        trigger="/"
        filter={false}
      >
        <InlineComboboxInput />

        <InlineComboboxContent className="my-1.5 w-[440px]">
          <InlineComboboxEmpty>No commands found</InlineComboboxEmpty>

          <InlineComboboxGroup>
            {filteredCommands.map((cmd) => {
              const Icon = cmd.icon;
              return (
                <InlineComboboxItem
                  key={cmd.id}
                  value={cmd.trigger}
                  // Defer so removeInput's Slate transforms settle before
                  // onExecute mutates the editor (clear/setText).
                  onClick={() => queueMicrotask(() => onExecute(cmd))}
                  className="gap-2"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="shrink-0 font-medium">{cmd.trigger}</span>
                    <span className="text-muted-foreground text-xs truncate">
                      {cmd.description}
                    </span>
                  </div>
                  {cmd.source !== 'builtin' && (
                    <span className="text-[10px] text-muted-foreground/50 shrink-0 capitalize">
                      {cmd.source}
                    </span>
                  )}
                </InlineComboboxItem>
              );
            })}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
