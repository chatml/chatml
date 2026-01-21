import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground p-4', className)}>
      <Icon className="h-8 w-8 mb-2 opacity-30" />
      <p className="text-xs">{title}</p>
      {description && (
        <p className="text-[10px] opacity-60 mt-0.5">{description}</p>
      )}
    </div>
  );
}
