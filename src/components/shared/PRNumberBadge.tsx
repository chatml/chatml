'use client';

import { GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openUrlInBrowser } from '@/lib/tauri';

interface PRNumberBadgeProps {
  prNumber: number;
  prStatus: 'open' | 'merged' | 'closed';
  prUrl?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_STYLES = {
  open: {
    text: 'text-text-success',
    bg: 'bg-emerald-500/10 hover:bg-emerald-500/15',
    border: 'border-emerald-500/20',
  },
  merged: {
    text: 'text-nav-icon-prs',
    bg: 'bg-purple-500/10 hover:bg-purple-500/15',
    border: 'border-purple-500/20',
  },
  closed: {
    text: 'text-text-error',
    bg: 'bg-red-500/10 hover:bg-red-500/15',
    border: 'border-red-500/20',
  },
};

export function PRNumberBadge({
  prNumber,
  prStatus,
  prUrl,
  size = 'sm',
  className,
}: PRNumberBadgeProps) {
  const styles = STATUS_STYLES[prStatus];
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
  const badgeSize = size === 'sm' ? 'h-5 text-xs' : 'h-6 text-sm';

  const content = (
    <>
      <GitPullRequest className={cn(iconSize, styles.text, 'shrink-0')} />
      <span className={cn('font-medium', styles.text)}>#{prNumber}</span>
    </>
  );

  const sharedClasses = cn(
    'inline-flex items-center gap-1 px-1.5 rounded-full border transition-colors',
    badgeSize,
    styles.bg,
    styles.border,
    prUrl && 'cursor-pointer',
    className,
  );

  if (prUrl) {
    return (
      <button
        className={sharedClasses}
        onClick={(e) => {
          e.stopPropagation();
          openUrlInBrowser(prUrl);
        }}
        title={`Open PR #${prNumber}`}
      >
        {content}
      </button>
    );
  }

  return <span className={sharedClasses}>{content}</span>;
}
