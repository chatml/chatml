'use client';

import { useState, useCallback } from 'react';
import { copyToClipboard } from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { Copy, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function formatRelativeTime(isoDate: string): string {
  const ms = new Date(isoDate).getTime();
  if (isNaN(ms)) return '\u2014';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SectionHeader({ label }: { label: string }) {
  return (
    <div className="text-2xs font-medium text-foreground/60 uppercase tracking-wider pt-1">
      {label}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    },
    [text],
  );
  return (
    <button
      onClick={handleCopy}
      className="ml-1 opacity-0 group-hover/row:opacity-100 transition-opacity shrink-0"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3 h-3 text-text-success" />
      ) : (
        <Copy className="w-3 h-3 text-muted-foreground" />
      )}
    </button>
  );
}

export function InfoRow({
  icon: Icon,
  label,
  value,
  copyValue,
  mono,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  copyValue?: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="group/row flex items-center justify-between text-xs gap-2 min-h-[20px]">
      <div className="flex items-center gap-1.5 text-muted-foreground shrink-0">
        {Icon && <Icon className="w-3 h-3 shrink-0" />}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'flex items-center text-right min-w-0 overflow-hidden',
          mono && 'font-mono text-xs',
          className,
        )}
      >
        <span className="truncate min-w-0">{value}</span>
        {copyValue && <CopyButton text={copyValue} />}
      </div>
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    active: 'bg-text-success',
    idle: 'bg-muted-foreground',
    done: 'bg-blue-500',
    error: 'bg-text-error',
  };
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          colorMap[status] || 'bg-muted-foreground',
        )}
      />
      <span className="capitalize">{status}</span>
    </span>
  );
}

export function PrStatusBadge({
  status,
  prNumber,
  prUrl,
  checkStatus,
}: {
  status: string;
  prNumber?: number;
  prUrl?: string;
  checkStatus?: 'none' | 'pending' | 'success' | 'failure';
}) {
  const colorMap: Record<string, string> = {
    open: 'text-text-success',
    merged: 'text-nav-icon-prs',
    closed: 'text-text-error',
    none: 'text-muted-foreground',
  };

  // Override open PR color based on check status
  if (status === 'open' && checkStatus) {
    if (checkStatus === 'pending') {
      colorMap.open = 'text-amber-500';
    } else if (checkStatus === 'failure') {
      colorMap.open = 'text-text-error';
    }
  }

  if (status === 'none') {
    return <span className="text-muted-foreground">None</span>;
  }

  const label = prNumber ? `#${prNumber}` : status;

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn('hover:underline capitalize', colorMap[status])}
      >
        {label} &middot; {status}
      </a>
    );
  }

  return (
    <span className={cn('capitalize', colorMap[status])}>
      {label} &middot; {status}
    </span>
  );
}
