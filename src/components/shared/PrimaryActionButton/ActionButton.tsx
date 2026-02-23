'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

const PENDING_TIMEOUT_MS = 8000;

export function ActionButton({
  action,
  onSendMessage,
  onFixIssues,
  onArchiveSession,
  onCreatePR,
  className,
}: ActionButtonProps) {
  // Pending action state — blocks duplicate clicks and shows spinner feedback.
  // pendingActionKey tracks which action was clicked. When the action identity changes
  // (type or label), the mismatch means the click has been processed → not pending.
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const actionKey = action ? `${action.type}:${action.label}` : null;
  const pendingAction = pendingActionKey !== null && pendingActionKey === actionKey;

  // Safety timeout: reset after timeout in case the action object doesn't change
  useEffect(() => {
    if (!pendingActionKey) return;
    const timer = setTimeout(() => setPendingActionKey(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingActionKey]);

  // Mark as pending for the current action
  const markPending = useCallback(() => {
    setPendingActionKey(actionKey);
  }, [actionKey]);

  // Replay enter animation when the tier changes by removing and re-adding the class
  const containerRef = useRef<HTMLDivElement>(null);
  const prevTierRef = useRef(action?.tier);
  useEffect(() => {
    if (!action || !containerRef.current) return;
    if (prevTierRef.current !== action.tier) {
      const el = containerRef.current;
      el.classList.remove('animate-action-enter');
      // Force reflow so the browser registers the removal
      void el.offsetWidth;
      el.classList.add('animate-action-enter');
    }
    prevTierRef.current = action.tier;
  }, [action?.tier, action]);

  // Nothing to render if action is null (e.g., clean state)
  if (!action) {
    return null;
  }

  const Icon = action.icon;

  // Handle click based on action type
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pendingAction) return;

    // For actions that send a message to the agent, block subsequent clicks
    const isMessageAction = action.type === 'fix-issues' || (action.message != null);
    if (isMessageAction) {
      markPending();
    }

    if (action.type === 'fix-issues' && onFixIssues) {
      // Fetch CI failure context and forward to agent
      onFixIssues();
    } else if (action.type === 'create-pr' && onCreatePR) {
      // Open PR creation dialog
      onCreatePR();
    } else if (action.type === 'merge-pr') {
      // Merge PR: send the merge instruction to the agent
      if (action.message) {
        onSendMessage(action.message, action.type);
      }
    } else if (action.type === 'view-pr' && action.prUrl) {
      // Open PR in browser
      window.open(action.prUrl, '_blank');
    } else if (action.type === 'archive-session' && action.sessionId && onArchiveSession) {
      // Archive the session
      onArchiveSession(action.sessionId);
    } else if (action.message) {
      // Send message to agent
      onSendMessage(action.message, action.type);
    }
  };

  // Handle dropdown action click — uses the parent action.type (not per-item) so
  // all dropdown items resolve to the same template (e.g. all merge strategies → 'merge-pr').
  const handleDropdownClick = (message: string) => {
    if (pendingAction) return;
    markPending();
    onSendMessage(message, action.type);
  };

  // Handle secondary action click (legacy single action)
  const handleSecondaryClick = () => {
    if (pendingAction) return;
    markPending();
    if (action.secondaryAction) {
      onSendMessage(action.secondaryAction.message, action.type);
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
    }[action.variant] || 'border-l-primary/30';

    return (
      <div ref={containerRef} className={cn("inline-flex rounded-sm shadow-sm animate-action-enter", className)}>
        <Button
          variant={action.variant}
          size="sm"
          className="h-6 text-xs gap-1 px-2 rounded-r-none rounded-l-sm border-r-0 transition-colors duration-150"
          onClick={handleClick}
          disabled={pendingAction}
        >
          {pendingAction ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icon className="h-3.5 w-3.5" />
          )}
          {pendingAction ? 'Sending...' : action.label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={action.variant}
              size="sm"
              className={cn(
                'h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-colors duration-150 border-l',
                separatorColor
              )}
              disabled={pendingAction}
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

  // Regular button (no dropdown)
  return (
    <div ref={containerRef} className={cn("animate-action-enter", className)}>
      <Button
        variant={action.variant}
        size="sm"
        className="h-6 text-xs gap-1 px-2 rounded-sm transition-colors duration-150"
        onClick={handleClick}
        disabled={pendingAction}
      >
        {pendingAction ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {pendingAction ? 'Sending...' : action.label}
      </Button>
    </div>
  );
}
