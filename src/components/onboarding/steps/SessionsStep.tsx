'use client';

import { GitBranch } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';

export function SessionsStep() {
  return (
    <OnboardingWizardStep
      icon={<GitBranch className="w-8 h-8 text-brand" />}
      title="Sessions"
    >
      <p>
        Each session creates an <strong className="text-foreground">isolated git worktree</strong> on its own branch. Multiple agents work in parallel without conflicts.
      </p>
      {/* Visual indicator */}
      <div className="mt-4 flex items-center justify-center gap-3">
        {['Agent A', 'Agent B', 'Agent C'].map((name) => (
          <div
            key={name}
            className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg bg-muted/50 border border-border"
          >
            <GitBranch className="w-4 h-4 text-brand/70" />
            <span className="text-xs text-muted-foreground">{name}</span>
          </div>
        ))}
      </div>
    </OnboardingWizardStep>
  );
}
