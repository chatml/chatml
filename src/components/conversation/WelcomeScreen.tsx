'use client';

import { useCallback } from 'react';
import { GitBranch, Bug, TestTube2, Wand2, Eye, Code2, FileText, type LucideIcon } from 'lucide-react';

const SUGGESTION_CHIPS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: Bug, label: 'Fix a bug', prompt: 'Fix a bug: ' },
  { icon: TestTube2, label: 'Write tests', prompt: 'Write tests for ' },
  { icon: Wand2, label: 'Add a feature', prompt: 'Add a feature: ' },
  { icon: Eye, label: 'Review code', prompt: 'Review the code in ' },
  { icon: Code2, label: 'Refactor', prompt: 'Refactor ' },
  { icon: FileText, label: 'Docs', prompt: 'Write documentation for ' },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Working late';
}

interface WelcomeScreenProps {
  sessionName?: string;
}

export function WelcomeScreen({ sessionName }: WelcomeScreenProps) {
  // Computed once at mount — acceptable since this screen is short-lived.
  const greeting = getGreeting();

  return (
    <div className="relative flex flex-col items-center text-center animate-fade-in stagger-children">
      {/* Atmospheric glow — scoped to this component via relative parent */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse,oklch(0.707_0.165_292/0.03),transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.707_0.165_292/0.06),transparent_70%)]" />
      </div>

      {/* Greeting */}
      <h2 className="relative font-display text-2xl sm:text-3xl leading-tight tracking-display text-foreground/90">
        {greeting}
      </h2>

      {/* Branch badge */}
      {sessionName && (
        <div className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand/8 text-brand/70 text-xs font-medium mt-2.5 animate-scale-in">
          <GitBranch className="w-3.5 h-3.5" />
          {sessionName}
        </div>
      )}
    </div>
  );
}

/** Suggestion chips row — rendered below the ChatInput by the parent layout */
export function SuggestionChips() {
  const handleChipClick = useCallback((prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('session-home-template-selected', { detail: { text: prompt } }),
    );
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 animate-fade-in">
      {SUGGESTION_CHIPS.map(({ icon: Icon, label, prompt }) => (
        <button
          key={label}
          type="button"
          onClick={() => handleChipClick(prompt)}
          className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-border/20 bg-card/20 text-muted-foreground/80 hover:text-foreground hover:bg-card/50 hover:border-border/40 hover:-translate-y-px hover:shadow-sm transition-all duration-150 cursor-pointer active:scale-[0.97]"
        >
          <Icon className="size-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
          {label}
        </button>
      ))}
    </div>
  );
}
