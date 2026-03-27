'use client';

import type { SprintPhase } from '@/lib/types';
import { SPRINT_PHASES } from '@/lib/types';
import { getSprintPhaseOption } from '@/lib/session-fields';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

// Milestone content format: "sprint:phase_change:fromPhase:toPhase" or "sprint:started:think"
const MILESTONE_PREFIX = 'sprint:';

export function isSprintMilestone(content: string): boolean {
  return content.startsWith(MILESTONE_PREFIX);
}

interface MilestoneData {
  type: 'started' | 'phase_change';
  fromPhase?: SprintPhase;
  toPhase: SprintPhase;
}

const isValidPhase = (v: string): v is SprintPhase =>
  (SPRINT_PHASES as readonly string[]).includes(v);

function parseMilestone(content: string): MilestoneData | null {
  if (!content.startsWith(MILESTONE_PREFIX)) return null;
  const parts = content.slice(MILESTONE_PREFIX.length).split(':');

  if (parts[0] === 'started' && parts[1] && isValidPhase(parts[1])) {
    return { type: 'started', toPhase: parts[1] };
  }
  if (parts[0] === 'phase_change' && parts[1] && parts[2] && isValidPhase(parts[1]) && isValidPhase(parts[2])) {
    return { type: 'phase_change', fromPhase: parts[1], toPhase: parts[2] };
  }
  return null;
}

interface SprintMilestoneCardProps {
  content: string;
}

export function SprintMilestoneCard({ content }: SprintMilestoneCardProps) {
  const data = parseMilestone(content);
  if (!data) return null;

  const toOpt = getSprintPhaseOption(data.toPhase);
  const ToIcon = toOpt.icon;

  if (data.type === 'started') {
    return (
      <div className="flex items-center justify-center py-2">
        <div className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
          'border-border/40 bg-background',
        )}>
          <div className={cn('flex items-center justify-center h-5 w-5 rounded-full', toOpt.activeClass)}>
            <ToIcon className="h-3 w-3" />
          </div>
          <span className="text-muted-foreground">Sprint started</span>
          <span className={cn('font-semibold', toOpt.color)}>{toOpt.label}</span>
        </div>
      </div>
    );
  }

  // Phase change
  const fromOpt = data.fromPhase ? getSprintPhaseOption(data.fromPhase) : null;
  const FromIcon = fromOpt?.icon;

  return (
    <div className="flex items-center justify-center py-2">
      <div className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
        'border-border/40 bg-background',
      )}>
        {fromOpt && FromIcon && (
          <>
            <div className={cn('flex items-center justify-center h-5 w-5 rounded-full', fromOpt.activeClass)}>
              <FromIcon className="h-3 w-3" />
            </div>
            <span className="text-muted-foreground">{fromOpt.label}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
          </>
        )}
        <div className={cn('flex items-center justify-center h-5 w-5 rounded-full', toOpt.activeClass)}>
          <ToIcon className="h-3 w-3" />
        </div>
        <span className={cn('font-semibold', toOpt.color)}>{toOpt.label}</span>
      </div>
    </div>
  );
}
