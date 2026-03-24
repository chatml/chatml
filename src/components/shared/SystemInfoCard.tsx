'use client';

import { GitBranch, FolderGit2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
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

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-base',
        isBase
          ? 'border-blue-400/20 bg-blue-500/10'
          : 'border-purple-400/20 bg-purple-500/10',
        className
      )}
    >
      <p className="text-muted-foreground mb-3">
        {isBase ? (
          <>
            This is the base session for your repository{' '}
            <span className="font-medium text-foreground">{sessionName}</span>
          </>
        ) : (
          <>
            You are in a new git worktree of your codebase called{' '}
            <span className="font-medium text-foreground">{sessionName}</span>
          </>
        )}
      </p>
      <div className="space-y-1.5 text-base text-muted-foreground">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 shrink-0" />
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
        {isBase && (
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Changes are made directly to your repository. Use a worktree session for development.
            </span>
          </div>
        )}
        {!isBase && fileCount !== undefined && (
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Created <span className="font-medium text-foreground">{sessionName}</span> with{' '}
              <span className="font-medium text-foreground">{fileCount.toLocaleString()}</span> files
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
