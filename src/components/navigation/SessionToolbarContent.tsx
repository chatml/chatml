'use client';

import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceSelection } from '@/stores/selectors';
import { useAppStore } from '@/stores/appStore';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { PrimaryActionButton } from '@/components/shared/PrimaryActionButton';
import { sendConversationMessage } from '@/lib/api';
import {
  ChevronRight,
  ChevronDown,
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
  Zap,
  Search,
  Shield,
  Gauge,
  Boxes,
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import type { WorktreeSession } from '@/lib/types';

// ---------------------------------------------------------------------------
// Review type options for the split button popover
// ---------------------------------------------------------------------------

const REVIEW_TYPES = [
  { icon: Zap, title: 'Quick Scan', description: 'Fast pass over changes — catch obvious issues and typos' },
  { icon: Search, title: 'Deep Review', description: 'Thorough line-by-line analysis with detailed feedback' },
  { icon: Shield, title: 'Security Audit', description: 'Focus on vulnerabilities, auth gaps, and injection risks' },
  { icon: Gauge, title: 'Performance', description: 'Check for regressions, memory leaks, and slow paths' },
  { icon: Boxes, title: 'Architecture', description: 'Evaluate design patterns, coupling, and separation of concerns' },
  { icon: GitMerge, title: 'Pre-merge Check', description: 'Final review before merge — verify tests, conflicts, and coverage' },
] as const;

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
  const selectedConversationId = useAppStore((s) => s.selectedConversationId);

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId);

  const handleGitActionMessage = useCallback((content: string) => {
    if (!selectedConversationId) {
      console.warn('No conversation selected, cannot send git action message');
      return;
    }
    sendConversationMessage(selectedConversationId, content).catch(console.error);
  }, [selectedConversationId]);

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
            <PrimaryActionButton
              workspaceId={selectedWorkspaceId}
              session={selectedSession}
              onSendMessage={handleGitActionMessage}
            />

            <div className="w-1.5" />

            {(() => {
              const reviewVariant =
                (selectedSession.hasMergeConflict || selectedSession.hasCheckFailures)
                  ? 'destructive' as const
                  : selectedSession.prStatus === 'open'
                    ? 'success' as const
                    : 'secondary' as const;

              const separatorColor = {
                destructive: 'border-l-red-400/40',
                success: 'border-l-emerald-400/40',
                secondary: 'border-l-secondary-foreground/10',
              }[reviewVariant];

              return (
            <div className="inline-flex rounded-sm shadow-sm">
              <Button
                variant={reviewVariant}
                size="sm"
                className="h-6 px-2 gap-1.5 text-xs rounded-r-none rounded-l-sm border-r-0 transition-none"
              >
                <Eye className="h-3.5 w-3.5" />
                Review
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={reviewVariant}
                    size="sm"
                    className={cn(
                      'h-6 w-4 px-0.5 rounded-l-none rounded-r-sm transition-none border-l',
                      separatorColor,
                    )}
                  >
                    <ChevronDown className="size-2.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-1.5">
                  {REVIEW_TYPES.map((type) => (
                    <button
                      key={type.title}
                      className="w-full text-left rounded-md px-3 py-2.5 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <type.icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">{type.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{type.description}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
              );
            })()}

            <div className="w-1.5" />

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
  }, [selectedWorkspace, selectedSession, selectedWorkspaceId, handleGitActionMessage]);

  useMainToolbarContent(toolbarConfig);

  return null;
}
