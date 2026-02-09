'use client';

import { FolderGit2 } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';

export function WorkspacesStep() {
  return (
    <OnboardingWizardStep
      icon={<FolderGit2 className="w-8 h-8 text-primary" />}
      title="Workspaces"
    >
      <p>
        Workspaces are your git repositories. Add a project and it appears in the sidebar, ready for agents.
      </p>
    </OnboardingWizardStep>
  );
}
