'use client';

import { GitBranch, GitFork, FolderGit2, AlertTriangle, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { SetupInfo } from '@/lib/types';

interface SystemInfoCardProps {
  setupInfo: SetupInfo;
  className?: string;
}

export function SystemInfoCard({ setupInfo, className }: SystemInfoCardProps) {
  const { sessionName, branchName, originBranch, fileCount, sessionType } = setupInfo;
  // sessionType is omitempty on the backend — legacy messages lack this field
  // and correctly fall through to the worktree rendering path
  const isBase = sessionType === 'base';

  const Icon = isBase ? Server : GitFork;

  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3.5 text-base',
        isBase
          ? 'border-blue-400/30 bg-blue-500/8'
          : 'border-purple-400/30 bg-purple-500/8',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'flex items-center justify-center rounded-lg p-1.5',
            isBase ? 'bg-blue-500/15' : 'bg-purple-500/15'
          )}
        >
          <Icon
            className={cn(
              'w-4 h-4',
              isBase ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate">{sessionName}</span>
            <Badge
              className={cn(
                'text-2xs uppercase tracking-wide',
                isBase
                  ? 'border-blue-400/30 bg-blue-500/15 text-blue-700 dark:text-blue-300'
                  : 'border-purple-400/30 bg-purple-500/15 text-purple-700 dark:text-purple-300'
              )}
            >
              {isBase ? 'Base' : 'Worktree'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isBase ? 'Base session for your repository' : 'Git worktree session'}
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/50 my-2.5" />

      {/* Info rows */}
      <div className="space-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 shrink-0" />
          {isBase ? (
            <span>
              Currently on <span className="font-medium text-foreground">{branchName}</span>
            </span>
          ) : (
            <span>
              Branched <span className="font-medium text-foreground">{branchName}</span> from{' '}
              <span className="font-medium text-foreground">{originBranch}</span>
            </span>
          )}
        </div>
        {!isBase && fileCount !== undefined && (
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 shrink-0" />
            <span>
              Created <span className="font-medium text-foreground">{sessionName}</span> with{' '}
              <span className="font-medium text-foreground">{fileCount.toLocaleString()}</span> files
            </span>
          </div>
        )}
      </div>

      {/* Warning block (base only) */}
      {isBase && (
        <div className="flex items-center gap-2 mt-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Changes are made directly to your repository. Use a worktree session for development.
          </span>
        </div>
      )}
    </div>
  );
}
