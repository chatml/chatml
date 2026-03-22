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
  sprintPhase?: string | null;
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
    sprintPhase: (session.sprintPhase || null) as import('@/lib/types').SprintPhase | null,
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
  data: { name?: string; branch?: string; branchPrefix?: string; worktreePath?: string; task?: string; checkoutExisting?: boolean; systemMessage?: string } = {}
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
