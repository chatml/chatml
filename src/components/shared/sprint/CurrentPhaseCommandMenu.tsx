'use client';

import { useState } from 'react';
import type { SprintPhase } from '@/lib/types';
import { PHASE_COMMANDS } from '@/lib/sprint-config';
import { getSprintPhaseOption } from '@/lib/session-fields';
import { dispatchAppEvent } from '@/lib/custom-events';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Terminal } from 'lucide-react';
import type { ReactNode } from 'react';

interface CurrentPhaseCommandMenuProps {
  phase: SprintPhase;
  children: ReactNode;
  disabled?: boolean;
}

/**
 * Popover shown when clicking the current sprint phase node.
 * Displays available slash commands for this phase.
 */
export function CurrentPhaseCommandMenu({ phase, children, disabled }: CurrentPhaseCommandMenuProps) {
  const [open, setOpen] = useState(false);
  const opt = getSprintPhaseOption(phase);
  const Icon = opt.icon;
  const commands = PHASE_COMMANDS[phase];

  const handleCommandClick = (trigger: string) => {
    dispatchAppEvent('sprint-phase-command', { command: `/${trigger}` });
    setOpen(false);
  };

  return (
    <Popover open={disabled ? false : open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="center" className="w-64 p-0">
        {/* Header */}
        <div className={cn('flex items-center gap-2 px-3 py-2 border-b border-border/60', opt.activeClass)}>
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">{opt.label}</span>
          <span className="text-[10px] opacity-60 ml-auto">Current Phase</span>
        </div>

        {/* Commands */}
        <div className="p-1.5">
          {commands.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              <p>No specific commands — build natively with Claude Code.</p>
              <p className="mt-1 opacity-60">Write code, run tests, iterate.</p>
            </div>
          ) : (
            commands.map((cmd) => (
              <button
                key={cmd.trigger}
                className="group w-full text-left rounded-md px-2 py-1.5 hover:bg-accent transition-colors"
                onClick={() => handleCommandClick(cmd.trigger)}
              >
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center h-6 w-6 rounded-md bg-muted/50 group-hover:bg-muted shrink-0">
                    <Terminal className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{cmd.label}</span>
                      <code className="text-[10px] text-muted-foreground font-mono">/{cmd.trigger}</code>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{cmd.description}</p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
