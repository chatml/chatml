'use client';

import { useState, memo } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronRight, ChevronDown, FileCode } from 'lucide-react';
import type { FileChange } from '@/lib/types';

interface FileChangesBlockProps {
  changes: FileChange[];
}

export const FileChangesBlock = memo(function FileChangesBlock({ changes }: FileChangesBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
  const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-medium hover:text-foreground transition-colors">
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <FileCode className="w-3 h-3" />
        <span>{changes.length} file{changes.length !== 1 ? 's' : ''} changed</span>
        <span className="font-mono text-text-success">+{totalAdditions}</span>
        <span className="font-mono text-text-error">-{totalDeletions}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded border bg-muted/30 divide-y divide-border/50">
          {changes.map((change, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono hover:bg-surface-2 cursor-pointer"
            >
              <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{change.path}</span>
              <span className="text-text-success">+{change.additions}</span>
              <span className="text-text-error">-{change.deletions}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
