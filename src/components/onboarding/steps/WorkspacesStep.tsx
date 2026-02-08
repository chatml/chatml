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
        Workspaces are your git repositories. Each project you add becomes a workspace in the sidebar.
      </p>
      <p>
        You can work across multiple repos simultaneously, each with its own set of sessions and agents.
      </p>
    </OnboardingWizardStep>
  );
}
