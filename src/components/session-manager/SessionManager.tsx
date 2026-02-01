'use client';

import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { updateSession as updateSessionApi } from '@/lib/api';
import { SessionsDataTable } from './SessionsDataTable';
import { ArchiveSessionDialog } from '@/components/dialogs/ArchiveSessionDialog';
import { useArchiveSession } from '@/hooks/useArchiveSession';
import { useMainToolbarContent } from '@/hooks/useMainToolbarContent';
import { Layers } from 'lucide-react';

export function SessionManager() {

  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const unarchiveSession = useAppStore((s) => s.unarchiveSession);
  const { expandWorkspace } = useSettingsStore();
  const { requestArchive, dialogProps: archiveDialogProps } = useArchiveSession();

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
        />
      </div>
      {archiveDialogProps && <ArchiveSessionDialog {...archiveDialogProps} />}
    </div>
  );
}
