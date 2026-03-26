'use client';

import { useWorkspaceSelection, useSessionActivityState } from '@/stores/selectors';
import { dispatchAppEvent } from '@/lib/custom-events';
import { SPRINT_PHASE_OPTIONS } from '@/lib/session-fields';
import { SPRINT_PHASES } from '@/lib/types';
import type { SprintPhase } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';
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
  const totalPhases = SPRINT_PHASE_OPTIONS.length;
  const progressPercent = currentIndex >= 0 && totalPhases > 1
    ? (currentIndex / (totalPhases - 1)) * 100
    : 0;

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

        {/* Center: Phase stepper with progress rail */}
        <div className="flex-1 flex items-center justify-center px-2">
          <div className="relative flex items-center w-full max-w-xl">
            {/* Background rail (full width, muted) */}
            <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-[2px] bg-border/50 rounded-full" />

            {/* Completed rail (fills from left to active phase) */}
            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-muted-foreground/30 transition-all duration-300 ease-out"
              style={{ width: `calc(${progressPercent}% - ${progressPercent > 0 ? '24px' : '0px'})` }}
            />

            {/* Phase nodes */}
            <div className="relative flex items-center justify-between w-full">
              {SPRINT_PHASE_OPTIONS.map((opt, idx) => {
                const isActive = opt.value === phase;
                const isCompleted = idx < currentIndex;
                const Icon = opt.icon;

                return (
                  <Tooltip key={opt.value}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleChange(isActive ? null : opt.value)}
                        disabled={isAgentWorking}
                        aria-label={opt.label}
                        aria-pressed={isActive}
                        className={cn(
                          'relative flex items-center gap-1.5 group transition-all duration-200',
                          isAgentWorking && 'opacity-50',
                        )}
                      >
                        {/* Node circle */}
                        <div className={cn(
                          'flex items-center justify-center h-5 w-5 rounded-full border-[1.5px] transition-all duration-200',
                          isActive && [
                            opt.color,
                            'border-current bg-current/15 scale-110 shadow-[0_0_8px_-2px_currentColor]',
                          ],
                          isCompleted && [
                            'border-muted-foreground/40 bg-muted-foreground/10 text-muted-foreground/70',
                            'group-hover:border-muted-foreground/60 group-hover:bg-muted-foreground/20',
                          ],
                          !isActive && !isCompleted && [
                            'border-border bg-transparent text-muted-foreground/50',
                            'group-hover:border-muted-foreground/40 group-hover:bg-accent/30 group-hover:text-muted-foreground/70',
                          ],
                        )}>
                          {isCompleted
                            ? <Check className="h-2.5 w-2.5" />
                            : <Icon className={cn('h-2.5 w-2.5', isActive && opt.color)} />
                          }
                        </div>

                        {/* Label */}
                        <span className={cn(
                          'text-[10px] font-medium leading-none transition-colors duration-200',
                          isActive && [opt.color, 'font-semibold'],
                          isCompleted && 'text-muted-foreground/60 group-hover:text-muted-foreground/80',
                          !isActive && !isCompleted && 'text-muted-foreground/45 group-hover:text-muted-foreground/70',
                          'hidden sm:inline',
                          isActive && '!inline',
                        )}>
                          {opt.label}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{opt.description}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </div>
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
