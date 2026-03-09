'use client';

import { MessageSquare, Bot } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';

export function ConversationsStep() {
  return (
    <OnboardingWizardStep
      icon={
        <div className="flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-brand" />
          <Bot className="w-6 h-6 text-brand" />
        </div>
      }
      title="Conversations & Agents"
    >
      <p>
        Agents write code, run commands, and open pull requests. Review their changes before merging.
      </p>
      <p>
        Each session supports multiple conversation threads for different subtasks.
      </p>
    </OnboardingWizardStep>
  );
}
