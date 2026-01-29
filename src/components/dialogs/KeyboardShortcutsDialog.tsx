'use client';

import { useState, useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  SHORTCUTS,
  getShortcutsByCategory,
  formatShortcutKeys,
  type ShortcutCategory,
} from '@/lib/shortcuts';
import { cn } from '@/lib/utils';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Category display order
const CATEGORY_ORDER: ShortcutCategory[] = [
  'General',
  'Navigation',
  'Tabs',
  'Chat',
  'Editor',
  'Terminal',
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  const [search, setSearch] = useState('');

  const shortcutsByCategory = useMemo(() => getShortcutsByCategory(), []);

  // Filter shortcuts based on search
  const filteredByCategory = useMemo(() => {
    if (!search.trim()) {
      return shortcutsByCategory;
    }

    const searchLower = search.toLowerCase();
    const filtered: Record<ShortcutCategory, typeof SHORTCUTS> = {
      General: [],
      Navigation: [],
      Tabs: [],
      Chat: [],
      Editor: [],
      Terminal: [],
    };

    for (const shortcut of SHORTCUTS) {
      const matchesLabel = shortcut.label.toLowerCase().includes(searchLower);
      const matchesCategory = shortcut.category.toLowerCase().includes(searchLower);
      const matchesKey = shortcut.key.toLowerCase().includes(searchLower);

      if (matchesLabel || matchesCategory || matchesKey) {
        filtered[shortcut.category].push(shortcut);
      }
    }

    return filtered;
  }, [search, shortcutsByCategory]);

  // Check if there are any results
  const hasResults = CATEGORY_ORDER.some(
    (category) => filteredByCategory[category].length > 0
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard Shortcuts"
      description="View all available keyboard shortcuts"
    >
      <CommandInput
        placeholder="Search shortcuts..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[400px]">
        {!hasResults && <CommandEmpty>No shortcuts found.</CommandEmpty>}

        {CATEGORY_ORDER.map((category) => {
          const shortcuts = filteredByCategory[category];
          if (shortcuts.length === 0) return null;

          return (
            <CommandGroup key={category} heading={category}>
              {shortcuts.map((shortcut) => (
                <CommandItem
                  key={shortcut.id}
                  value={`${shortcut.label} ${shortcut.category}`}
                  className="flex items-center justify-between cursor-default pointer-events-none"
                >
                  <span className="flex-1 text-sm">
                    {shortcut.label}
                    {shortcut.when && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        ({shortcut.when})
                      </span>
                    )}
                  </span>
                  <KeyCombo keys={formatShortcutKeys(shortcut)} />
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Renders a keyboard shortcut key combination with styled kbd elements.
 */
function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, index) => (
        <kbd
          key={index}
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded',
            'bg-muted px-1.5 font-mono text-xs font-medium',
            'text-muted-foreground'
          )}
        >
          {key}
        </kbd>
      ))}
    </div>
  );
}
