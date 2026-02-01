'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { updateSession as updateSessionApi, deleteSession as deleteSessionApi } from '@/lib/api';
import { SessionsDataTable } from './SessionsDataTable';
import { ArchiveSessionDialog } from '@/components/dialogs/ArchiveSessionDialog';
import { ArchivedSessionPreviewDialog } from '@/components/dialogs/ArchivedSessionPreviewDialog';
import { DeleteSessionDialog } from '@/components/dialogs/DeleteSessionDialog';
import { useArchiveSession } from '@/hooks/useArchiveSession';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { useToast } from '@/components/ui/toast';
import { Layers } from 'lucide-react';
import type { WorktreeSession, Workspace } from '@/lib/types';

export function SessionManager() {

  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const unarchiveSession = useAppStore((s) => s.unarchiveSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const { expandWorkspace } = useSettingsStore();
  const { requestArchive, dialogProps: archiveDialogProps } = useArchiveSession();
  const { error: showError } = useToast();

  // Preview dialog state
  const [previewTarget, setPreviewTarget] = useState<{ session: WorktreeSession; workspace: Workspace } | null>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; workspaceId: string; name: string } | null>(null);

  // Set dynamic toolbar content
  const { activeSessions, archivedSessions } = useMemo(() => {
    let active = 0;
    let archived = 0;
    for (const s of sessions) {
      if (s.archived) archived++;
      else active++;
    }
    return { activeSessions: active, archivedSessions: archived };
  }, [sessions]);

  const toolbarConfig = useMemo(() => ({
    titlePosition: 'center' as const,
    title: (
      <span className="flex items-center gap-1.5">
        <Layers className="h-4 w-4 text-orange-400" />
        <h1 className="text-base font-semibold">Sessions</h1>
      </span>
    ),
    bottom: {
      title: (
        <span className="text-sm text-muted-foreground">
          {activeSessions} {activeSessions === 1 ? 'session' : 'sessions'}
          {archivedSessions > 0 && <span className="ml-2">{archivedSessions} archived</span>}
        </span>
      ),
      titlePosition: 'left' as const,
    },
  }), [activeSessions, archivedSessions]);
  useMainToolbarContent(toolbarConfig);

  // Handle session selection - navigate to conversation view
  const handleSelectSession = useCallback(
    (workspaceId: string, sessionId: string) => {
      expandWorkspace(workspaceId);
      navigate({
        workspaceId,
        sessionId,
        contentView: { type: 'conversation' },
      });
    },
    [expandWorkspace]
  );

  // Handle archive session
  const handleArchiveSession = useCallback(
    (sessionId: string) => {
      requestArchive(sessionId);
    },
    [requestArchive]
  );

  // Handle preview archived session
  const handlePreviewSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const workspace = workspaces.find((w) => w.id === session.workspaceId);
      if (!workspace) return;
      setPreviewTarget({ session, workspace });
    },
    [sessions, workspaces]
  );

  // Handle delete archived session
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      setDeleteTarget({ id: sessionId, workspaceId: session.workspaceId, name: session.name || session.branch });
    },
    [sessions]
  );

  const confirmDeleteSession = useCallback(
    async () => {
      if (!deleteTarget) return;
      try {
        await deleteSessionApi(deleteTarget.workspaceId, deleteTarget.id);
        removeSession(deleteTarget.id);
      } catch (error) {
        console.error('Failed to delete session:', error);
        showError('Failed to delete session');
      }
      setDeleteTarget(null);
    },
    [deleteTarget, removeSession, showError]
  );

  // Handle unarchive session
  const handleUnarchiveSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;

      try {
        // Update backend
        await updateSessionApi(session.workspaceId, sessionId, { archived: false });
        // Update local store
        unarchiveSession(sessionId);
      } catch (error) {
        console.error('Failed to unarchive session:', error);
      }
    },
    [sessions, unarchiveSession]
  );

  return (
    <div className="flex flex-col h-full bg-content-background">
      {/* Content: Sessions data table */}
      <div className="flex-1 overflow-hidden">
        <SessionsDataTable
          workspaces={workspaces}
          sessions={sessions}
          onSelectSession={handleSelectSession}
          onArchiveSession={handleArchiveSession}
          onUnarchiveSession={handleUnarchiveSession}
          onPreviewSession={handlePreviewSession}
          onDeleteSession={handleDeleteSession}
        />
      </div>
      {archiveDialogProps && <ArchiveSessionDialog {...archiveDialogProps} />}
      {previewTarget && (
        <ArchivedSessionPreviewDialog
          open={!!previewTarget}
          onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
          session={previewTarget.session}
          workspace={previewTarget.workspace}
          onRestore={() => {
            handleUnarchiveSession(previewTarget.session.id);
            setPreviewTarget(null);
          }}
          onDelete={() => {
            handleDeleteSession(previewTarget.session.id);
            setPreviewTarget(null);
          }}
        />
      )}
      {deleteTarget && (
        <DeleteSessionDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          onConfirm={confirmDeleteSession}
          sessionName={deleteTarget.name}
        />
      )}
    </div>
  );
}
