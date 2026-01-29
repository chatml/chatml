'use client';

import { useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { navigate } from '@/lib/navigation';
import { useUIStore } from '@/stores/uiStore';
import { updateSession as updateSessionApi } from '@/lib/api';
import { SessionsDataTable } from './SessionsDataTable';
import { cn } from '@/lib/utils';

interface SessionManagerProps {
  onClose: () => void;
}

export function SessionManager({
  onClose,
}: SessionManagerProps) {

  const workspaces = useAppStore((s) => s.workspaces);
  const sessions = useAppStore((s) => s.sessions);
  const archiveSession = useAppStore((s) => s.archiveSession);
  const unarchiveSession = useAppStore((s) => s.unarchiveSession);
  const { expandWorkspace } = useSettingsStore();
  const leftToolbarBg = useUIStore((state) => state.toolbarBackgrounds.left);

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
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;

      try {
        // Update backend
        await updateSessionApi(session.workspaceId, sessionId, { archived: true });
        // Update local store
        archiveSession(sessionId);
      } catch (error) {
        console.error('Failed to archive session:', error);
      }
    },
    [sessions, archiveSession]
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
    <div className="flex flex-col h-full">
      {/* Header - minimal drag region */}
      <div
        data-tauri-drag-region
        className={cn('h-10 flex items-center justify-center border-b shrink-0', leftToolbarBg)}
      >
        <h1 className="text-sm font-medium">Session Manager</h1>
      </div>

      {/* Content: Sessions data table */}
      <div className="flex-1 overflow-hidden">
        <SessionsDataTable
          workspaces={workspaces}
          sessions={sessions}
          onSelectSession={handleSelectSession}
          onArchiveSession={handleArchiveSession}
          onUnarchiveSession={handleUnarchiveSession}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
