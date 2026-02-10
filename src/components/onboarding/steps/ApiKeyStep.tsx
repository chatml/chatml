'use client';

import { KeyRound, ExternalLink } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';

export function ApiKeyStep() {
  return (
    <OnboardingWizardStep
      icon={<KeyRound className="w-8 h-8 text-primary" />}
      title="Connect your API key"
    >
      <p>
        To run AI agents, ChatML needs an <strong className="text-white">Anthropic API key</strong>. You can create one from the Anthropic Console.
      </p>
      <a
        href="https://console.anthropic.com/settings/keys"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
      >
        Get an API key
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </OnboardingWizardStep>
  );
}
