'use client';

import type { ReactNode } from 'react';

interface OnboardingWizardStepProps {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}

export function OnboardingWizardStep({ icon, title, children }: OnboardingWizardStepProps) {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto animate-scale-in">
      {icon && (
        <div className="mb-6 min-w-16 h-16 px-4 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-lg shadow-primary/5">
          {icon}
        </div>
      )}
      <h2 className="text-2xl font-bold tracking-tight text-white mb-4">
        {title}
      </h2>
      <div className="text-sm text-white/60 leading-relaxed space-y-3">
        {children}
      </div>
    </div>
  );
}
