'use client';

import { Archive, ArchiveRestore, Eye } from 'lucide-react';
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
  onPreview?: () => void;
}

export function ActionsCell({
  session,
  onArchive,
  onUnarchive,
  onPreview,
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
              className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
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

      {/* Preview + Unarchive buttons for archived sessions */}
      {session.archived ? (
        <div className="flex items-center gap-0.5">
          {onPreview && (
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
          )}
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
        </div>
      ) : (
        <div className="w-7" />
      )}
    </div>
  );
}
