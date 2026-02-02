'use client';

import { TASK_STATUS_OPTIONS, getTaskStatusOption } from '@/lib/session-fields';
import type { SessionTaskStatus } from '@/lib/types';
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
import { TaskStatusIcon } from '@/components/icons/TaskStatusIcon';

interface TaskStatusSelectorProps {
  value: SessionTaskStatus;
  onChange: (value: SessionTaskStatus) => void;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  disabled?: boolean;
}

export function TaskStatusSelector({
  value,
  onChange,
  size = 'sm',
  showLabel = false,
  disabled = false,
}: TaskStatusSelectorProps) {
  const current = getTaskStatusOption(value);
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const btnSize = size === 'sm' ? 'h-6 w-auto' : 'h-7 w-auto';

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className={cn(btnSize, showLabel ? 'gap-1.5 px-1.5' : 'w-6')}
      disabled={disabled}
    >
      <TaskStatusIcon status={current.value} className={iconSize} />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{current.label}</span>
      )}
    </Button>
  );

  return (
    <DropdownMenu>
      <Tooltip>
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
        {TASK_STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
          >
            <TaskStatusIcon status={option.value} className="h-4 w-4" />
            <span className="flex-1">{option.label}</span>
            {option.value === value && (
              <Check className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
