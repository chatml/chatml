'use client';

import { useState, memo } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Circle, ClipboardCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROSE_CLASSES } from '@/lib/constants';
import { CachedMarkdown } from '@/components/shared/CachedMarkdown';

interface ApprovedPlanBlockProps {
  cacheKey: string;
  content: string;
  defaultExpanded?: boolean;
}

export const ApprovedPlanBlock = memo(function ApprovedPlanBlock({
  cacheKey,
  content,
  defaultExpanded = true,
}: ApprovedPlanBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex items-center gap-1.5 text-base w-full rounded px-1.5 py-1 transition-colors',
          'hover:bg-surface-2',
        )}
      >
        {/* Status indicator — green success circle (plan was approved) */}
        <span className="flex items-center justify-center w-3 h-3 shrink-0">
          <Circle className="w-2 h-2 fill-text-success text-text-success" />
        </span>

        {/* Icon and label */}
        <ClipboardCheck className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">Approved Plan</span>

        {/* Spacer */}
        <span className="flex-1" />

        {/* Expand indicator */}
        <span className="shrink-0 text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="w-2.5 h-2.5" />
          ) : (
            <ChevronRight className="w-2.5 h-2.5" />
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className={cn(PROSE_CLASSES, 'mt-0.5 ml-4 space-y-1.5 border-l-2 border-primary/20 pl-3')}>
          <CachedMarkdown cacheKey={cacheKey} content={content} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
