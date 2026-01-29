'use client';

import { useMemo } from 'react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { ChevronRight, GitBranch } from 'lucide-react';
import { getWorkspaceColor } from '@/lib/workspace-colors';

/**
 * Headless component that sets the MainToolbar content for the session view.
 * Renders the workspace dot + name + chevron + branch icon + session name.
 */
export function SessionToolbarContent() {
  const { workspaces, sessions, selectedWorkspaceId, selectedSessionId } = useWorkspaceSelection();

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const toolbarConfig = useMemo(() => {
    if (!selectedWorkspace || !selectedSession) return {};

    return {
      titlePosition: 'center' as const,
      title: (
        <span className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: getWorkspaceColor(selectedWorkspace.id) }}
          />
          <span className="text-base font-semibold truncate max-w-[200px]">{selectedWorkspace.name}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <GitBranch className="h-4 w-4 text-purple-400" />
          <span className="text-base font-semibold truncate max-w-[200px]">{selectedSession.branch || selectedSession.name}</span>
        </span>
      ),
    };
  }, [selectedWorkspace, selectedSession]);

  useMainToolbarContent(toolbarConfig);

  return null;
}
