'use client';

import { CachedMarkdown } from '@/components/shared/CachedMarkdown';
import { cn } from '@/lib/utils';

interface DialogMarkdownProps {
  /** Unique cache key for the LRU markdown cache */
  cacheKey: string;
  /** Raw markdown string to render */
  content: string;
  /** Additional CSS classes to merge onto the wrapper div */
  className?: string;
}

export function DialogMarkdown({ cacheKey, content, className }: DialogMarkdownProps) {
  return (
    <div className={cn('dialog-markdown', className)}>
      <CachedMarkdown cacheKey={cacheKey} content={content} />
    </div>
  );
}
