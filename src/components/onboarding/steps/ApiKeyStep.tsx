'use client';

import { KeyRound, ExternalLink, CheckCircle2, Shield } from 'lucide-react';
import { OnboardingWizardStep } from '../OnboardingWizardStep';
import type { ClaudeAuthStatus } from '@/hooks/useClaudeAuthStatus';

interface ApiKeyStepProps {
  authStatus: ClaudeAuthStatus | null;
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'claude_subscription':
      return 'Claude subscription credentials found';
    case 'api_key':
      return 'API key configured in settings';
    case 'env_var':
      return 'API key found in environment';
    default:
      return 'Credentials configured';
  }
}

export function ApiKeyStep({ authStatus }: ApiKeyStepProps) {
  const configured = authStatus?.configured ?? false;

  if (configured) {
    return (
      <OnboardingWizardStep
        icon={<Shield className="w-8 h-8 text-emerald-400" />}
        title="Credentials detected"
      >
        <div className="flex items-center gap-2 justify-center text-emerald-400/90 mb-2">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">
            {getSourceLabel(authStatus?.credentialSource ?? '')}
          </span>
        </div>
        <p className="text-sm text-muted-foreground/70">
          You&apos;re all set to run AI agents. You can change your credentials anytime in Settings.
        </p>
      </OnboardingWizardStep>
    );
  }

  return (
    <OnboardingWizardStep
      icon={<KeyRound className="w-8 h-8 text-primary" />}
      title="Connect credentials"
    >
      <p>
        To run AI agents, ChatML needs either a{' '}
        <strong className="text-white">Claude subscription</strong> or an{' '}
        <strong className="text-white">Anthropic API key</strong>.
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
