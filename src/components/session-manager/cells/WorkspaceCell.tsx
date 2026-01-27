'use client';

import { cn } from '@/lib/utils';

// Linear-style color palette for workspace indicators
const WORKSPACE_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

// Get consistent color for a workspace based on its ID
function getWorkspaceColor(workspaceId: string): string {
  let hash = 0;
  for (let i = 0; i < workspaceId.length; i++) {
    hash = ((hash << 5) - hash) + workspaceId.charCodeAt(i);
    hash |= 0;
  }
  return WORKSPACE_COLORS[Math.abs(hash) % WORKSPACE_COLORS.length];
}

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
