'use client';

import { FolderOpen, Globe, Plus, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMacOS } from '@/lib/platform';

interface QuickActionsProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onNewSession: () => void;
  onCreateSession: () => void;
  hasWorkspace: boolean;
}

const modKey = isMacOS() ? '⌘' : 'Ctrl+';

const ACTION_CARDS = [
  {
    icon: Plus,
    label: 'New session',
    description: 'Start coding with AI',
    key: 'new-session',
    requiresWorkspace: true,
    iconClass: 'text-brand',
    gradientClass: 'bg-gradient-to-b from-brand/15 to-brand/5',
    shortcut: `${modKey}N`,
  },
  {
    icon: FolderOpen,
    label: 'Open project',
    description: 'From local folder',
    key: 'open',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    gradientClass: 'bg-gradient-to-b from-emerald-500/15 to-emerald-500/5',
    shortcut: `${modKey}O`,
  },
  {
    icon: Globe,
    label: 'Clone repo',
    description: 'From GitHub URL',
    key: 'clone',
    iconClass: 'text-blue-600 dark:text-blue-400',
    gradientClass: 'bg-gradient-to-b from-blue-500/15 to-blue-500/5',
    shortcut: null,
  },
  {
    icon: GitBranch,
    label: 'From PR',
    description: 'Review a pull request',
    key: 'from-pr',
    iconClass: 'text-purple-600 dark:text-purple-400',
    gradientClass: 'bg-gradient-to-b from-purple-500/15 to-purple-500/5',
    shortcut: null,
  },
] as const;

export function QuickActions({
  onOpenProject,
  onCloneFromUrl,
  onNewSession,
  onCreateSession,
  hasWorkspace,
}: QuickActionsProps) {
  const handleCardClick = (key: string) => {
    switch (key) {
      case 'open':
        onOpenProject();
        break;
      case 'clone':
        onCloneFromUrl();
        break;
      case 'new-session':
        onNewSession();
        break;
      case 'from-pr':
        onCreateSession();
        break;
    }
  };

  return (
    <div className="grid grid-cols-2 @md:grid-cols-4 gap-3">
      {ACTION_CARDS.map(({ icon: Icon, label, description, key, iconClass, gradientClass, shortcut, ...rest }) => {
        const disabled = 'requiresWorkspace' in rest && rest.requiresWorkspace && !hasWorkspace;
        return (
          <button
            key={key}
            onClick={() => !disabled && handleCardClick(key)}
            disabled={disabled}
            className={cn(
              'group flex flex-col items-center text-center gap-2.5 rounded-xl border px-3 py-4 transition-all duration-150',
              'border-border/30 bg-card/30',
              disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'cursor-pointer hover:bg-card/60 hover:border-border/50 hover:shadow-sm active:scale-[0.98]'
            )}
            {...(key === 'open' ? { 'data-tour-target': 'add-workspace' } : {})}
          >
            <div className={cn(
              'size-10 rounded-xl flex items-center justify-center shrink-0 transition-colors',
              gradientClass,
              !disabled && 'group-hover:brightness-110'
            )}>
              <Icon className={cn('size-5', iconClass)} />
            </div>
            <div className="min-w-0">
              <div className={cn(
                'text-sm font-medium text-foreground/90 transition-colors',
                !disabled && 'group-hover:text-foreground'
              )}>
                {label}
              </div>
              <div className="text-[11px] text-muted-foreground/70 mt-0.5">
                {description}
              </div>
            </div>
            {shortcut && (
              <kbd className="font-mono text-[10px] text-muted-foreground/40 bg-surface-1/60 border border-border/20 rounded px-1.5 py-0.5">
                {shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
