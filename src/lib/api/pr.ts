import { getApiBase, fetchWithAuth, handleResponse, ApiError } from './base';

export type CheckStatus = 'pending' | 'success' | 'failure' | 'none';

export interface CheckDetail {
  name: string;
  status: string;
  conclusion: string;
  durationSeconds?: number;
}

export type ReviewDecision = 'approved' | 'changes_requested' | 'review_required' | 'none';

export interface PRDetails {
  number: number;
  state: string;
  title: string;
  body: string;
  htmlUrl: string;
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  checkStatus: CheckStatus;
  checkDetails: CheckDetail[];
  reviewDecision: ReviewDecision;
  requestedReviewers: number;
}

export async function getPRStatus(workspaceId: string, sessionId: string): Promise<PRDetails | null> {
  try {
    const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/pr-status`);
    if (res.status === 404) {
      return null; // No PR found
    }
    return handleResponse<PRDetails>(res);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function refreshPRStatus(workspaceId: string, sessionId: string): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/pr-refresh`, {
    method: 'POST',
  });
  // 202 Accepted — fire-and-forget, result comes via WebSocket
}

// PR Dashboard types
export interface PRLabel {
  name: string;
  color: string;
}

export interface PRDashboardItem {
  // PR metadata
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  isDraft: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  checkStatus: string;
  checkDetails: CheckDetail[];
  labels: PRLabel[];

  // Branch info
  branch: string;
  baseBranch: string;

  // Session info (if created from ChatML)
  sessionId?: string;
  sessionName?: string;

  // Workspace info
  workspaceId: string;
  workspaceName: string;
  repoOwner: string;
  repoName: string;

  // Counts for summary
  checksTotal: number;
  checksPassed: number;
  checksFailed: number;
}

export async function getPRs(workspaceId?: string): Promise<PRDashboardItem[]> {
  const params = workspaceId ? `?workspaceId=${workspaceId}` : '';
  const res = await fetchWithAuth(`${getApiBase()}/api/prs${params}`);
  return handleResponse<PRDashboardItem[]>(res);
}

// Commit Status Types and Functions
export interface CommitStatusRequest {
  state: 'error' | 'failure' | 'pending' | 'success';
  description: string;
  context?: string;
  targetUrl?: string;
}

export interface CommitStatusResponse {
  id: number;
  state: string;
  description: string;
  context: string;
  targetUrl?: string;
  createdAt: string;
  creator?: {
    login: string;
    avatarUrl: string;
  };
}

export interface CombinedStatusResponse {
  state: string; // failure, pending, success
  totalCount: number;
  statuses: CommitStatusResponse[];
}

export async function postCommitStatus(
  workspaceId: string,
  sessionId: string,
  status: CommitStatusRequest
): Promise<CommitStatusResponse> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/status`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(status),
    }
  );
  return handleResponse<CommitStatusResponse>(res);
}

export async function getCommitStatuses(
  workspaceId: string,
  sessionId: string
): Promise<CombinedStatusResponse> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/statuses`
  );
  return handleResponse<CombinedStatusResponse>(res);
}
