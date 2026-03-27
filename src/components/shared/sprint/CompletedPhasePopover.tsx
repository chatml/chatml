'use client';

import type { SprintPhase } from '@/lib/types';
import type { SprintArtifact } from '@/lib/sprint-config';
import { getArtifactsForPhase, PHASE_ARTIFACTS } from '@/lib/sprint-config';
import { getSprintPhaseOption } from '@/lib/session-fields';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Check, Circle } from 'lucide-react';
import type { ReactNode } from 'react';

interface CompletedPhasePopoverProps {
  phase: SprintPhase;
  artifacts: SprintArtifact[];
  children: ReactNode;
}

/**
 * Popover shown when clicking a completed sprint phase node.
 * Displays artifacts produced during that phase.
 */
export function CompletedPhasePopover({ phase, artifacts, children }: CompletedPhasePopoverProps) {
  const opt = getSprintPhaseOption(phase);
  const Icon = opt.icon;
  const phaseArtifacts = getArtifactsForPhase(phase, artifacts);
  const expectedArtifacts = PHASE_ARTIFACTS[phase];

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="center" className="w-56 p-0">
        {/* Header */}
        <div className={cn('flex items-center gap-2 px-3 py-2 border-b border-border/60', opt.activeClass)}>
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">{opt.label}</span>
          <Check className="h-3 w-3 ml-auto opacity-60" />
        </div>

        {/* Artifact list */}
        <div className="p-2 space-y-1">
          {expectedArtifacts.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">No artifacts tracked</p>
          ) : (
            expectedArtifacts.map((def) => {
              const found = phaseArtifacts.find((a) => a.type === def.type);
              return (
                <div
                  key={def.type}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1 rounded-sm text-xs',
                    found ? 'text-foreground' : 'text-muted-foreground/50',
                  )}
                >
                  {found ? (
                    <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 shrink-0" />
                  )}
                  <span>{def.label}</span>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
