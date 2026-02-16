'use client';

import { GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openUrlInBrowser } from '@/lib/tauri';

type CheckStatus = 'none' | 'pending' | 'success' | 'failure';

interface PRNumberBadgeProps {
  prNumber: number;
  prStatus: 'open' | 'merged' | 'closed';
  checkStatus?: CheckStatus;
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
  'open-pending': {
    text: 'text-amber-500',
    bg: 'bg-amber-500/10 hover:bg-amber-500/15',
    border: 'border-amber-500/20',
  },
  'open-failure': {
    text: 'text-text-error',
    bg: 'bg-red-500/10 hover:bg-red-500/15',
    border: 'border-red-500/20',
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

function getStyleKey(prStatus: 'open' | 'merged' | 'closed', checkStatus?: CheckStatus): keyof typeof STATUS_STYLES {
  if (prStatus === 'open') {
    if (checkStatus === 'failure') return 'open-failure';
    if (checkStatus === 'pending') return 'open-pending';
    return 'open';
  }
  return prStatus;
}

export function PRNumberBadge({
  prNumber,
  prStatus,
  checkStatus,
  prUrl,
  size = 'sm',
  className,
}: PRNumberBadgeProps) {
  const styles = STATUS_STYLES[getStyleKey(prStatus, checkStatus)];
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
