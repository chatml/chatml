'use client';

import { SHORTCUTS, formatShortcutKeys } from '@/lib/shortcuts';

const LAUNCHER_SHORTCUT_IDS = [
  'commandPalette',
  'newSession',
  'focusChat',
  'createFromPR',
  'filePicker',
  'shortcutsDialog',
];

interface ShortcutsGridProps {
  onOpenShortcuts?: () => void;
}

export function ShortcutsGrid({ onOpenShortcuts }: ShortcutsGridProps) {
  const shortcuts = LAUNCHER_SHORTCUT_IDS
    .map((id) => SHORTCUTS.find((s) => s.id === id))
    .filter(Boolean);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Keyboard Shortcuts
        </h2>
        {onOpenShortcuts && (
          <button
            onClick={onOpenShortcuts}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {shortcuts.map((shortcut) => (
          <div key={shortcut!.id} className="flex items-center gap-3">
            <kbd className="inline-flex items-center justify-center min-w-[2rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-xs">
              {formatShortcutKeys(shortcut!).join('')}
            </kbd>
            <span className="text-xs text-muted-foreground">
              {shortcut!.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
