'use client';

import { GitBranch, FolderGit2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SetupInfo {
  sessionName: string;
  branchName: string;
  originBranch: string;
  fileCount?: number;
}

interface SystemInfoCardProps {
  setupInfo: SetupInfo;
  className?: string;
}

export function SystemInfoCard({ setupInfo, className }: SystemInfoCardProps) {
  const { sessionName, branchName, originBranch, fileCount } = setupInfo;

  return (
    <div
      className={cn(
        'rounded-lg border border-purple-400/20 bg-purple-500/10 dark:border-purple-400/20 dark:bg-purple-500/10 px-3 py-2 text-base',
        className
      )}
    >
      <p className="text-muted-foreground mb-3">
        You are in a new copy of your codebase called{' '}
        <span className="font-medium text-foreground">{sessionName}</span>
      </p>
      <div className="space-y-1.5 text-base text-muted-foreground">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 shrink-0" />
          <span>
            Branched <span className="font-medium text-foreground">{branchName}</span> from{' '}
            <span className="font-medium text-foreground">{originBranch}</span>
          </span>
        </div>
        {fileCount !== undefined && (
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
