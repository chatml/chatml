'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const keyboardReady = useRef(false);

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

  // Delay keyboard activation to prevent stale keypresses from OAuth browser
  useEffect(() => {
    const timer = setTimeout(() => {
      keyboardReady.current = true;
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!keyboardReady.current) return;

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
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background overflow-hidden">
      {/* Draggable region for window management */}
      <div data-tauri-drag-region className="absolute top-0 left-0 right-0 h-11 z-50" />

      {/* Skip button */}
      <button
        onClick={onSkip}
        className="absolute top-14 right-6 text-sm text-muted-foreground/70 hover:text-foreground transition-colors z-40"
      >
        Skip Onboarding
      </button>

      {/* Step content — full-size opaque layer prevents GPU cache artifacts from previous step */}
      <div className="absolute inset-0 flex items-center justify-center bg-background z-10" key={currentStep}>
        <div className="w-full max-w-lg px-8 animate-fade-in">
          <StepComponent />
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="absolute bottom-12 left-0 right-0 flex flex-col items-center gap-6 z-10">
        {/* Action button */}
        <Button
          size="lg"
          onClick={handleNext}
          className="h-12 px-8 text-lg bg-foreground text-background hover:bg-foreground/90 font-medium rounded-xl transition-colors"
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
                  : 'bg-foreground/20 hover:bg-foreground/40'
              )}
              aria-label={`Go to step ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
