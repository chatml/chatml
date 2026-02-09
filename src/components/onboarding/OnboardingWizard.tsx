'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { WelcomeStep } from './steps/WelcomeStep';
import { WorkspacesStep } from './steps/WorkspacesStep';
import { SessionsStep } from './steps/SessionsStep';
import { ConversationsStep } from './steps/ConversationsStep';
import { ShortcutsStep } from './steps/ShortcutsStep';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

const STEPS = [WelcomeStep, WorkspacesStep, SessionsStep, ConversationsStep, ShortcutsStep];
const TOTAL_STEPS = STEPS.length;

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const isLastStep = currentStep === TOTAL_STEPS - 1;

  const handleNext = useCallback(() => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [isLastStep, onComplete]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrev, onSkip]);

  const StepComponent = STEPS[currentStep];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#090909] overflow-hidden">
      {/* Draggable region for window management */}
      <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-11 z-50" />

      {/* Subtle ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] w-[500px] h-[500px] rounded-full bg-purple-900/15 blur-[150px] pointer-events-none" />

      {/* Skip button */}
      <button
        onClick={onSkip}
        className="absolute top-14 right-6 text-sm text-white/40 hover:text-white/70 transition-colors z-40"
      >
        Skip Onboarding
      </button>

      {/* Step content */}
      <div className="relative z-10 w-full max-w-lg px-8" key={currentStep}>
        <StepComponent />
      </div>

      {/* Bottom navigation */}
      <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-6 z-10">
        {/* Action button */}
        <Button
          size="lg"
          onClick={handleNext}
          className="h-12 px-8 text-lg bg-white text-[#090909] hover:bg-white/90 font-medium rounded-xl transition-colors"
        >
          {currentStep === 0 ? 'Get Started' : isLastStep ? 'Start Using ChatML' : 'Next'}
        </Button>

        {/* Dot indicators */}
        <div className="flex items-center gap-2">
          {STEPS.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-200',
                index === currentStep
                  ? 'bg-primary w-6'
                  : 'bg-white/20 hover:bg-white/40'
              )}
              aria-label={`Go to step ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
