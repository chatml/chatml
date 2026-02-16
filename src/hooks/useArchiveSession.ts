import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { updateSession as updateSessionApi, getGitStatus } from '@/lib/api';
import type { ArchiveSessionDialogGitStatus } from '@/components/dialogs/ArchiveSessionDialog';

interface ArchiveDialogState {
  open: boolean;
  sessionId: string;
  sessionName: string;
  gitStatus: ArchiveSessionDialogGitStatus;
}

export function useArchiveSession(options?: {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}) {
  const archiveSession = useAppStore((s) => s.archiveSession);
  const removeSession = useAppStore((s) => s.removeSession);
  const confirmArchiveDirtySession = useSettingsStore(
    (s) => s.confirmArchiveDirtySession
  );

  // Use refs for callbacks to avoid re-creating memoized functions
  const onSuccessRef = useRef(options?.onSuccess);
  const onErrorRef = useRef(options?.onError);
  useEffect(() => {
    onSuccessRef.current = options?.onSuccess;
    onErrorRef.current = options?.onError;
  });

  const [dialogState, setDialogState] = useState<ArchiveDialogState | null>(
    null
  );

  const findSession = useCallback(
    (sessionId: string) => useAppStore.getState().sessions.find((s) => s.id === sessionId),
    []
  );

  const doArchive = useCallback(
    async (sessionId: string) => {
      const session = findSession(sessionId);
      if (!session) return;

      const { deleteBranchOnArchive } = useSettingsStore.getState();
      try {
        const result = await updateSessionApi(session.workspaceId, sessionId, {
          archived: true,
          ...(deleteBranchOnArchive ? { deleteBranch: true } : {}),
        });

        if (result === null) {
          // Blank session was deleted by backend (no messages)
          removeSession(sessionId);
        } else {
          // Session was archived normally
          archiveSession(sessionId);
        }
        onSuccessRef.current?.();
      } catch (error) {
        console.error('Failed to archive session:', error);
        onErrorRef.current?.(error);
      }
    },
    [findSession, archiveSession, removeSession]
  );

  const requestArchive = useCallback(
    async (sessionId: string) => {
      const session = findSession(sessionId);
      if (!session) return;

      // If confirmation is disabled, archive immediately
      if (!confirmArchiveDirtySession) {
        await doArchive(sessionId);
        return;
      }

      // Check git status to see if there are unsaved changes
      try {
        const status = await getGitStatus(session.workspaceId, sessionId);

        const isDirty =
          status.workingDirectory.hasChanges ||
          status.sync.unpushedCommits > 0;

        if (!isDirty) {
          // Clean session, archive immediately
          await doArchive(sessionId);
          return;
        }

        // Dirty session, show confirmation dialog
        setDialogState({
          open: true,
          sessionId,
          sessionName: session.task || session.branch || sessionId,
          gitStatus: {
            uncommittedCount:
              status.workingDirectory.stagedCount +
              status.workingDirectory.unstagedCount,
            untrackedCount: status.workingDirectory.untrackedCount,
            unpushedCommits: status.sync.unpushedCommits,
          },
        });
      } catch (error) {
        // If we can't fetch git status, archive without confirmation but warn
        console.warn('Failed to fetch git status, archiving without confirmation:', error);
        await doArchive(sessionId);
      }
    },
    [findSession, confirmArchiveDirtySession, doArchive]
  );

  const handleDialogConfirm = useCallback(() => {
    if (dialogState) {
      doArchive(dialogState.sessionId);
    }
  }, [dialogState, doArchive]);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDialogState(null);
    }
  }, []);

  return {
    requestArchive,
    dialogProps: dialogState
      ? {
          open: dialogState.open,
          onOpenChange: handleDialogOpenChange,
          onConfirm: handleDialogConfirm,
          sessionName: dialogState.sessionName,
          gitStatus: dialogState.gitStatus,
        }
      : null,
  };
}
