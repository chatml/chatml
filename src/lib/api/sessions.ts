import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse, ApiError } from './base';

export interface SessionDTO {
  id: string;
  workspaceId: string;
  name: string;
  branch: string;
  worktreePath: string;
  task?: string;
  status: 'active' | 'idle' | 'done' | 'error';
  priority: number;
  taskStatus: string;
  agentId?: string;
  stats?: {
    additions: number;
    deletions: number;
  };
  prStatus?: 'none' | 'open' | 'merged' | 'closed';
  prUrl?: string;
  prNumber?: number;
  prTitle?: string;
  hasMergeConflict?: boolean;
  hasCheckFailures?: boolean;
  checkStatus?: 'none' | 'pending' | 'success' | 'failure';
  targetBranch?: string;
  sessionType?: 'worktree' | 'base' | 'scheduled';
  scheduledTaskId?: string;
  pinned?: boolean;
  archived?: boolean;
  archiveSummary?: string;
  archiveSummaryStatus?: string;
  createdAt: string;
  updatedAt: string;
}

/** Map a backend SessionDTO to a frontend WorktreeSession */
export function mapSessionDTO(session: SessionDTO): import('@/lib/types').WorktreeSession {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    name: session.name,
    branch: session.branch,
    worktreePath: session.worktreePath,
    task: session.task,
    status: session.status,
    priority: (session.priority ?? 0) as import('@/lib/types').SessionPriority,
    taskStatus: (session.taskStatus ?? 'backlog') as import('@/lib/types').SessionTaskStatus,
    stats: session.stats,
    prStatus: session.prStatus,
    prUrl: session.prUrl,
    prNumber: session.prNumber,
    prTitle: session.prTitle,
    hasMergeConflict: session.hasMergeConflict,
    hasCheckFailures: session.hasCheckFailures,
    checkStatus: session.checkStatus as import('@/lib/types').WorktreeSession['checkStatus'],
    targetBranch: session.targetBranch,
    sessionType: session.sessionType,
    scheduledTaskId: session.scheduledTaskId,
    pinned: session.pinned,
    archived: session.archived,
    archiveSummary: session.archiveSummary,
    archiveSummaryStatus: (session.archiveSummaryStatus || '') as import('@/lib/types').WorktreeSession['archiveSummaryStatus'],
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export async function listSessions(workspaceId: string, includeArchived?: boolean): Promise<SessionDTO[]> {
  const params = includeArchived ? '?includeArchived=true' : '';
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions${params}`);
  return handleResponse<SessionDTO[]>(res);
}

/**
 * Fetches all sessions across all workspaces in a single request.
 * Eliminates the N+1 pattern of fetching sessions per workspace.
 */
export async function listAllSessions(includeArchived?: boolean): Promise<SessionDTO[]> {
  const params = includeArchived ? '?includeArchived=true' : '';
  const res = await fetchWithAuth(`${getApiBase()}/api/sessions${params}`);
  return handleResponse<SessionDTO[]>(res);
}

export async function createSession(
  workspaceId: string,
  data: { name?: string; branch?: string; branchPrefix?: string; worktreePath?: string; task?: string; checkoutExisting?: boolean; systemMessage?: string; sessionType?: 'worktree' | 'base' | 'scheduled' } = {}
): Promise<SessionDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<SessionDTO>(res);
}

export async function updateSession(
  workspaceId: string,
  sessionId: string,
  updates: Partial<Omit<SessionDTO, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>> & { deleteBranch?: boolean }
): Promise<SessionDTO | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  // 204 No Content means the session was deleted (blank session archived)
  if (res.status === 204) return null;
  return handleResponse<SessionDTO>(res);
}

export async function deleteSession(workspaceId: string, sessionId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  await handleVoidResponse(res, 'Failed to delete session');
}

// ============================================================================
// Base session API functions
// ============================================================================

export interface PreflightStatus {
  ok: boolean;
  activeRebase?: boolean;
  activeMerge?: boolean;
  activeCherryPick?: boolean;
  detachedHead?: boolean;
  corruptedIndex?: boolean;
  errorMessage?: string;
}

export interface StashEntry {
  index: number;
  branch: string;
  message: string;
}

export async function preflightCheck(workspaceId: string, sessionId: string): Promise<PreflightStatus> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/preflight`);
  return handleResponse<PreflightStatus>(res);
}

export async function getCurrentBranch(workspaceId: string, sessionId: string): Promise<{ branch: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/current-branch`);
  return handleResponse<{ branch: string }>(res);
}

export async function createBranch(workspaceId: string, sessionId: string, name: string, startPoint?: string): Promise<{ branch: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branches/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, startPoint }),
  });
  return handleResponse<{ branch: string }>(res);
}

export async function switchBranch(workspaceId: string, sessionId: string, branch: string): Promise<{ branch: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branches/switch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
  return handleResponse<{ branch: string }>(res);
}

export async function deleteBranch(workspaceId: string, sessionId: string, branchName: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branches/${encodeURIComponent(branchName)}`, {
    method: 'DELETE',
  });
  await handleVoidResponse(res, 'Failed to delete branch');
}

export async function listStashes(workspaceId: string, sessionId: string): Promise<StashEntry[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/stashes`);
  return handleResponse<StashEntry[]>(res);
}

export async function createStash(workspaceId: string, sessionId: string, message?: string, includeUntracked?: boolean): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/stashes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, includeUntracked }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function applyStash(workspaceId: string, sessionId: string, index: number): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/stashes/${index}/apply`, {
    method: 'POST',
  });
  await handleVoidResponse(res, 'Failed to apply stash');
}

export async function popStash(workspaceId: string, sessionId: string, index: number): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/stashes/${index}/pop`, {
    method: 'POST',
  });
  await handleVoidResponse(res, 'Failed to pop stash');
}

export async function dropStash(workspaceId: string, sessionId: string, index: number): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/stashes/${index}`, {
    method: 'DELETE',
  });
  await handleVoidResponse(res, 'Failed to drop stash');
}

export async function sendSessionMessage(
  workspaceId: string,
  sessionId: string,
  content: string
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// ==================== Review Scorecards ====================

export interface ReviewScorecardDTO {
  id: string;
  sessionId: string;
  reviewType: string;
  scores: string; // JSON string of score array
  summary: string;
  createdAt: string;
}

export interface ReviewScore {
  dimension: string;
  score: number;
  maxScore: number;
  notes?: string;
}

export async function listReviewScorecards(workspaceId: string, sessionId: string): Promise<ReviewScorecardDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/review-scorecards`);
  return handleResponse<ReviewScorecardDTO[]>(res);
}
