'use client';

import { useCallback } from 'react';
import { SPRINT_PHASE_OPTIONS } from '@/lib/session-fields';
import { SPRINT_PHASES } from '@/lib/types';
import type { SprintPhase } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SprintPhaseBarProps {
  phase: SprintPhase | null | undefined;
  onChange: (phase: SprintPhase | null) => void;
  disabled?: boolean;
}

export function SprintPhaseBar({ phase, onChange, disabled }: SprintPhaseBarProps) {
  const currentIndex = phase ? SPRINT_PHASES.indexOf(phase) : -1;

  const handlePhaseClick = useCallback((clickedPhase: SprintPhase) => {
    if (disabled) return;
    // Clicking the active phase deactivates sprint
    if (clickedPhase === phase) {
      onChange(null);
    } else {
      onChange(clickedPhase);
    }
  }, [phase, onChange, disabled]);

  // No sprint active — show compact start button
  if (!phase) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange('think')}
            disabled={disabled}
          >
            <Play className="h-3 w-3" />
            Sprint
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Start a sprint workflow (Think → Plan → Build → Review → Test → Ship → Reflect)</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {SPRINT_PHASE_OPTIONS.map((opt, idx) => {
        const isActive = opt.value === phase;
        const isCompleted = idx < currentIndex;
        const Icon = opt.icon;

        return (
          <Tooltip key={opt.value}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-1 h-6 px-1.5 rounded-sm text-xs font-medium transition-colors',
                  isActive && opt.activeClass,
                  isCompleted && 'text-muted-foreground/60',
                  !isActive && !isCompleted && 'text-muted-foreground/40 hover:text-muted-foreground/70',
                  disabled && 'pointer-events-none opacity-50',
                )}
                onClick={() => handlePhaseClick(opt.value)}
                disabled={disabled}
                aria-label={opt.label}
                aria-pressed={isActive}
              >
                <Icon className={cn('h-3 w-3', isActive && opt.color)} />
                <span className={cn(
                  'hidden @[500px]:inline',
                  isActive && 'inline', // Always show label for active phase
                )}>
                  {opt.label}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{opt.description}</TooltipContent>
          </Tooltip>
        );
      })}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center h-6 px-1 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Exit sprint"
          >
            <X className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Exit sprint</TooltipContent>
      </Tooltip>
    </div>
  );
}
