'use client';

import { useState, useCallback } from 'react';
import { SPRINT_PHASE_OPTIONS, getSprintPhaseOption } from '@/lib/session-fields';
import { SPRINT_PHASES } from '@/lib/types';
import type { SprintPhase, WorktreeSession } from '@/lib/types';
import type { SprintArtifact } from '@/lib/sprint-config';
import { getPhaseStatus, type PhaseStatus } from '@/lib/sprint-config';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Rocket, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompletedPhasePopover } from './sprint/CompletedPhasePopover';
import { CurrentPhaseCommandMenu } from './sprint/CurrentPhaseCommandMenu';
import { NextPhasePopover } from './sprint/NextPhasePopover';
import { ArtifactBadges } from './sprint/ArtifactBadges';

const ONBOARDING_KEY = 'chatml:sprint-onboarded';

interface SprintPhaseBarProps {
  session: WorktreeSession;
  onStartSprint: () => void;
  disabled?: boolean;
}

/**
 * Unified Sprint Phase Bar — always visible when sprint is active.
 *
 * Two modes:
 * 1. Inactive: prominent "Start Sprint" button
 * 2. Active: 7-phase bar with context-dependent interactions
 *
 * Phase nodes are context-dependent:
 * - Completed: click opens artifact popover
 * - Current: click opens command menu
 * - Next: hover shows prerequisites (not clickable)
 * - Future: dimmed, hover shows description only
 */
