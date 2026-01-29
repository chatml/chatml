'use client';

import { cn } from '@/lib/utils';
import { getWorkspaceColor } from '@/lib/workspace-colors';

interface WorkspaceCellProps {
  workspaceId: string;
  workspaceName: string;
  archived?: boolean;
}

export function WorkspaceCell({ workspaceId, workspaceName, archived }: WorkspaceCellProps) {
  return (
    <div className={cn(
      'flex items-center gap-2 min-w-0',
      archived && 'opacity-50'
    )}>
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: getWorkspaceColor(workspaceId) }}
      />
      <span className="text-sm text-muted-foreground truncate">
        {workspaceName}
      </span>
    </div>
  );
}
