import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse, ApiError } from './base';

export interface ReviewCommentDTO {
  id: string;
  sessionId: string;
  filePath: string;
  lineNumber: number;
  title?: string;
  content: string;
  source: 'claude' | 'user';
  author: string;
  severity?: 'error' | 'warning' | 'suggestion' | 'info';
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionType?: 'fixed' | 'ignored';
}

export interface CommentStatsDTO {
  filePath: string;
  total: number;
  unresolved: number;
}

export async function listReviewComments(
  workspaceId: string,
  sessionId: string,
  filePath?: string
): Promise<ReviewCommentDTO[]> {
  const params = filePath ? `?filePath=${encodeURIComponent(filePath)}` : '';
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/comments${params}`
  );
  return handleResponse<ReviewCommentDTO[]>(res);
}

export async function createReviewComment(
  workspaceId: string,
  sessionId: string,
  data: {
    filePath: string;
    lineNumber: number;
    title?: string;
    content: string;
    source: 'claude' | 'user';
    author: string;
    severity?: 'error' | 'warning' | 'suggestion' | 'info';
  }
): Promise<ReviewCommentDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/comments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return handleResponse<ReviewCommentDTO>(res);
}

export async function getReviewCommentStats(
  workspaceId: string,
  sessionId: string
): Promise<CommentStatsDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/comments/stats`
  );
  return handleResponse<CommentStatsDTO[]>(res);
}

export async function updateReviewComment(
  workspaceId: string,
  sessionId: string,
  commentId: string,
  data: { resolved?: boolean; resolvedBy?: string; resolutionType?: 'fixed' | 'ignored' }
): Promise<ReviewCommentDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/comments/${commentId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return handleResponse<ReviewCommentDTO>(res);
}

export async function deleteReviewComment(
  workspaceId: string,
  sessionId: string,
  commentId: string
): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/comments/${commentId}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || 'Delete failed', res.status, text);
  }
}