export function SprintPhaseBar({ session, onStartSprint, disabled }: SprintPhaseBarProps) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  const phase = session.sprintPhase;
  const artifacts: SprintArtifact[] = session.sprintArtifacts ?? [];
  const currentIndex = phase ? SPRINT_PHASES.indexOf(phase) : -1;
  const totalPhases = SPRINT_PHASE_OPTIONS.length;
  const progressFraction = currentIndex >= 0 && totalPhases > 1
    ? currentIndex / (totalPhases - 1)
    : 0;

  const handleStartClick = useCallback(() => {
    const onboarded = localStorage.getItem(ONBOARDING_KEY);
    if (!onboarded) {
      setShowOnboarding(true);
      return;
    }
    onStartSprint();
  }, [onStartSprint]);

  const handleConfirmStart = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setShowOnboarding(false);
    onStartSprint();
  }, [onStartSprint]);

  // ------------------------------------------------------------------
  // Inactive state — prominent "Start Sprint" button
  // ------------------------------------------------------------------
  if (!phase) {
    return (
      <Popover open={showOnboarding} onOpenChange={setShowOnboarding}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 px-3 gap-1.5 text-xs font-medium"
                onClick={handleStartClick}
                disabled={disabled}
              >
                <Rocket className="h-3.5 w-3.5" />
                Start Sprint
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Start a sprint workflow (Think → Plan → Build → Review → Test → Ship → Reflect)</TooltipContent>
        </Tooltip>
        <PopoverContent side="bottom" align="start" className="w-80 p-0">
          <div className="p-3 space-y-2.5">
            <p className="text-sm font-semibold">Sprint Workflow</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              A sprint guides you through 7 development phases. Each phase has specific commands
              that produce artifacts for the next phase — like a real engineering team.
            </p>
            <div className="space-y-1">
              {SPRINT_PHASE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <div key={opt.value} className="flex items-center gap-2 py-0.5">
                    <div className={cn(
                      'flex items-center justify-center h-5 w-5 rounded-md',
                      opt.activeClass,
                    )}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <span className="text-xs font-medium">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{opt.description}</span>
                  </div>
                );
              })}
            </div>
            <Button size="sm" className="w-full h-7 text-xs" onClick={handleConfirmStart}>
              <Rocket className="h-3 w-3 mr-1.5" />
              Start Sprint
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // ------------------------------------------------------------------
  // Active state — full 7-phase bar (always visible, no close button)
  // ------------------------------------------------------------------
  return (
    <div className="shrink-0 border-b border-border/60 bg-background animate-in slide-in-from-top-1 fade-in duration-150">
      <div className="flex items-center h-10 px-3 gap-2">
        {/* Left: Sprint label */}
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60 shrink-0 select-none">
          Sprint
        </span>

        <div className="w-px h-4 bg-border/60 shrink-0" />

        {/* Center: Phase stepper with progress rail */}
        <div className="flex-1 flex items-center justify-center px-2">
          <div className="relative flex items-center w-full max-w-xl">
            {/* Background rail */}
            <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-[2px] bg-border/50 rounded-full" />

            {/* Completed rail */}
            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-muted-foreground/30 transition-all duration-300 ease-out"
              style={{ width: `calc(${progressFraction} * (100% - 24px))` }}
            />

            {/* Phase nodes */}
            <div className="relative flex items-center justify-between w-full">
              {SPRINT_PHASE_OPTIONS.map((opt) => {
                const status = getPhaseStatus(opt.value, phase);
                return (
                  <PhaseNode
                    key={opt.value}
                    phase={opt.value}
                    status={status}
                    artifacts={artifacts}
                    disabled={disabled}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: progress indicator */}
        <div className="w-px h-4 bg-border/60 shrink-0" />
        <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
          {currentIndex + 1}/{totalPhases}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseNode — renders differently based on phase status
// ---------------------------------------------------------------------------

interface PhaseNodeProps {
  phase: SprintPhase;
  status: PhaseStatus;
  artifacts: SprintArtifact[];
  disabled?: boolean;
}

function PhaseNode({ phase, status, artifacts, disabled }: PhaseNodeProps) {
  const opt = getSprintPhaseOption(phase);
  const Icon = opt.icon;

  // Base node visual
  const nodeContent = (
    <button
      disabled={disabled || status === 'future' || status === 'next'}
      aria-label={`${opt.label} — ${status}`}
      className={cn(
        'relative flex flex-col items-center gap-1 transition-all duration-200 group',
        'before:absolute before:inset-[-6px] before:content-[""]',
        // Completed
        status === 'completed' && 'cursor-pointer',
        // Current
        status === 'current' && 'cursor-pointer',
        // Next
        status === 'next' && 'cursor-default',
        // Future
        status === 'future' && 'cursor-default',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      {/* Circle */}
      <div className={cn(
        'flex items-center justify-center h-6 w-6 rounded-full border-[1.5px] transition-all duration-200',
        // Completed
        status === 'completed' && [
          'border-muted-foreground/40 bg-muted-foreground/15 text-muted-foreground/70',
          'group-hover:border-muted-foreground/60 group-hover:bg-muted-foreground/25',
        ],
        // Current — full color with glow
        status === 'current' && [
          opt.color,
          'border-current bg-current/15 scale-[1.15] shadow-[0_0_10px_-2px_currentColor]',
        ],
        // Next — slightly visible
        status === 'next' && [
          'border-muted-foreground/30 bg-transparent text-muted-foreground/45',
        ],
        // Future — fully dimmed
        status === 'future' && [
          'border-muted-foreground/20 bg-transparent text-muted-foreground/30',
        ],
      )}>
        {status === 'completed'
          ? <Check className="h-3 w-3" />
          : <Icon className={cn('h-3 w-3', status === 'current' && opt.color)} />
        }
      </div>

      {/* Label — shown for current phase, hidden for others to save space */}
      {status === 'current' && (
        <span className={cn('text-[10px] font-semibold leading-none', opt.color)}>
          {opt.label}
        </span>
      )}

      {/* Artifact badges for completed phases */}
      {status === 'completed' && (
        <ArtifactBadges phase={phase} artifacts={artifacts} className="mt-[-2px]" />
      )}
    </button>
  );

  // Wrap with appropriate popover/tooltip based on status
  switch (status) {
    case 'completed':
      return (
        <CompletedPhasePopover phase={phase} artifacts={artifacts}>
          {nodeContent}
        </CompletedPhasePopover>
      );

    case 'current':
      return (
        <CurrentPhaseCommandMenu phase={phase} disabled={disabled}>
          {nodeContent}
        </CurrentPhaseCommandMenu>
      );

    case 'next':
      return (
        <NextPhasePopover phase={phase} artifacts={artifacts}>
          {nodeContent}
        </NextPhasePopover>
      );

    case 'future':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {nodeContent}
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {opt.description}
          </TooltipContent>
        </Tooltip>
      );

    default:
      return nodeContent;
  }
}
