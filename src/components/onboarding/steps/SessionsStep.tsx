'use client';

import { GitBranch } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';

export function SessionsStep() {
  return (
    <OnboardingWizardStep
      icon={<GitBranch className="w-8 h-8 text-primary" />}
      title="Sessions"
    >
      <p>
        This is the killer feature. Each session creates an <strong className="text-white">isolated git worktree</strong> on its own branch.
      </p>
      <p>
        Multiple agents can work simultaneously on different tasks without conflicts. Each session is safe to experiment in.
      </p>
      {/* Visual indicator */}
      <div className="mt-4 flex items-center justify-center gap-3">
        {['Agent A', 'Agent B', 'Agent C'].map((name) => (
          <div
            key={name}
            className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10"
          >
            <GitBranch className="w-4 h-4 text-primary/70" />
            <span className="text-xs text-white/70">{name}</span>
          </div>
        ))}
      </div>
    </OnboardingWizardStep>
  );
}
