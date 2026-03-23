'use client';

import { SPRINT_PHASE_OPTIONS } from '@/lib/session-fields';
import type { SprintPhase } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SprintPhaseBarProps {
  phase: SprintPhase | null | undefined;
  onChange: (phase: SprintPhase | null) => void;
  disabled?: boolean;
  /** Called when Sprint button is clicked while inactive — opens the sprint toolbar */
  onOpenToolbar?: () => void;
}

export function SprintPhaseBar({ phase, onChange, disabled, onOpenToolbar }: SprintPhaseBarProps) {
  // No sprint active — show compact start button
  if (!phase) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onOpenToolbar ? onOpenToolbar() : onChange('think')}
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
