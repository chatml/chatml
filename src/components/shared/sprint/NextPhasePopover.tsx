'use client';

import type { SprintPhase } from '@/lib/types';
import type { SprintArtifact } from '@/lib/sprint-config';
import { PHASE_PREREQUISITES, PHASE_ARTIFACTS } from '@/lib/sprint-config';
import { getSprintPhaseOption } from '@/lib/session-fields';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Check, Circle, Lock, Unlock } from 'lucide-react';
import type { ReactNode } from 'react';

interface NextPhasePopoverProps {
  phase: SprintPhase;
  artifacts: SprintArtifact[];
  children: ReactNode;
}

/**
 * Hover-only tooltip shown on the next sprint phase.
 * Displays prerequisite checklist and readiness status.
 */
export function NextPhasePopover({ phase, artifacts, children }: NextPhasePopoverProps) {
  const opt = getSprintPhaseOption(phase);
  const Icon = opt.icon;
  const prerequisites = PHASE_PREREQUISITES[phase];
  const existingTypes = new Set(artifacts.map((a) => a.type));
  const allMet = prerequisites.every((t) => existingTypes.has(t));

  // Map artifact types to their labels via PHASE_ARTIFACTS
  const getArtifactLabel = (type: string): string => {
    for (const defs of Object.values(PHASE_ARTIFACTS)) {
      const found = defs.find((d) => d.type === type);
      if (found) return found.label;
    }
    return type;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-52 p-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
          <Icon className={cn('h-3.5 w-3.5', opt.color)} />
          <span className="text-xs font-medium">Unlock {opt.label}</span>
          {allMet ? (
            <Unlock className="h-3 w-3 ml-auto text-emerald-500" />
          ) : (
            <Lock className="h-3 w-3 ml-auto text-muted-foreground/40" />
          )}
        </div>

        {/* Prerequisites */}
        <div className="p-2 space-y-1">
          {prerequisites.length === 0 ? (
            <div className="flex items-center gap-2 px-1">
              <Check className="h-3 w-3 text-emerald-500 shrink-0" />
              <span className="text-[11px] text-emerald-600">Ready to advance</span>
            </div>
          ) : (
            prerequisites.map((type) => {
              const met = existingTypes.has(type);
              return (
                <div key={type} className="flex items-center gap-2 px-1">
                  {met ? (
                    <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  )}
                  <span className={cn('text-[11px]', met ? 'text-foreground' : 'text-muted-foreground')}>
                    {getArtifactLabel(type)}
                  </span>
                </div>
              );
            })
          )}

          {allMet && prerequisites.length > 0 && (
            <div className="mt-1 pt-1 border-t border-border/40 px-1">
              <span className="text-[10px] text-emerald-600 font-medium">Ready to advance</span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
