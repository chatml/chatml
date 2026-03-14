import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BranchPillProps {
  name: string;
  className?: string;
  muted?: boolean;
}

export function BranchPill({ name, className, muted }: BranchPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-xs truncate',
        muted
          ? 'bg-muted/50 text-muted-foreground'
          : 'bg-purple-500/10 text-purple-700 dark:text-purple-300/70',
        className
      )}
      title={name}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0" />
      {name}
    </span>
  );
}
