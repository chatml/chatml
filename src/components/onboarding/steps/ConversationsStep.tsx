'use client';

import { MessageSquare, Bot } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';

export function ConversationsStep() {
  return (
    <OnboardingWizardStep
      icon={
        <div className="flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          <Bot className="w-6 h-6 text-primary" />
        </div>
      }
      title="Conversations & Agents"
    >
      <p>
        Agents can read files, write code, run commands, and create pull requests. Review changes in the right panel before merging.
      </p>
      <p>
        Each session can have multiple conversation threads for different subtasks.
      </p>
    </OnboardingWizardStep>
  );
}
