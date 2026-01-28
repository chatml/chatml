'use client';

import { Icon } from '@iconify/react';
import { cn } from '@/lib/utils';
import { getFileIcon, getIconifyName } from '@/lib/vscodeIcons';

interface FileTabIconProps {
  filename: string;
  className?: string;
}

export function FileTabIcon({ filename, className }: FileTabIconProps) {
  const iconName = getFileIcon(filename);

  return (
    <Icon
      icon={getIconifyName(iconName)}
      className={cn('w-4 h-4 shrink-0', className)}
    />
  );
}
