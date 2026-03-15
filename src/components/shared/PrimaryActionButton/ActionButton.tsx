'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActionButtonProps, DropdownAction, DropdownColor } from './types';

const PENDING_TIMEOUT_MS = 8000;

const DROPDOWN_COLOR_CLASSES: Record<DropdownColor, { icon: string; bg: string; hoverBg: string }> = {
  blue:   { icon: 'text-blue-500',   bg: 'bg-blue-500/10',   hoverBg: 'group-hover:bg-blue-500/20' },
  purple: { icon: 'text-purple-500', bg: 'bg-purple-500/10', hoverBg: 'group-hover:bg-purple-500/20' },
  teal:   { icon: 'text-teal-500',   bg: 'bg-teal-500/10',   hoverBg: 'group-hover:bg-teal-500/20' },
  green:  { icon: 'text-green-500',  bg: 'bg-green-500/10',  hoverBg: 'group-hover:bg-green-500/20' },
  amber:  { icon: 'text-amber-500',  bg: 'bg-amber-500/10',  hoverBg: 'group-hover:bg-amber-500/20' },
  red:    { icon: 'text-red-500',    bg: 'bg-red-500/10',    hoverBg: 'group-hover:bg-red-500/20' },
};

export function ActionButton({
  action,
  onSendMessage,
  onFixIssues,
  onArchiveSession,
  className,
}: ActionButtonProps) {
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const actionKey = action ? `${action.type}:${action.label}` : null;
  const pendingAction = pendingActionKey !== null && pendingActionKey === actionKey;

  useEffect(() => {
    if (!pendingActionKey) return;
    const timer = setTimeout(() => setPendingActionKey(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingActionKey]);

  const markPending = useCallback(() => {
    setPendingActionKey(actionKey);
  }, [actionKey]);

  // Replay enter animation when the tier changes
  const containerRef = useRef<HTMLDivElement>(null);
  const prevTierRef = useRef(action?.tier);
  useEffect(() => {
    if (!action || !containerRef.current) return;
    if (prevTierRef.current !== action.tier) {
      const el = containerRef.current;
      el.classList.remove('animate-action-enter');
      void el.offsetWidth;
      el.classList.add('animate-action-enter');
    }
    prevTierRef.current = action.tier;
  }, [action?.tier, action]);

  if (!action) {
    return null;
  }

  const Icon = action.icon;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (pendingAction) return;

    const isMessageAction = action.type === 'fix-issues' || (action.message != null);
    if (isMessageAction) {
      markPending();
    }

    if (action.type === 'fix-issues' && onFixIssues) {
      onFixIssues();
    } else if (action.type === 'merge-pr') {
      if (action.message) {
        onSendMessage(action.message, action.type);
      }
    } else if (action.type === 'view-pr' && action.prUrl) {
      window.open(action.prUrl, '_blank');
    } else if (action.type === 'create-pr') {
      if (action.message) {
        onSendMessage(action.message, action.type);
      }
    } else if (action.type === 'archive-session' && action.sessionId && onArchiveSession) {
      onArchiveSession(action.sessionId);
    } else if (action.message) {
      onSendMessage(action.message, action.type);
    }
  };

  const handleDropdownClick = (message: string) => {
    if (pendingAction) return;
    markPending();
    setPopoverOpen(false);
    onSendMessage(message, action.type);
  };

  const handleSecondaryClick = () => {
    if (pendingAction) return;
    markPending();
    setPopoverOpen(false);
    if (action.secondaryAction) {
      onSendMessage(action.secondaryAction.message, action.type);
    }
  };

  const hasDropdown = action.dropdownActions?.length || action.secondaryAction;

  if (hasDropdown) {
    const separatorColor = {
      default: 'border-l-primary/30',
      destructive: 'border-l-red-400/40',
      success: 'border-l-emerald-400/40',
      warning: 'border-l-yellow-400/40',
    }[action.variant] || 'border-l-primary/30';

    // Split actions into simple (no color) and rich (with color) for rendering
    const simpleActions: DropdownAction[] = [];
    const richActions: DropdownAction[] = [];
    for (const da of action.dropdownActions ?? []) {
      if (da.color) richActions.push(da);
      else simpleActions.push(da);
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Number shortcuts for rich actions
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= richActions.length) {
        e.preventDefault();
        handleDropdownClick(richActions[num - 1].message);
        return;
      }

      // Arrow-key / Home / End navigation across menu items
      const container = e.currentTarget;
      const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIdx = active ? items.indexOf(active) : -1;

      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowDown':
          nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
          break;
        case 'ArrowUp':
          nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = items.length - 1;
          break;
      }
      if (nextIdx !== null) {
        e.preventDefault();
        items[nextIdx].focus();
      }
    };

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
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
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
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1.5" role="menu" onKeyDown={handleKeyDown}>
            {/* Simple actions (e.g. "Push Latest Changes") rendered as plain items */}
            {simpleActions.map((da) => {
              const SimpleIcon = da.icon;
              return (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  key={da.label}
                  className="group w-full text-left rounded-md px-2.5 py-2 hover:bg-accent transition-colors flex items-center gap-2.5"
                  onClick={() => handleDropdownClick(da.message)}
                >
                  {SimpleIcon && <SimpleIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="text-sm font-medium">{da.label}</span>
                </button>
              );
            })}
            {simpleActions.length > 0 && richActions.length > 0 && (
              <div className="mx-2.5 my-1 border-t border-border/50" />
            )}
            {/* Rich actions with colored icon backgrounds */}
            {richActions.map((da) => {
              const RichIcon = da.icon;
              const colors = da.color ? DROPDOWN_COLOR_CLASSES[da.color] : null;
              return (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  key={da.label}
                  className="group w-full text-left rounded-md px-2.5 py-2 hover:bg-accent transition-colors"
                  onClick={() => handleDropdownClick(da.message)}
                >
                  <div className="flex items-center gap-2.5">
                    {RichIcon && colors && (
                      <div className={cn(
                        'flex items-center justify-center h-7 w-7 rounded-lg shrink-0 transition-colors',
                        colors.bg, colors.hoverBg,
                      )}>
                        <RichIcon className={cn('h-3.5 w-3.5', colors.icon)} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium leading-tight">{da.label}</div>
                      {da.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{da.description}</div>
                      )}
                    </div>
                    {da.shortcut && (
                      <kbd className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium bg-muted/50 border border-border/40 rounded text-muted-foreground/60 shrink-0">
                        {da.shortcut}
                      </kbd>
                    )}
                  </div>
                </button>
              );
            })}
            {action.secondaryAction && (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="group w-full text-left rounded-md px-2.5 py-2 hover:bg-accent transition-colors"
                onClick={handleSecondaryClick}
              >
                <span className="text-sm font-medium">{action.secondaryAction.label}</span>
              </button>
            )}
          </PopoverContent>
        </Popover>
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
