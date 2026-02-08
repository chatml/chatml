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
            className="flex flex-col items-center gap-2 px-4 py-3 rounded-lg bg-white/5 border border-white/10"
          >
            <kbd className="text-base font-mono font-semibold text-white/90 bg-white/10 px-2.5 py-1 rounded-md">
              {shortcut.keys}
            </kbd>
            <span className="text-xs text-white/50">{shortcut.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-white/40">
        Press <kbd className="px-1 py-0.5 rounded bg-white/10 text-xs font-mono">{'\u2318+/'}</kbd> anytime for all shortcuts.
      </p>
    </OnboardingWizardStep>
  );
}
