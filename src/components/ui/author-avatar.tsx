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
    sm: 'h-5 w-5 text-[9px]',
    md: 'h-6 w-6 text-[10px]',
  };

  const initial = (name || '?')[0].toUpperCase();

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className={cn('rounded-full shrink-0', sizeClasses[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full bg-muted flex items-center justify-center shrink-0',
        sizeClasses[size],
        className
      )}
    >
      <span className="font-medium">{initial}</span>
    </div>
  );
}
