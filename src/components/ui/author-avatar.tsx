'use client';

import { cn } from '@/lib/utils';

interface AuthorAvatarProps {
  name: string;
  avatarUrl?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export function AuthorAvatar({ name, avatarUrl, size = 'sm', className }: AuthorAvatarProps) {
  const sizeClasses = {
    sm: 'h-4 w-4 min-w-4 min-h-4 text-[8px]',
    md: 'h-5 w-5 min-w-5 min-h-5 text-[9px]',
  };

  const initial = (name || '?')[0].toUpperCase();

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className={cn('rounded-full shrink-0 aspect-square object-cover', sizeClasses[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full bg-muted flex items-center justify-center shrink-0 aspect-square',
        sizeClasses[size],
        className
      )}
    >
      <span className="font-medium">{initial}</span>
    </div>
  );
}
