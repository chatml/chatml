'use client';

import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { WorktreeSession } from '@/lib/types';

interface ActionsCellProps {
  session: WorktreeSession;
  onPreview?: () => void;
}

export function ActionsCell({
  session,
  onPreview,
}: ActionsCellProps) {
  if (!session.archived || !onPreview) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">Preview</TooltipContent>
    </Tooltip>
  );
}
