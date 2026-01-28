'use client';

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface InlineErrorFallbackProps {
  message?: string;
  className?: string;
}

/**
 * Compact inline error fallback for small components.
 * Displays a warning icon and short message.
 */
export function InlineErrorFallback({
  message = 'Unable to display content',
  className,
}: InlineErrorFallbackProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs text-destructive/70',
        className
      )}
    >
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

interface BlockErrorFallbackProps {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Block-level error fallback for larger components like code viewers, diffs, editors.
 * Centers content with an icon, title, and optional description.
 */
export function BlockErrorFallback({
  icon: Icon = AlertTriangle,
  title = 'Something went wrong',
  description,
  className,
}: BlockErrorFallbackProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center h-full p-4 text-muted-foreground',
        className
      )}
    >
      <Icon className="w-8 h-8 mb-2 text-destructive/50" />
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
      )}
    </div>
  );
}

interface CardErrorFallbackProps {
  message?: string;
  className?: string;
}

/**
 * Card-shaped error fallback for list items like PRCard, SessionCard.
 * Maintains card layout structure while showing an error state.
 */
export function CardErrorFallback({
  message = 'Error loading item',
  className,
}: CardErrorFallbackProps) {
  return (
    <div
      className={cn(
        'border border-destructive/30 rounded-lg bg-card p-3',
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm text-destructive/70">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
    </div>
  );
}
