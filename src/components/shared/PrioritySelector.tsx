'use client';

import { useState } from 'react';
import { PRIORITY_OPTIONS, getPriorityOption } from '@/lib/session-fields';
import type { SessionPriority } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Check } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface PrioritySelectorProps {
  value: SessionPriority;
  onChange: (value: SessionPriority) => void;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  disabled?: boolean;
}

export function PrioritySelector({
  value,
  onChange,
  size = 'sm',
  showLabel = false,
  disabled = false,
}: PrioritySelectorProps) {
  const current = getPriorityOption(value);
  const Icon = current.icon;
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const btnSize = size === 'sm' ? 'h-6 w-auto' : 'h-7 w-auto';

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className={cn(btnSize, showLabel ? 'gap-1.5 px-1.5' : 'w-6')}
      disabled={disabled}
    >
      <Icon className={cn(iconSize, current.color)} />
      {showLabel && (
        <span className={cn('text-xs', current.color)}>{current.label}</span>
      )}
    </Button>
  );

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={menuOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {trigger}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {!showLabel && (
          <TooltipContent side="bottom" className="text-xs">
            {current.label}
          </TooltipContent>
        )}
      </Tooltip>
      <DropdownMenuContent align="start" className="w-44">
        {PRIORITY_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
            >
              <OptionIcon className={cn('h-4 w-4', option.color)} />
              <span className="flex-1">{option.label}</span>
              {option.value === value && (
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
