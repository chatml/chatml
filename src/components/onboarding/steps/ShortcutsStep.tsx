'use client';

import { OnboardingWizardStep } from '../OnboardingWizardStep';

const shortcuts = [
  { keys: '\u2318+K', label: 'Command Palette' },
  { keys: '\u2318+N', label: 'New Session' },
  { keys: '\u2318+B', label: 'Toggle Sidebar' },
  { keys: '\u2318+.', label: 'Zen Mode' },
];

export function ShortcutsStep() {
  return (
    <OnboardingWizardStep
      icon={null}
      title="Keyboard Shortcuts"
    >
      <div className="grid grid-cols-2 gap-3 mt-2">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.keys}
            className="flex flex-col items-center gap-2 px-4 py-3 rounded-lg bg-muted/50 border border-border"
          >
            <kbd className="text-base font-mono font-semibold text-foreground bg-foreground/10 px-2.5 py-1 rounded-md">
              {shortcut.keys}
            </kbd>
            <span className="text-sm text-muted-foreground">{shortcut.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground/70">
        Press <kbd className="px-1 py-0.5 rounded bg-foreground/10 text-sm font-mono">{'\u2318+/'}</kbd> anytime for all shortcuts.
      </p>
    </OnboardingWizardStep>
  );
}
