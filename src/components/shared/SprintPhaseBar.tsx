'use client';

import { useState, useCallback } from 'react';
import { SPRINT_PHASE_OPTIONS } from '@/lib/session-fields';
import type { SprintPhase } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ONBOARDING_KEY = 'chatml:sprint-onboarded';

interface SprintPhaseBarProps {
  phase: SprintPhase | null | undefined;
  onChange: (phase: SprintPhase | null) => void;
  disabled?: boolean;
  /** Called when Sprint button is clicked while inactive — opens the sprint toolbar */
  onOpenToolbar?: () => void;
}

export function SprintPhaseBar({ phase, onChange, disabled, onOpenToolbar }: SprintPhaseBarProps) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  const handleStartClick = useCallback(() => {
    const onboarded = localStorage.getItem(ONBOARDING_KEY);
    if (!onboarded) {
      setShowOnboarding(true);
      return;
    }
    if (onOpenToolbar) onOpenToolbar();
    else onChange('think');
  }, [onOpenToolbar, onChange]);

  const handleConfirmStart = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setShowOnboarding(false);
    if (onOpenToolbar) onOpenToolbar();
    else onChange('think');
  }, [onOpenToolbar, onChange]);

  // No sprint active — show compact start button with optional onboarding popover
  if (!phase) {
    return (
      <Popover open={showOnboarding} onOpenChange={setShowOnboarding}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleStartClick}
                disabled={disabled}
              >
                <Play className="h-3 w-3" />
                Sprint
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Start a sprint workflow (Think → Plan → Build → Review → Test → Ship → Reflect)</TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" align="start" className="w-72 p-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Sprint Workflow</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              A sprint guides you through 7 phases:
            </p>
            <div className="flex flex-wrap gap-1">
              {SPRINT_PHASE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <span key={opt.value} className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium rounded px-1.5 py-0.5', opt.activeClass)}>
                    <Icon className="h-2.5 w-2.5" />
                    {opt.label}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each phase auto-configures your environment (plan mode, thinking level) and the primary action button adapts to what you need next.
            </p>
            <Button size="sm" className="w-full h-7 text-xs" onClick={handleConfirmStart}>
              Start Sprint
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Sprint active — show compact pill indicator (full bar is in SprintPhaseToolbar below)
  const activeOpt = SPRINT_PHASE_OPTIONS.find((o) => o.value === phase);
  if (!activeOpt) return null;
  const Icon = activeOpt.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 h-6 px-2 rounded-sm text-xs font-medium transition-colors',
            activeOpt.activeClass,
            disabled && 'pointer-events-none opacity-50',
          )}
          onClick={() => onOpenToolbar ? onOpenToolbar() : onChange(null)}
          disabled={disabled}
          aria-label={`Sprint: ${activeOpt.label} — click to open sprint toolbar`}
        >
          <Icon className={cn('h-3 w-3', activeOpt.color)} />
          {activeOpt.label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Sprint: {activeOpt.label} — click to manage sprint</TooltipContent>
    </Tooltip>
  );
}
