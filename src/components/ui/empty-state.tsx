import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const emptyStateVariants = cva(
  'flex flex-col items-center text-muted-foreground h-full',
  {
    variants: {
      size: {
        sm: 'px-4 pt-8 gap-2',
        default: 'px-6 pt-12 gap-2',
        lg: 'px-8 pt-16 gap-3',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const emptyStateIconVariants = cva(
  'rounded-lg bg-muted/50 flex items-center justify-center shrink-0',
  {
    variants: {
      size: {
        sm: 'w-8 h-8',
        default: 'w-10 h-10',
        lg: 'w-12 h-12',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const emptyStateIconInnerVariants = cva(
  'text-muted-foreground',
  {
    variants: {
      size: {
        sm: 'w-4 h-4',
        default: 'w-5 h-5',
        lg: 'w-6 h-6',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

interface EmptyStateProps extends VariantProps<typeof emptyStateVariants> {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  size = 'default',
  action,
}: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ size }), className)}>
      <div className={cn(emptyStateIconVariants({ size }))}>
        <Icon className={cn(emptyStateIconInnerVariants({ size }))} />
      </div>
      <div className="text-center max-w-[280px]">
        <p className={cn(
          'font-medium',
          size === 'sm' && 'text-xs',
          size === 'default' && 'text-sm',
          size === 'lg' && 'text-base'
        )}>
          {title}
        </p>
        {description && (
          <p className={cn(
            'text-muted-foreground mt-1',
            size === 'sm' && 'text-[11px]',
            size === 'default' && 'text-xs',
            size === 'lg' && 'text-sm'
          )}>
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="mt-3">
          {action}
        </div>
      )}
    </div>
  );
}

export { emptyStateVariants };
