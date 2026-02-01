'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActionButtonProps } from './types';

export function ActionButton({
  action,
  isLoading,
  disabled,
  onSendMessage,
  onArchiveSession,
  onCreatePR,
  className,
}: ActionButtonProps) {
  // Nothing to render if action is null (e.g., merged PR)
  if (!action) {
    return null;
  }

  const Icon = action.icon;
  const isDisabled = disabled || action.type === 'disabled';
  // Only show spinner for 'disabled' type (agent working), not during data fetches
  // This prevents jarring transitions when switching sessions
  const showSpinner = action.type === 'disabled';

  // Handle click based on action type
  const handleClick = () => {
    if (isDisabled) return;

    if (action.type === 'create-pr' && onCreatePR) {
      // Open PR creation dialog
      onCreatePR();
    } else if (action.type === 'view-pr' && action.prUrl) {
      // Open PR in browser
      window.open(action.prUrl, '_blank');
    } else if (action.type === 'archive-session' && action.sessionId && onArchiveSession) {
      // Archive the session
      onArchiveSession(action.sessionId);
    } else if (action.message) {
      // Send message to agent
      onSendMessage(action.message);
    }
  };

  // Handle dropdown action click
  const handleDropdownClick = (message: string) => {
    onSendMessage(message);
  };

  // Handle secondary action click (legacy single action)
  const handleSecondaryClick = () => {
    if (action.secondaryAction) {
      onSendMessage(action.secondaryAction.message);
    }
  };

  // Check if we have dropdown actions (array) or secondary action (single)
  const hasDropdown = action.dropdownActions?.length || action.secondaryAction;

  // If action has dropdown actions, render split button with dropdown
  if (hasDropdown) {
    // Determine the separator color based on variant
    const separatorColor = {
      default: 'border-l-primary/30',
      destructive: 'border-l-red-400/40',
      success: 'border-l-emerald-400/40',
      warning: 'border-l-yellow-400/40',
      info: 'border-l-blue-400/40',
      purple: 'border-l-purple-400/40',
      secondary: 'border-l-secondary-foreground/10',
    }[action.variant] || 'border-l-primary/30';

    return (
      <div className={cn("inline-flex rounded-sm shadow-sm", className)}>
        <Button
          variant={action.variant}
          size="sm"
          className="h-6 text-xs gap-1 px-2 rounded-r-none rounded-l-sm border-r-0 transition-none"
          onClick={handleClick}
          disabled={isDisabled}
        >
          {showSpinner ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
          {action.label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={action.variant}
              size="sm"
              className={cn(
                'h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l',
                separatorColor
              )}
              disabled={isDisabled}
            >
              <ChevronDown className="size-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {action.dropdownActions?.map((dropdownAction) => {
              const DropdownIcon = dropdownAction.icon;
              return (
                <DropdownMenuItem
                  key={dropdownAction.label}
                  onClick={() => handleDropdownClick(dropdownAction.message)}
                  className={dropdownAction.description ? 'flex-col items-start py-2' : ''}
                >
                  <div className="flex items-center gap-2">
                    {DropdownIcon && <DropdownIcon className="size-4" />}
                    <span className="font-medium">{dropdownAction.label}</span>
                  </div>
                  {dropdownAction.description && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {dropdownAction.description}
                    </p>
                  )}
                </DropdownMenuItem>
              );
            })}
            {action.secondaryAction && (
              <DropdownMenuItem onClick={handleSecondaryClick}>
                {action.secondaryAction.label}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  // Regular button - use transition-none for instant variant changes
  return (
    <Button
      variant={action.variant}
      size="sm"
      className={cn("h-6 text-xs gap-1 px-2 rounded-sm transition-none", className)}
      onClick={handleClick}
      disabled={isDisabled}
    >
      {showSpinner ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {action.label}
    </Button>
  );
}
