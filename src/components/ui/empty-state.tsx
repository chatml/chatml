import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const emptyStateVariants = cva(
  'flex flex-col items-center justify-center text-muted-foreground animate-fade-in',
  {
    variants: {
      size: {
        sm: 'p-3 gap-1.5',
        default: 'p-4 gap-2',
        lg: 'p-6 gap-3',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
);

const emptyStateIconVariants = cva(
  'rounded-lg bg-muted/50 flex items-center justify-center',
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
  'text-muted-foreground/50',
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
  size,
  action,
}: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ size }), 'h-full', className)}>
      <div className={cn(emptyStateIconVariants({ size }))}>
        <Icon className={cn(emptyStateIconInnerVariants({ size }))} />
      </div>
      <div className="text-center">
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
            'text-muted-foreground/70 mt-0.5',
            size === 'sm' && 'text-[10px]',
            size === 'default' && 'text-xs',
            size === 'lg' && 'text-sm'
          )}>
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}

export { emptyStateVariants };
