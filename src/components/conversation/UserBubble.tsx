import * as React from 'react';
import { cn } from '@/lib/utils';

export const USER_BUBBLE_CLASSNAME = 'bg-user-bubble text-foreground rounded-lg px-4 py-2.5';

interface UserBubbleProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/** Shared visual container for user-authored chat messages. */
export function UserBubble({ children, className, ...props }: UserBubbleProps) {
  return (
    <div className={cn(USER_BUBBLE_CLASSNAME, className)} {...props}>
      {children}
    </div>
  );
}
