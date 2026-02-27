import { cn } from '@/lib/utils';

const RESOLUTION_STYLES = {
  fixed: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
  ignored: 'bg-muted text-muted-foreground border-border',
} as const;

const SIZE_CLASSES = {
  xs: 'text-2xs px-1 py-0',
  sm: 'text-xs px-1.5 py-0',
} as const;

interface ResolutionBadgeProps {
  type?: 'fixed' | 'ignored';
  /** xs for card lists, sm for inline threads */
  size?: 'xs' | 'sm';
}

export function ResolutionBadge({ type, size = 'xs' }: ResolutionBadgeProps) {
  const resolvedType = type || 'fixed';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium capitalize shrink-0',
        SIZE_CLASSES[size],
        RESOLUTION_STYLES[resolvedType]
      )}
    >
      {resolvedType}
    </span>
  );
}
