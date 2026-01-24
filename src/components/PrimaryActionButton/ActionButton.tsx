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

    if (action.type === 'view-pr' && action.prUrl) {
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
      secondary: 'border-l-secondary-foreground/10',
    }[action.variant] || 'border-l-primary/30';

    return (
      <div className="inline-flex rounded-md shadow-sm">
        <Button
          variant={action.variant}
          size="sm"
          className="h-7 text-xs gap-1 px-2 rounded-r-none border-r-0 transition-none"
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
                'h-7 w-5 p-0 rounded-l-none transition-none border-l',
                separatorColor
              )}
              disabled={isDisabled}
            >
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {action.dropdownActions?.map((dropdownAction) => {
              const DropdownIcon = dropdownAction.icon;
              return (
                <DropdownMenuItem
                  key={dropdownAction.label}
                  onClick={() => handleDropdownClick(dropdownAction.message)}
                >
                  {DropdownIcon && <DropdownIcon className="size-4 mr-2" />}
                  {dropdownAction.label}
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
      className="h-7 text-xs gap-1 px-2 transition-none"
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
