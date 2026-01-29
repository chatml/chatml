'use client';

import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import {
  ChevronRight,
  Eye,
  GitBranch,
  MoreVertical,
  Play,
  Square,
  Archive,
  Copy,
  Code,
  FolderOpen,
  Terminal,
  Trash2,
  GitMerge,
  MessageSquare,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceColor } from '@/lib/workspace-colors';
import { updateSession as apiUpdateSession } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { WorktreeSession } from '@/lib/types';

// ---------------------------------------------------------------------------
// SessionTitle — inline editable title using session.task
// ---------------------------------------------------------------------------

function SessionTitle({
  session,
  workspaceId,
}: {
  session: WorktreeSession;
  workspaceId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const storeUpdateSession = useAppStore((s) => s.updateSession);

  const startEditing = useCallback(() => {
    setDraft(session.task ?? '');
    setEditing(true);
  }, [session.task]);

  const save = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (session.task ?? '')) {
      storeUpdateSession(session.id, { task: trimmed });
      apiUpdateSession(workspaceId, session.id, { task: trimmed }).catch(
        console.error,
      );
    }
  }, [draft, session.task, session.id, workspaceId, storeUpdateSession]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (editing) {
    return (
      <input
        ref={(el) => {
          if (el) {
            el.focus();
            el.select();
          }
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        }}
        className="text-sm bg-transparent border-b border-border outline-none px-0 py-0 min-w-[120px] max-w-[300px]"
        placeholder="Untitled session"
      />
    );
  }

  return (
    <span
      onClick={startEditing}
      className={`text-sm cursor-text hover:border-b hover:border-border/50 ${
        session.task ? '' : 'text-muted-foreground'
      }`}
    >
      {session.task || 'Untitled session'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// SessionToolbarContent — sets MainToolbar content for the session view
// ---------------------------------------------------------------------------

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
      bottom: {
        titlePosition: 'left' as const,
        title: (
          <SessionTitle
            session={selectedSession}
            workspaceId={selectedWorkspaceId!}
          />
        ),
        actions: (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 px-2 gap-1.5 text-xs',
                selectedSession.prStatus === 'open' && 'text-text-success hover:bg-text-success/10',
                (selectedSession.hasMergeConflict || selectedSession.hasCheckFailures) && 'text-text-error hover:bg-text-error/10',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              Review
            </Button>

            <div className="w-px h-4 bg-border mx-1" />

            <Button variant="ghost" size="icon" className="h-6 w-6" title="Resume Session">
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Stop Agent">
              <Square className="h-3.5 w-3.5" />
            </Button>

            <div className="w-px h-4 bg-border mx-1" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem>
                  <MessageSquare /> New Conversation
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <FileText /> View Summary
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Copy /> Copy Branch Name
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Code /> Open in VS Code
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Terminal /> Open in Terminal
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <FolderOpen /> Show in Finder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <GitMerge /> Create Pull Request
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <RefreshCw /> Sync with Main
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Archive /> Archive Session
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive">
                  <Trash2 /> Delete Session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    };
  }, [selectedWorkspace, selectedSession, selectedWorkspaceId]);

  useMainToolbarContent(toolbarConfig);

  return null;
}
