import { GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GitStatusIconProps {
  prStatus?: 'none' | 'open' | 'merged' | 'closed';
  checkStatus?: 'none' | 'pending' | 'success' | 'failure';
  hasMergeConflict?: boolean;
  className?: string;
}

export function GitStatusIcon({ prStatus, checkStatus, hasMergeConflict, className = 'h-3.5 w-3.5 shrink-0' }: GitStatusIconProps) {
  if (prStatus === 'merged') {
    return <GitMerge className={cn(className, 'text-nav-icon-prs')} />;
  }

  if (prStatus === 'closed') {
    if (checkStatus === 'failure' || hasMergeConflict) {
      return <GitPullRequestClosed className={cn(className, 'text-text-error')} />;
    }
    return <GitPullRequestClosed className={cn(className, 'text-muted-foreground')} />;
  }

  if (prStatus === 'open') {
    // Priority: failure > conflict > pending > passing
    if (checkStatus === 'failure') {
      return <GitPullRequest className={cn(className, 'text-text-error')} />;
    }
    if (hasMergeConflict) {
      return <GitPullRequest className={cn(className, 'text-orange-400')} />;
    }
    if (checkStatus === 'pending') {
      return <GitPullRequest className={cn(className, 'text-amber-500')} />;
    }
    return <GitPullRequest className={cn(className, 'text-text-success')} />;
  }

  // No PR — show muted branch icon
  return <GitBranch className={cn(className, 'text-muted-foreground/50')} />;
}
