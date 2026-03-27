'use client';

import type { SprintPhase } from '@/lib/types';
import type { SprintArtifact } from '@/lib/sprint-config';
import { getArtifactsForPhase } from '@/lib/sprint-config';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface ArtifactBadgesProps {
  phase: SprintPhase;
  artifacts: SprintArtifact[];
  className?: string;
}

/**
 * Small colored dots rendered below a completed phase node,
 * one per artifact produced in that phase.
 */
export function ArtifactBadges({ phase, artifacts, className }: ArtifactBadgesProps) {
  const phaseArtifacts = getArtifactsForPhase(phase, artifacts);
  if (phaseArtifacts.length === 0) return null;

  return (
    <div className={cn('flex items-center justify-center gap-0.5', className)}>
      {phaseArtifacts.map((artifact) => (
        <Tooltip key={artifact.id}>
          <TooltipTrigger asChild>
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {artifact.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
