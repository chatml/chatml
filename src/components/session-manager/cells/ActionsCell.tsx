'use client';

import { Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { WorktreeSession } from '@/lib/types';

interface ActionsCellProps {
  session: WorktreeSession;
  onArchive: () => void;
  onUnarchive: () => void;
}

export function ActionsCell({
  session,
  onArchive,
  onUnarchive,
}: ActionsCellProps) {
  return (
    <div className="flex items-center justify-between w-full">
      {/* Archive button - left side, shown for active sessions */}
      {!session.archived ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-warning/70 hover:text-text-warning hover:bg-text-warning/10"
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
            >
              <Archive className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Archive session</TooltipContent>
        </Tooltip>
      ) : (
        <div className="w-7" />
      )}

      {/* Unarchive button - right side, shown for archived sessions */}
      {session.archived ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-success/70 hover:text-text-success hover:bg-text-success/10"
              onClick={(e) => {
                e.stopPropagation();
                onUnarchive();
              }}
            >
              <ArchiveRestore className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Restore session</TooltipContent>
        </Tooltip>
      ) : (
        <div className="w-7" />
      )}
    </div>
  );
}
