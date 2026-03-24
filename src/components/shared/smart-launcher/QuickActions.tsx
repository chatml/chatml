'use client';

import { FolderOpen, Globe, Plus, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickActionsProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onNewSession: () => void;
  onCreateSession: () => void;
  hasWorkspace: boolean;
}

const ACTION_CARDS = [
  {
    icon: Plus,
    label: 'New session',
    description: 'Start coding with AI',
    key: 'new-session',
    requiresWorkspace: true,
    iconClass: 'text-brand',
  },
  {
    icon: FolderOpen,
    label: 'Open project',
    description: 'From local folder',
    key: 'open',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: Globe,
    label: 'Clone repo',
    description: 'From GitHub URL',
    key: 'clone',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: GitBranch,
    label: 'From PR',
    description: 'Review a pull request',
    key: 'from-pr',
    iconClass: 'text-purple-600 dark:text-purple-400',
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
    <div className="grid grid-cols-2 gap-2.5">
      {ACTION_CARDS.map(({ icon: Icon, label, description, key, iconClass, ...rest }) => {
        const disabled = 'requiresWorkspace' in rest && rest.requiresWorkspace && !hasWorkspace;
        return (
          <button
            key={key}
            onClick={() => !disabled && handleCardClick(key)}
            disabled={disabled}
            className={cn(
              'group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-150',
              'border-border/40 bg-card/40',
              disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'cursor-pointer hover:bg-card/80 hover:border-border/70 hover:shadow-sm active:scale-[0.98]'
            )}
            {...(key === 'open' ? { 'data-tour-target': 'add-workspace' } : {})}
          >
            <div className={cn(
              'size-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 transition-colors',
              !disabled && 'group-hover:bg-muted/80'
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
              <div className="text-xs text-muted-foreground truncate">
                {description}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
