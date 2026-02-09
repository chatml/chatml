'use client';

import * as React from 'react';

import type { TComboboxInputElement, TMentionElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';

import { getMentionOnSelectItem } from '@platejs/mention';
import { IS_APPLE, KEYS } from 'platejs';
import {
  PlateElement,
  useFocused,
  useReadOnly,
  useSelected,
} from 'platejs/react';
import { cn } from '@/lib/utils';
import { FileIcon } from '@/components/files/FileTree';
import { useMounted } from '@/hooks/use-mounted';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

// Context for providing dynamic mention items
export interface MentionItem {
  key: string;
  text: string;
  data?: unknown;
}

interface MentionItemsContextValue {
  items: MentionItem[];
  isLoading?: boolean;
}

export const MentionItemsContext = React.createContext<MentionItemsContextValue>({
  items: [],
  isLoading: false,
});

export function MentionElement(
  props: PlateElementProps<TMentionElement> & {
    prefix?: string;
  }
) {
  const element = props.element;

  const selected = useSelected();
  const focused = useFocused();
  const mounted = useMounted();
  const readOnly = useReadOnly();

  // Extract filename from path for icon
  const filename = String(element.value).split('/').pop() || String(element.value);

  return (
    <PlateElement
      {...props}
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-muted mx-0.5 px-1.5 -my-px align-middle leading-none font-medium text-sm',
        !readOnly && 'cursor-pointer',
        selected && focused && 'ring-2 ring-ring',
        element.children[0][KEYS.bold] === true && 'font-bold',
        element.children[0][KEYS.italic] === true && 'italic',
        element.children[0][KEYS.underline] === true && 'underline'
      )}
      attributes={{
        ...props.attributes,
        contentEditable: false,
        'data-slate-value': element.value,
        draggable: true,
      }}
    >
      {mounted && IS_APPLE ? (
        // Mac OS IME https://github.com/ianstormtaylor/slate/issues/3490
        <>
          {props.children}
          {props.prefix}
          <FileIcon filename={filename} className="h-3.5 w-3.5" />
          <span>{filename}</span>
        </>
      ) : (
        // Others like Android https://github.com/ianstormtaylor/slate/pull/5360
        <>
          {props.prefix}
          <FileIcon filename={filename} className="h-3.5 w-3.5" />
          <span>{filename}</span>
          {props.children}
        </>
      )}
    </PlateElement>
  );
}

const onSelectItem = getMentionOnSelectItem();

export function MentionInputElement(
  props: PlateElementProps<TComboboxInputElement>
) {
  const { editor, element } = props;
  const [search, setSearch] = React.useState('');
  const { items, isLoading } = React.useContext(MentionItemsContext);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        value={search}
        element={element}
        setValue={setSearch}
        showTrigger={true}
        trigger="@"
      >
        <InlineComboboxInput />

        <InlineComboboxContent className="my-1.5">
          <InlineComboboxEmpty>
            {isLoading ? 'Loading...' : 'No files found'}
          </InlineComboboxEmpty>

          <InlineComboboxGroup>
            {items.map((item) => (
              <InlineComboboxItem
                key={item.key}
                value={item.text}
                onClick={() => onSelectItem(editor, item, search)}
                className="gap-2"
              >
                <FileIcon filename={item.text} />
                <span className="truncate">
                  {item.text}
                  {(item.data as { directory?: string } | undefined)?.directory ? (
                    <span className="ml-1.5 text-muted-foreground font-normal">
                      {(item.data as { directory: string }).directory}
                    </span>
                  ) : null}
                </span>
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>

      {props.children}
    </PlateElement>
  );
}
