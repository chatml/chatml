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
    key: 'new-session',
    requiresWorkspace: true,
    bgClass: 'bg-brand/10 dark:bg-brand/15',
    iconClass: 'text-brand',
  },
  {
    icon: FolderOpen,
    label: 'Open project',
    key: 'open',
    bgClass: 'bg-emerald-500/10 dark:bg-emerald-500/15',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    icon: Globe,
    label: 'Clone repo',
    key: 'clone',
    bgClass: 'bg-blue-500/10 dark:bg-blue-500/15',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: GitBranch,
    label: 'From PR',
    key: 'from-pr',
    bgClass: 'bg-purple-500/10 dark:bg-purple-500/15',
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
    <div className="grid grid-cols-4 gap-4">
      {ACTION_CARDS.map(({ icon: Icon, label, key, bgClass, iconClass, ...rest }) => {
        const disabled = 'requiresWorkspace' in rest && rest.requiresWorkspace && !hasWorkspace;
        return (
          <button
            key={key}
            onClick={() => !disabled && handleCardClick(key)}
            disabled={disabled}
            className={cn(
              'group flex flex-col items-center gap-3 py-4 px-2 rounded-2xl transition-all duration-200',
              disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'cursor-pointer hover:bg-muted/50'
            )}
            {...(key === 'open' ? { 'data-tour-target': 'add-workspace' } : {})}
          >
            {/* Icon container */}
            <div
              className={cn(
                'w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-200',
                bgClass,
                !disabled && 'group-hover:scale-[1.08] group-active:scale-[0.95]'
              )}
            >
              <Icon className={cn('size-8', iconClass)} />
            </div>

            {/* Label */}
            <span
              className={cn(
                'text-sm font-medium text-muted-foreground transition-colors duration-200',
                !disabled && 'group-hover:text-foreground'
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
