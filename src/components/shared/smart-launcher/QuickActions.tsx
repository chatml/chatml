'use client';

import { Folder, Globe, Plus, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickActionsProps {
  onOpenProject: () => void;
  onCloneFromUrl: () => void;
  onNewSession: () => void;
  onCreateFromPR: () => void;
  hasWorkspace: boolean;
}

const ACTION_CARDS = [
  { icon: Folder, label: 'Open project', key: 'open' },
  { icon: Globe, label: 'Clone from URL', key: 'clone' },
  { icon: Plus, label: 'New session', key: 'new-session', requiresWorkspace: true },
  { icon: GitBranch, label: 'From PR/Branch', key: 'from-pr' },
] as const;

export function QuickActions({
  onOpenProject,
  onCloneFromUrl,
  onNewSession,
  onCreateFromPR,
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
        onCreateFromPR();
        break;
    }
  };

  return (
    <div className="flex gap-3 flex-wrap justify-center">
      {ACTION_CARDS.map(({ icon: Icon, label, key, ...rest }) => {
        const disabled = 'requiresWorkspace' in rest && rest.requiresWorkspace && !hasWorkspace;
        return (
          <button
            key={key}
            onClick={() => !disabled && handleCardClick(key)}
            disabled={disabled}
            className={cn(
              'group flex flex-col w-36 h-24 p-4 rounded-xl border border-border/50 bg-card/50 transition-all duration-200',
              disabled
                ? 'opacity-40 cursor-not-allowed'
                : 'hover:bg-card hover:border-border cursor-pointer'
            )}
            {...(key === 'open' ? { 'data-tour-target': 'add-workspace' } : {})}
          >
            <Icon className={cn(
              'h-5 w-5 text-muted-foreground transition-colors',
              !disabled && 'group-hover:text-foreground'
            )} />
            <span className={cn(
              'mt-auto text-sm text-muted-foreground transition-colors',
              !disabled && 'group-hover:text-foreground'
            )}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
