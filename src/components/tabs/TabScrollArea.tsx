'use client';

import { forwardRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TabScrollAreaProps } from './tab.types';

/**
 * Scrollable container for tabs with optional scroll buttons
 *
 * Features:
 * - Horizontal scroll with hidden scrollbar
 * - Optional scroll buttons at edges (when canScrollLeft/canScrollRight)
 * - Smooth scroll behavior
 */
export const TabScrollArea = forwardRef<HTMLDivElement, TabScrollAreaProps & {
  canScrollLeft?: boolean;
  canScrollRight?: boolean;
  onScrollLeft?: () => void;
  onScrollRight?: () => void;
}>(function TabScrollArea(
  {
    children,
    className,
    canScrollLeft,
    canScrollRight,
    onScrollLeft,
    onScrollRight,
  },
  ref
) {
  return (
    <div className="relative flex-1 min-w-0 flex items-center">
      {/* Left scroll button */}
      {canScrollLeft && onScrollLeft && (
        <button
          type="button"
          className={cn(
            'absolute left-0 z-10 h-full px-1',
            'bg-gradient-to-r from-background to-transparent',
            'flex items-center justify-center',
            'text-muted-foreground hover:text-foreground',
            'transition-opacity'
          )}
          onClick={onScrollLeft}
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      )}

      {/* Scrollable content */}
      <div
        ref={ref}
        className={cn(
          'flex items-center gap-0 overflow-x-auto',
          'scrollbar-none', // Hide scrollbar (defined in globals.css)
          className
        )}
        style={{
          scrollBehavior: 'smooth',
        }}
      >
        {children}
      </div>

      {/* Right scroll button */}
      {canScrollRight && onScrollRight && (
        <button
          type="button"
          className={cn(
            'absolute right-0 z-10 h-full px-1',
            'bg-gradient-to-l from-background to-transparent',
            'flex items-center justify-center',
            'text-muted-foreground hover:text-foreground',
            'transition-opacity'
          )}
          onClick={onScrollRight}
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </div>
  );
});
