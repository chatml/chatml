'use client';

import { useState } from 'react';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  GitBranch,
  X,
  Loader2,
  GitMerge,
  GitPullRequestArrow,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import type { BranchSyncStatus } from '@/lib/types';

interface BranchSyncBannerProps {
  status: BranchSyncStatus;
  loading?: boolean;
  onRebase: () => void;
  onMerge: () => void;
  onDismiss: () => void;
}

export function BranchSyncBanner({
  status,
  loading,
  onRebase,
  onMerge,
  onDismiss,
}: BranchSyncBannerProps) {
  const toast = useToast();
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  if (status.behindBy === 0) {
    return null;
  }

  const handleCopySha = async (sha: string) => {
    const success = await copyToClipboard(sha);
    if (success) {
      setCopiedSha(sha);
      setTimeout(() => setCopiedSha(null), 2000);
    } else {
      toast.error('Failed to copy to clipboard');
    }
  };

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-amber-500 shrink-0" />

        <HoverCard openDelay={100} closeDelay={200}>
          <HoverCardTrigger asChild>
            <button className="flex items-center gap-1 hover:text-foreground text-sm text-left">
              <span>
                {status.baseBranch} is{' '}
                <span className="font-medium text-amber-500 underline decoration-dotted underline-offset-2 cursor-pointer">
                  {status.behindBy} commit{status.behindBy !== 1 ? 's' : ''}
                </span>{' '}
                ahead
              </span>
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="!w-[500px] p-0">
            <div className="px-3 py-2 border-b">
              <span className="text-sm font-medium">
                Commits on {status.baseBranch}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {status.commits && status.commits.length > 0 ? (
                status.commits.map((commit) => (
                  <div
                    key={commit.sha}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 group"
                  >
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {commit.subject}
                    </span>
                    <button
                      onClick={() => handleCopySha(commit.sha)}
                      className="flex items-center gap-1 shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy SHA"
                    >
                      <span className="bg-muted px-1.5 py-0.5 rounded">
                        {commit.sha}
                      </span>
                      {copiedSha === commit.sha ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No commit details available
                </div>
              )}
            </div>
          </HoverCardContent>
        </HoverCard>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-sm shadow-sm">
            <Button
              variant="warning"
              size="sm"
              className="h-6 text-xs gap-1.5 px-2 rounded-r-none rounded-l-sm border-r-0 transition-none"
              onClick={onRebase}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitPullRequestArrow className="h-3.5 w-3.5" />
              )}
              Rebase
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="warning"
                  size="sm"
                  className="h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l border-l-yellow-400/40"
                  disabled={loading}
                >
                  <ChevronDown className="size-2.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-1.5">
                <button
                  className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-accent transition-colors"
                  onClick={onRebase}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-amber-500/15 p-1.5 mt-0.5">
                      <GitPullRequestArrow className="h-4 w-4 text-amber-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Rebase</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Replay your commits on top of <span className="font-medium text-foreground/70">{status.baseBranch}</span> for a linear history</div>
                    </div>
                  </div>
                </button>
                <button
                  className="w-full text-left rounded-lg px-3 py-2.5 hover:bg-accent transition-colors"
                  onClick={onMerge}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-purple-500/15 p-1.5 mt-0.5">
                      <GitMerge className="h-4 w-4 text-purple-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">Merge</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Merge <span className="font-medium text-foreground/70">{status.baseBranch}</span> into your branch with a merge commit</div>
                    </div>
                  </div>
                </button>
              </PopoverContent>
            </Popover>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onDismiss}
            disabled={loading}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
