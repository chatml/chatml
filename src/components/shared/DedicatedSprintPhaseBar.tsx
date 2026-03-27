'use client';

import { SPRINT_PHASE_OPTIONS, getSprintPhaseOption } from '@/lib/session-fields';
import { SPRINT_PHASES } from '@/lib/types';
import type { SprintPhase } from '@/lib/types';
import type { SprintArtifact } from '@/lib/sprint-config';
import { getPhaseStatus, type PhaseStatus } from '@/lib/sprint-config';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Check } from 'lucide-react';
import { CompletedPhasePopover } from './sprint/CompletedPhasePopover';
import { CurrentPhaseCommandMenu } from './sprint/CurrentPhaseCommandMenu';
import { NextPhasePopover } from './sprint/NextPhasePopover';
import { useWorkspaceSelection, useSessionActivityState } from '@/stores/selectors';

/**
 * Dedicated Sprint Phase Bar — renders as its own full-width bar below the toolbar.
 * Only visible when a sprint is active. Reads session from store directly.
 */
export function DedicatedSprintPhaseBar() {
  const { sessions, selectedSessionId } = useWorkspaceSelection();
  const session = sessions.find((s) => s.id === selectedSessionId);

  const phase = session?.sprintPhase;
  const isAgentWorking = useSessionActivityState(session?.id ?? '') === 'working';

  // Hidden when no session, base session, or no active sprint
  if (!session || session.sessionType === 'base' || !phase) {
    return null;
  }

  const artifacts: SprintArtifact[] = session.sprintArtifacts ?? [];
  const currentIndex = SPRINT_PHASES.indexOf(phase);
  const totalPhases = SPRINT_PHASE_OPTIONS.length;
  const progressPercent = currentIndex >= 0 && totalPhases > 1
    ? (currentIndex / (totalPhases - 1)) * 100
    : 0;

  return (
    <div className="shrink-0 relative bg-background animate-in slide-in-from-top-1 fade-in duration-200">
      <div className="flex items-center h-11 px-4">
        {/* Phase segments */}
        <div className="flex items-center gap-1 w-full">
          {SPRINT_PHASE_OPTIONS.map((opt, idx) => {
            const status = getPhaseStatus(opt.value, phase);
            const isLast = idx === SPRINT_PHASE_OPTIONS.length - 1;
            return (
              <PhaseSegment
                key={opt.value}
                phase={opt.value}
                status={status}
                artifacts={artifacts}
                disabled={isAgentWorking}
                isLast={isLast}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom progress rail */}
      <div className="h-[2px] w-full bg-border/40">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPercent}%`,
            background: `linear-gradient(90deg, ${getPhaseColorVar('think')}, ${getPhaseColorVar(phase)})`,
          }}
        />
      </div>
    </div>
  );
}

// Map phase to a CSS color value for the gradient
function getPhaseColorVar(phase: SprintPhase): string {
  const map: Record<SprintPhase, string> = {
    think: '#f59e0b',   // amber-500
    plan: '#3b82f6',    // blue-500
    build: '#22c55e',   // green-500
    review: '#a855f7',  // purple-500
    test: '#14b8a6',    // teal-500
    ship: '#f97316',    // orange-500
    reflect: '#ec4899', // pink-500
  };
  return map[phase];
}

// ---------------------------------------------------------------------------
// PhaseSegment — horizontal pill/tab for each phase
// ---------------------------------------------------------------------------

interface PhaseSegmentProps {
  phase: SprintPhase;
  status: PhaseStatus;
  artifacts: SprintArtifact[];
  disabled?: boolean;
  isLast: boolean;
}

function PhaseSegment({ phase, status, artifacts, disabled, isLast }: PhaseSegmentProps) {
  const opt = getSprintPhaseOption(phase);
  const Icon = opt.icon;

  const segmentContent = (
    <button
      disabled={disabled || status === 'future' || status === 'next'}
      aria-label={`${opt.label} — ${status}`}
      className={cn(
        'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 group',
        // Completed
        status === 'completed' && [
          'cursor-pointer text-muted-foreground/70',
          'hover:bg-muted/60 hover:text-muted-foreground',
        ],
        // Current — prominent pill
        status === 'current' && [
          'cursor-pointer font-semibold',
          opt.color,
        ],
        // Next — slightly visible
        status === 'next' && 'cursor-default text-muted-foreground/45',
        // Future — fully dimmed
        status === 'future' && 'cursor-default text-muted-foreground/30',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      {/* Current phase background pill */}
      {status === 'current' && (
        <div className={cn(
          'absolute inset-0 rounded-md opacity-[0.12]',
          // Use explicit bg classes for Tailwind JIT
          phase === 'think' && 'bg-amber-500',
          phase === 'plan' && 'bg-blue-500',
          phase === 'build' && 'bg-green-500',
          phase === 'review' && 'bg-purple-500',
          phase === 'test' && 'bg-teal-500',
          phase === 'ship' && 'bg-orange-500',
          phase === 'reflect' && 'bg-pink-500',
        )} />
      )}

      {/* Icon */}
      <span className="relative shrink-0">
        {status === 'completed' ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </span>

      {/* Label */}
      <span className="relative whitespace-nowrap">{opt.label}</span>
    </button>
  );

  // Connector between segments
  const connector = !isLast ? (
    <div className={cn(
      'flex-1 h-px min-w-2 max-w-6 mx-0.5',
      status === 'completed' ? 'bg-muted-foreground/25' : 'bg-border/50',
    )} />
  ) : null;

  const wrapped = wrapWithInteraction(segmentContent, phase, status, artifacts, disabled);

  return (
    <>
      {wrapped}
      {connector}
    </>
  );
}

function wrapWithInteraction(
  content: React.ReactElement,
  phase: SprintPhase,
  status: PhaseStatus,
  artifacts: SprintArtifact[],
  disabled?: boolean,
) {
  switch (status) {
    case 'completed':
      return (
        <CompletedPhasePopover phase={phase} artifacts={artifacts}>
          {content}
        </CompletedPhasePopover>
      );
    case 'current':
      return (
        <CurrentPhaseCommandMenu phase={phase} disabled={disabled}>
          {content}
        </CurrentPhaseCommandMenu>
      );
    case 'next':
      return (
        <NextPhasePopover phase={phase} artifacts={artifacts}>
          {content}
        </NextPhasePopover>
      );
    case 'future': {
      const opt = getSprintPhaseOption(phase);
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {content}
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {opt.description}
          </TooltipContent>
        </Tooltip>
      );
    }
    default:
      return content;
  }
}
