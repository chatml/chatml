'use client';

import { useState, memo } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Scissors, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROSE_CLASSES_COMPACT } from '@/lib/constants';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';

interface CompactBoundaryCardProps {
  cacheKey: string;
  content: string;
  compactSummary?: string;
}

export const CompactBoundaryCard = memo(function CompactBoundaryCard({
  cacheKey,
  content,
  compactSummary,
}: CompactBoundaryCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // When there's no summary to expand, render a plain non-interactive divider
  if (!compactSummary) {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1 border-t border-border/50" />
        <div className="flex items-center gap-1.5 text-xs px-2 py-0.5 text-muted-foreground">
          <Scissors className="w-3 h-3 shrink-0" />
          <span>{content}</span>
        </div>
        <div className="flex-1 border-t border-border/50" />
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-2 py-1">
        {/* Left divider line */}
        <div className="flex-1 border-t border-border/50" />

        <CollapsibleTrigger
          className={cn(
            'flex items-center gap-1.5 text-xs rounded px-2 py-0.5 transition-colors',
            'hover:bg-surface-2',
            'text-muted-foreground',
          )}
        >
          <Scissors className="w-3 h-3 shrink-0" />
          <span>{content}</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-muted-foreground/70">
            {isOpen ? 'Hide' : 'Show'} summary
          </span>
          <span className="shrink-0">
            {isOpen ? (
              <ChevronDown className="w-2.5 h-2.5" />
            ) : (
              <ChevronRight className="w-2.5 h-2.5" />
            )}
          </span>
        </CollapsibleTrigger>

        {/* Right divider line */}
        <div className="flex-1 border-t border-border/50" />
      </div>

      <CollapsibleContent>
        <div className={cn(PROSE_CLASSES_COMPACT, 'mt-1 mx-4 px-3 py-2 rounded-md bg-surface-2/50 border border-border/30')}>
          <CachedMarkdown cacheKey={cacheKey} content={compactSummary} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
