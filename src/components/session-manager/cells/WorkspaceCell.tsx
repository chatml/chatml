'use client';

import { cn } from '@/lib/utils';
import { resolveWorkspaceColor } from '@/lib/workspace-colors';
import { useSettingsStore } from '@/stores/settingsStore';

interface WorkspaceCellProps {
  workspaceId: string;
  workspaceName: string;
  archived?: boolean;
  compact?: boolean;
}

export function WorkspaceCell({ workspaceId, workspaceName, archived, compact }: WorkspaceCellProps) {
  const workspaceColors = useSettingsStore((s) => s.workspaceColors);
  return (
    <div className={cn(
      'flex items-center gap-2 min-w-0',
      archived && 'opacity-50'
    )}>
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: resolveWorkspaceColor(workspaceId, workspaceColors) }}
      />
      {!compact && (
        <span className="text-sm text-muted-foreground truncate">
          {workspaceName}
        </span>
      )}
    </div>
  );
}
