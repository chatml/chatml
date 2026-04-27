import type { WorktreeSession } from '@/lib/types';

/**
 * Returns true when a session should be visible/selectable in the UI: not
 * archived, and either non-base or base-with-the-setting-on. This is the
 * single source of truth for "should the conversation pane / sidebar / tab
 * restoration touch this session?".
 */
export function isSelectableSession(
  session: WorktreeSession,
  showBaseBranchSessions: boolean,
): boolean {
  if (session.archived) return false;
  if (session.sessionType === 'base' && !showBaseBranchSessions) return false;
  return true;
}

/**
 * Find the first selectable session in a workspace.
 *
 * When `workspaceId` is `null` or `undefined` the workspace filter is dropped
 * and the search runs across **all** workspaces — useful for fallbacks during
 * app boot when no workspace is selected yet. Pass an explicit string id when
 * results must be scoped to a single workspace.
 */
export function findSelectableSession(
  sessions: WorktreeSession[],
  workspaceId: string | null | undefined,
  showBaseBranchSessions: boolean,
): WorktreeSession | undefined {
  return sessions.find(
    (s) =>
      (!workspaceId || s.workspaceId === workspaceId) &&
      isSelectableSession(s, showBaseBranchSessions),
  );
}
