import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

export interface BranchDTO {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  lastCommitSha: string;
  lastCommitDate: string;
  lastCommitSubject: string;
  lastAuthor: string;
  lastAuthorEmail?: string;
  aheadMain: number;
  behindMain: number;
  prefix: string;
  // Session linkage (optional)
  sessionId?: string;
  sessionName?: string;
  sessionStatus?: string;
  // PR data (from session)
  prNumber?: number;
  prStatus?: string;
  prUrl?: string;
  checkStatus?: string;
  hasMergeConflict?: boolean;
}

export interface BranchListResponse {
  sessionBranches: BranchDTO[];
  otherBranches: BranchDTO[];
  currentBranch: string;
  total: number;
  hasMore: boolean;
}

export interface BranchListParams {
  includeRemote?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: 'name' | 'date';
}

export async function listBranches(
  workspaceId: string,
  params?: BranchListParams
): Promise<BranchListResponse> {
  const queryParams = new URLSearchParams();
  if (params?.includeRemote !== undefined) {
    queryParams.set('includeRemote', String(params.includeRemote));
  }
  if (params?.limit !== undefined) {
    queryParams.set('limit', String(params.limit));
  }
  if (params?.offset !== undefined) {
    queryParams.set('offset', String(params.offset));
  }
  if (params?.search) {
    queryParams.set('search', params.search);
  }
  if (params?.sortBy) {
    queryParams.set('sortBy', params.sortBy);
  }

  const queryString = queryParams.toString();
  const url = `${getApiBase()}/api/repos/${workspaceId}/branches${queryString ? `?${queryString}` : ''}`;
  const res = await fetchWithAuth(url);
  return handleResponse<BranchListResponse>(res);
}

// Resolve PR from URL
export interface ResolvePRResponse {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  state: string;
  isDraft: boolean;
  labels: string[];
  reviewers: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  matchedWorkspaceId: string | null;
  htmlUrl: string;
}

export async function resolvePR(url: string): Promise<ResolvePRResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/resolve-pr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return handleResponse<ResolvePRResponse>(res);
}

// Branch cleanup types and API
export type CleanupCategory = 'merged' | 'stale' | 'orphaned' | 'safe';

export interface CleanupCandidate {
  name: string;
  isRemote: boolean;
  category: CleanupCategory;
  reason: string;
  lastCommitDate: string;
  lastAuthor: string;
  hasLocalAndRemote: boolean;
  sessionId?: string;
  sessionName?: string;
  sessionStatus?: string;
  isProtected: boolean;
  deletable: boolean;
}

export interface CleanupAnalysisResponse {
  candidates: CleanupCandidate[];
  summary: Record<string, number>;
  protectedCount: number;
  totalAnalyzed: number;
}

export interface CleanupBranchTarget {
  name: string;
  deleteLocal: boolean;
  deleteRemote: boolean;
}

export interface CleanupBranchResult {
  name: string;
  deletedLocal: boolean;
  deletedRemote: boolean;
  error?: string;
}

export interface CleanupResult {
  succeeded: CleanupBranchResult[];
  failed: CleanupBranchResult[];
}

export async function analyzeBranchCleanup(
  workspaceId: string,
  params: { staleDaysThreshold?: number; includeRemote?: boolean }
): Promise<CleanupAnalysisResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/branches/analyze-cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleResponse<CleanupAnalysisResponse>(res);
}

export async function executeBranchCleanup(
  workspaceId: string,
  branches: CleanupBranchTarget[]
): Promise<CleanupResult> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/branches/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branches }),
  });
  return handleResponse<CleanupResult>(res);
}

export async function pruneStaleBranches(workspaceId: string): Promise<{ success: boolean; deletedLocalBranches?: string[] }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/branches/prune`, {
    method: 'POST',
  });
  return handleResponse<{ success: boolean; deletedLocalBranches?: string[] }>(res);
}

// Branch sync DTOs and functions
export interface SyncCommitDTO {
  sha: string;
  subject: string;
}

export interface BranchSyncStatusDTO {
  behindBy: number;
  commits: SyncCommitDTO[];
  baseBranch: string;
  lastChecked: string;
}

export interface BranchSyncResultDTO {
  success: boolean;
  newBaseSha?: string;
  conflictFiles?: string[];
  errorMessage?: string;
}

export async function getBranchSyncStatus(
  workspaceId: string,
  sessionId: string
): Promise<BranchSyncStatusDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branch-sync`
  );
  return handleResponse<BranchSyncStatusDTO>(res);
}

export async function syncBranch(
  workspaceId: string,
  sessionId: string,
  operation: 'rebase' | 'merge'
): Promise<BranchSyncResultDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branch-sync`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation }),
    }
  );
  return handleResponse<BranchSyncResultDTO>(res);
}

export async function abortBranchSync(
  workspaceId: string,
  sessionId: string
): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branch-sync/abort`,
    { method: 'POST' }
  );
  await handleVoidResponse(res, 'Failed to abort branch sync');
}
