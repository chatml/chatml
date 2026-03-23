'use client';

import { useWorkspaceSelection, useSessionActivityState } from '@/stores/selectors';
import { dispatchAppEvent } from '@/lib/custom-events';
import { SPRINT_PHASE_OPTIONS } from '@/lib/session-fields';
import { SPRINT_PHASES } from '@/lib/types';
import type { SprintPhase } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Check, ChevronRight, X } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface SprintPhaseToolbarProps {
  onClose: () => void;
}

export function SprintPhaseToolbar({ onClose }: SprintPhaseToolbarProps) {
  const { selectedSessionId, sessions } = useWorkspaceSelection();
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);
  const isAgentWorking = useSessionActivityState(selectedSessionId ?? '') === 'working';

  const phase = selectedSession?.sprintPhase;
  const currentIndex = phase ? SPRINT_PHASES.indexOf(phase) : -1;

  // Delegate phase changes to SessionToolbarContent via the existing event bus,
  // ensuring PHASE_TO_STATUS sync happens in one place.
  const handleChange = (value: SprintPhase | null) => {
    dispatchAppEvent('sprint-phase-advance', { phase: value });
    if (!value) onClose();
  };

  if (!selectedSession) return null;

  return (
    <div className="shrink-0 border-b border-border/60 bg-background animate-in slide-in-from-top-1 fade-in duration-150">
      <div className="flex items-center h-9 px-3 gap-2">
        {/* Left: Sprint label */}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 shrink-0 select-none">
          Sprint
        </span>

        <div className="w-px h-4 bg-border/60 shrink-0" />

        {/* Center: Phase stepper */}
        <div className="flex-1 flex items-center justify-center">
          {SPRINT_PHASE_OPTIONS.map((opt, idx) => {
            const isActive = opt.value === phase;
            const isCompleted = idx < currentIndex;
            const Icon = opt.icon;
            const isLast = idx === SPRINT_PHASE_OPTIONS.length - 1;

            return (
              <div key={opt.value} className="flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleChange(isActive ? null : opt.value)}
                      disabled={isAgentWorking}
                      aria-label={opt.label}
                      aria-pressed={isActive}
                      className={cn(
                        'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-all',
                        isActive && [opt.activeClass, 'shadow-sm'],
                        isCompleted && 'text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-accent/50',
                        !isActive && !isCompleted && 'text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-accent/50',
                        isAgentWorking && 'pointer-events-none opacity-50',
                      )}
                    >
                      {isCompleted
                        ? <Check className="h-3 w-3 shrink-0" />
                        : <Icon className={cn('h-3 w-3 shrink-0', isActive && opt.color)} />
                      }
                      <span className={cn('hidden sm:inline', isActive && 'inline')}>
                        {opt.label}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{opt.description}</TooltipContent>
                </Tooltip>
                {!isLast && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/20 shrink-0 mx-0.5" />
                )}
              </div>
            );
          })}
        </div>

        <div className="w-px h-4 bg-border/60 shrink-0" />

        {/* Right: Close */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClose}
              className="flex items-center justify-center h-6 w-6 rounded-sm text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-accent transition-colors shrink-0"
              aria-label="Close sprint toolbar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
