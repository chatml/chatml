import { HEALTH_CHECK_REQUEST_TIMEOUT_MS } from '@/lib/constants';
import { getAuthToken } from '@/lib/auth-token';
import { getBackendPortSync, getBackendPort, initBackendPort } from '@/lib/backend-port';
import type { McpServerConfig, AttachmentContextType, AttachmentContextMeta } from '@/lib/types';

// Re-export for convenience
export { initBackendPort };

// Get API base URL dynamically based on the backend port
export function getApiBase(): string {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const port = getBackendPortSync();
    return `http://localhost:${port}`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876';
}

// Custom error class for API errors
export class ApiError extends Error {
  public code?: string;

  constructor(
    message: string,
    public status: number,
    public response?: string
  ) {
    super(message);
    this.name = 'ApiError';

    // Try to parse a structured error code from the JSON response body
    if (response) {
      try {
        const parsed = JSON.parse(response);
        if (parsed.code) {
          this.code = parsed.code;
        }
        if (parsed.error) {
          this.message = parsed.error;
        }
      } catch {
        // Response is not JSON, ignore
      }
    }
  }
}

/** Well-known backend error codes */
export const ErrorCode = {
  WORKTREE_NOT_FOUND: 'WORKTREE_NOT_FOUND',
} as const;

// Retry configuration for transient network failures.
// Retries handle brief backend hiccups (sleep/wake, sidecar restart, resource pressure)
// so callers don't have to implement their own retry logic.
const FETCH_RETRY_COUNT = 2; // 2 retries = 3 total attempts
const FETCH_RETRY_BASE_DELAY_MS = 300;

// Fetch helper that adds authentication token for Tauri builds.
// Automatically retries on network-level TypeErrors (e.g. server momentarily unreachable)
// with exponential backoff. Only throws ApiError after all retries are exhausted.
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_COUNT; attempt++) {
    try {
      return await fetch(url, { ...options, headers });
    } catch (err) {
      lastError = err;
      if (!(err instanceof TypeError)) {
        // Not a network error — don't retry
        throw err;
      }
      // Don't retry if the request was already aborted (e.g. AbortController)
      if (options.signal?.aborted) {
        break;
      }
      if (attempt < FETCH_RETRY_COUNT) {
        const delay = FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  // All retries exhausted
  if (lastError instanceof TypeError) {
    throw new ApiError('Cannot connect to backend. Is the server running?', 0);
  }
  throw lastError;
}

// Helper to handle API responses consistently
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
  return res.json();
}

// Helper to handle API responses for void-returning operations
async function handleVoidResponse(res: Response, errorMessage: string = 'Operation failed'): Promise<void> {
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || errorMessage, res.status, text);
  }
}

// Backend DTOs
export interface RepoDTO {
  id: string;
  name: string;
  path: string;
  branch: string;
  remote: string;
  branchPrefix: string;
  customPrefix: string;
  createdAt: string;
}

export interface FileNodeDTO {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNodeDTO[];
  truncated?: boolean;
}

export async function listRepos(): Promise<RepoDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos`);
  return handleResponse<RepoDTO[]>(res);
}

export async function addRepo(path: string): Promise<RepoDTO> {
  try {
    const res = await fetchWithAuth(`${getApiBase()}/api/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return handleResponse<RepoDTO>(res);
  } catch (err) {
    if (err instanceof TypeError && err.message === 'Load failed') {
      throw new Error('Cannot connect to backend. Is the server running?');
    }
    throw err;
  }
}

export async function deleteRepo(id: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${id}`, { method: 'DELETE' });
  await handleVoidResponse(res, 'Failed to delete workspace');
}

export interface RepoDetailsDTO extends RepoDTO {
  remoteUrl?: string;
  githubOwner?: string;
  githubRepo?: string;
  workspacesPath?: string;
}

export async function getRepoDetails(id: string): Promise<RepoDetailsDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${id}/details`);
  return handleResponse<RepoDetailsDTO>(res);
}

export async function updateRepoSettings(id: string, settings: {
  branch?: string;
  remote?: string;
  branchPrefix?: string;
  customPrefix?: string;
}): Promise<RepoDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return handleResponse<RepoDTO>(res);
}

export interface RepoRemotesDTO {
  remotes: string[];
  branches: Record<string, string[]>;
}

export async function getRepoRemotes(id: string): Promise<RepoRemotesDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${id}/remotes`);
  return handleResponse<RepoRemotesDTO>(res);
}

export async function listRepoFiles(repoId: string, depth: number | 'all' = 1): Promise<FileNodeDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${repoId}/files?depth=${depth}`);
  return handleResponse<FileNodeDTO[]>(res);
}

export interface FileContentDTO {
  path: string;
  name: string;
  content: string;
  size: number;
}

export async function getRepoFileContent(repoId: string, filePath: string): Promise<FileContentDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`);
  return handleResponse<FileContentDTO>(res);
}

export interface FileDiffDTO {
  path: string;
  oldContent: string;
  newContent: string;
  oldFilename: string;
  newFilename: string;
  hasConflict: boolean;
  isDeleted: boolean;
  truncated?: boolean;
  unifiedDiff?: string;
}

export async function getFileDiff(repoId: string, filePath: string, baseBranch?: string): Promise<FileDiffDTO> {
  const params = new URLSearchParams({ path: filePath });
  if (baseBranch) {
    params.append('base', baseBranch);
  }
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${repoId}/diff?${params.toString()}`);
  return handleResponse<FileDiffDTO>(res);
}

export async function getSessionFileDiff(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<FileDiffDTO> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/diff?${params.toString()}`,
    signal ? { signal } : undefined,
  );
  return handleResponse<FileDiffDTO>(res);
}

// Session-aware file APIs (for complete session isolation)
export async function getSessionFileContent(
  workspaceId: string,
  sessionId: string,
  filePath: string
): Promise<FileContentDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`
  );
  return handleResponse<FileContentDTO>(res);
}

export async function listSessionFiles(
  workspaceId: string,
  sessionId: string,
  depth: number | 'all' = 'all'
): Promise<FileNodeDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/files?maxDepth=${depth}`
  );
  return handleResponse<FileNodeDTO[]>(res);
}

// User commands from .claude/commands/
export interface UserCommandDTO {
  name: string;
  description: string;
  filePath: string;
  content: string;
}

export async function listUserCommands(
  workspaceId: string,
  sessionId: string
): Promise<UserCommandDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/commands`
  );
  return handleResponse<UserCommandDTO[]>(res);
}

// Session DTOs and functions
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

// Branch types
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

// Avatar types and API
export interface AvatarResponse {
  avatars: Record<string, string>;
}

export async function getAvatars(emails: string[]): Promise<Record<string, string>> {
  if (emails.length === 0) {
    return {};
  }
  const emailsParam = emails.join(',');
  const url = `${getApiBase()}/api/avatars?emails=${encodeURIComponent(emailsParam)}`;
  const res = await fetchWithAuth(url);
  const response = await handleResponse<AvatarResponse>(res);
  return response.avatars;
}

export interface FileChangeDTO {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
}

export async function getSessionChanges(workspaceId: string, sessionId: string): Promise<FileChangeDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/changes`);
  return handleResponse<FileChangeDTO[]>(res);
}

export interface BranchCommitDTO {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
  files: FileChangeDTO[];
}

export interface BranchStatsDTO {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface BranchChangesResponseDTO {
  commits: BranchCommitDTO[];
  branchStats?: BranchStatsDTO;
  allChanges?: FileChangeDTO[];
}

export async function getSessionBranchCommits(workspaceId: string, sessionId: string): Promise<BranchChangesResponseDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branch-commits`);
  return handleResponse<BranchChangesResponseDTO>(res);
}

// Git status types matching backend response
export interface GitStatusDTO {
  workingDirectory: {
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    totalUncommitted: number;
    hasChanges: boolean;
  };
  sync: {
    aheadBy: number;
    behindBy: number;
    baseBranch: string;
    remoteBranch?: string;
    hasRemote: boolean;
    diverged: boolean;
    unpushedCommits: number;
  };
  inProgress: {
    type: 'none' | 'rebase' | 'merge' | 'cherry-pick' | 'revert';
    current?: number;
    total?: number;
  };
  conflicts: {
    hasConflicts: boolean;
    count: number;
    files: string[];
  };
  stash: {
    count: number;
  };
}

export async function getGitStatus(workspaceId: string, sessionId: string): Promise<GitStatusDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/git-status`);
  return handleResponse<GitStatusDTO>(res);
}

// File commit history types
export interface FileCommitDTO {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
  additions: number;
  deletions: number;
}

export interface FileHistoryResponse {
  commits: FileCommitDTO[];
  total: number;
  truncated: boolean;
}

export async function getFileCommitHistory(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  signal?: AbortSignal
): Promise<FileHistoryResponse> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-history?${params.toString()}`,
    { signal }
  );
  return handleResponse<FileHistoryResponse>(res);
}

export async function getFileAtCommit(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  commitSha: string
): Promise<FileContentDTO> {
  const params = new URLSearchParams({ path: filePath, ref: commitSha });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-at-ref?${params.toString()}`
  );
  return handleResponse<FileContentDTO>(res);
}

// PR Details types
export type CheckStatus = 'pending' | 'success' | 'failure' | 'none';

export interface CheckDetail {
  name: string;
  status: string;
  conclusion: string;
  durationSeconds?: number;
}

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
export interface CheckDetail {
  name: string;
  status: string; // "queued", "in_progress", "completed"
  conclusion: string; // "success", "failure", "neutral", "cancelled", "skipped", "timed_out", "action_required"
  durationSeconds?: number; // Duration in seconds (only for completed checks)
}

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

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface HealthCheckResult {
  success: boolean;
  error?: string;
  attempts: number;
}

/**
 * Check backend health with exponential backoff retry
 * @param maxRetries Maximum number of retry attempts
 * @param initialDelay Initial delay in ms (doubles each retry)
 * @param onAttempt Callback called before each attempt with attempt number
 */
export async function checkHealthWithRetry(
  maxRetries: number = 10,
  initialDelay: number = 500,
  onAttempt?: (attempt: number) => void
): Promise<HealthCheckResult> {
  // Ensure we have the backend port before making health checks
  // This is especially important for Tauri builds with dynamic port allocation
  await getBackendPort();

  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    onAttempt?.(attempt);

    try {
      const res = await fetch(`${getApiBase()}/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_REQUEST_TIMEOUT_MS)
      });

      if (res.ok) {
        return { success: true, attempts: attempt };
      }
    } catch {
      // Connection failed, will retry
    }

    // Don't wait after the last attempt
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 5000); // Exponential backoff, max 5s
    }
  }

  return {
    success: false,
    error: 'Backend service did not respond after multiple attempts',
    attempts: maxRetries
  };
}

// Conversation DTOs and functions
export interface ConversationDTO {
  id: string;
  sessionId: string;
  type: 'task' | 'review' | 'chat';
  name: string;
  status: 'active' | 'idle' | 'completed';
  model?: string;
  messages: MessageDTO[];
  messageCount?: number;
  toolSummary: ToolActionDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface MessagePageDTO {
  messages: MessageDTO[];
  hasMore: boolean;
  totalCount: number;
  oldestPosition?: number;
}

export interface SetupInfoDTO {
  sessionName: string;
  branchName: string;
  originBranch: string;
  fileCount?: number;
}

export interface RunStatsDTO {
  toolCalls: number;
  toolsByType: Record<string, number>;
  subAgents: number;
  filesRead: number;
  filesWritten: number;
  bashCommands: number;
  webSearches: number;
  totalToolDurationMs: number;
}

export interface TokenUsageDTO {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ModelUsageInfoDTO {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

export interface PermissionDenialDTO {
  toolName: string;
  toolUseId: string;
}

export interface RunSummaryDTO {
  success: boolean;
  cost?: number;
  turns?: number;
  durationMs?: number;
  stats?: RunStatsDTO;
  errors?: unknown[];
  usage?: TokenUsageDTO;
  modelUsage?: Record<string, ModelUsageInfoDTO>;
  limitExceeded?: 'budget' | 'turns';
  permissionDenials?: PermissionDenialDTO[];
}

export interface AttachmentDTO {
  id: string;
  type: 'file' | 'image';
  name: string;
  path?: string;
  mimeType: string;
  size: number;
  lineCount?: number;
  width?: number;
  height?: number;
  base64Data?: string;
  preview?: string;
  isInstruction?: boolean; // Frontend-only: not persisted by the backend
  contextType?: AttachmentContextType;
  contextMeta?: AttachmentContextMeta;
}

export interface ToolUsageDTO {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  metadata?: import('@/lib/types').ToolMetadata;
}

export interface TimelineEntryDTO {
  type: 'text' | 'tool' | 'thinking' | 'plan' | 'status';
  content?: string;
  toolId?: string;
  variant?: 'thinking_enabled' | 'config' | 'info';
}

export interface MessageDTO {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  setupInfo?: SetupInfoDTO;
  runSummary?: RunSummaryDTO;
  attachments?: AttachmentDTO[];
  toolUsage?: ToolUsageDTO[];
  thinkingContent?: string;
  durationMs?: number;
  timeline?: TimelineEntryDTO[];
  planContent?: string;
  checkpointUuid?: string;
  timestamp: string;
}

export interface ToolActionDTO {
  id: string;
  tool: string;
  target: string;
  success: boolean;
}

/** Map a ConversationDTO from the API to a store-compatible Conversation shape. */
export function toStoreConversation(dto: ConversationDTO): import('@/lib/types').Conversation {
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    type: dto.type,
    name: dto.name,
    status: dto.status,
    model: dto.model,
    messages: (dto.messages || []).map((m) => toStoreMessage(m, dto.id)),
    messageCount: dto.messageCount,
    toolSummary: (dto.toolSummary || []).map((t) => ({
      id: t.id,
      tool: t.tool,
      target: t.target,
      success: t.success,
    })),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/** Map a MessageDTO to a store-compatible Message shape. */
export function toStoreMessage(dto: MessageDTO, conversationId: string, opts?: { compacted?: boolean }): import('@/lib/types').Message {
  return {
    id: dto.id,
    conversationId,
    role: dto.role,
    content: dto.content,
    setupInfo: dto.setupInfo,
    runSummary: dto.runSummary,
    attachments: dto.attachments,
    toolUsage: dto.toolUsage,
    thinkingContent: dto.thinkingContent,
    durationMs: dto.durationMs,
    timeline: dto.timeline as import('@/lib/types').TimelineEntry[] | undefined,
    planContent: dto.planContent,
    checkpointUuid: dto.checkpointUuid,
    timestamp: dto.timestamp,
    compacted: opts?.compacted,
  };
}

export async function listConversations(
  workspaceId: string,
  sessionId: string
): Promise<ConversationDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/conversations`
  );
  return handleResponse<ConversationDTO[]>(res);
}

export async function listWorkspaceConversations(
  workspaceId: string
): Promise<ConversationDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/conversations`
  );
  return handleResponse<ConversationDTO[]>(res);
}

export async function createConversation(
  workspaceId: string,
  sessionId: string,
  data: {
    type?: 'task' | 'review' | 'chat';
    message?: string;
    model?: string;
    planMode?: boolean;
    maxThinkingTokens?: number;
    effort?: string;
    attachments?: AttachmentDTO[];
    summaryIds?: string[];
    linearIssue?: {
      identifier: string;
      title: string;
      description?: string;
      stateName: string;
      labels: string[];
    };
    linkedWorkspaceIds?: string[];
  }
): Promise<ConversationDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/conversations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return handleResponse<ConversationDTO>(res);
}

export async function getConversation(convId: string): Promise<ConversationDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}`);
  return handleResponse<ConversationDTO>(res);
}

export async function getConversationMessages(
  convId: string,
  opts?: { before?: number; limit?: number; compact?: boolean }
): Promise<MessagePageDTO> {
  const params = new URLSearchParams();
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.compact) params.set('mode', 'compact');
  const qs = params.toString();
  const url = `${getApiBase()}/api/conversations/${convId}/messages${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(url);
  return handleResponse<MessagePageDTO>(res);
}

export async function getMessage(convId: string, msgId: string): Promise<MessageDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/messages/${msgId}`);
  return handleResponse<MessageDTO>(res);
}

export async function sendConversationMessage(
  convId: string,
  content: string,
  attachments?: AttachmentDTO[],
  model?: string,
  mentionedFiles?: string[],
  planMode?: boolean
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, attachments, model, mentionedFiles, planMode }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function addSystemMessage(convId: string, content: string): Promise<{ id: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/system-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return handleResponse<{ id: string }>(res);
}

export async function stopConversation(convId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/stop`, { method: 'POST' });
  await handleVoidResponse(res, 'Failed to stop conversation');
}

export async function getConversationDropStats(convId: string): Promise<{ droppedMessages: number }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/drop-stats`);
  return handleResponse(res);
}

export async function getActiveStreamingConversations(): Promise<{ conversationIds: string[] }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/active-streaming`);
  return handleResponse(res);
}

export interface SnapshotSubAgent {
  agentId: string;
  agentType: string;
  parentToolUseId?: string;
  description?: string;
  output?: string;
  startTime: number;
  activeTools: { id: string; tool: string; startTime: number }[];
  completed: boolean;
}

export interface StreamingSnapshotDTO {
  text: string;
  textSegments?: { text: string; timestamp: number }[];
  activeTools: { id: string; tool: string; startTime: number }[];
  thinking?: string;
  isThinking: boolean;
  planModeActive: boolean;
  subAgents?: SnapshotSubAgent[];
  pendingPlanApproval?: { requestId: string; planContent?: string; timestamp: number } | null;
  pendingUserQuestion?: { requestId: string; questions: import('./types').UserQuestion[]; timestamp: number } | null;
}

export async function getStreamingSnapshot(convId: string): Promise<StreamingSnapshotDTO | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/streaming-snapshot`);
  return handleResponse(res);
}

export interface InterruptedConversationDTO {
  id: string;
  sessionId: string;
  agentSessionId: string;
  snapshot: StreamingSnapshotDTO | null;
}

export async function getInterruptedConversations(): Promise<InterruptedConversationDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/interrupted`);
  return handleResponse(res);
}

export async function resumeAgent(convId: string): Promise<{ status: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/resume-agent`, { method: 'POST' });
  return handleResponse(res);
}

export async function clearConversationSnapshot(convId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/clear-snapshot`, { method: 'POST' });
  await handleVoidResponse(res, 'Failed to clear snapshot');
}

export async function deleteConversation(convId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}`, { method: 'DELETE' });
  await handleVoidResponse(res, 'Failed to delete conversation');
}

export async function setConversationPlanMode(convId: string, enabled: boolean): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/plan-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function setConversationMaxThinkingTokens(convId: string, maxThinkingTokens: number): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/max-thinking-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxThinkingTokens }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function approvePlan(convId: string, requestId: string, approved: boolean, reason?: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/approve-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, approved, ...(reason && { reason }) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Answer a pending AskUserQuestion from the agent
export async function answerConversationQuestion(
  convId: string,
  requestId: string,
  answers: Record<string, string>
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/answer-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, answers }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Summary DTOs and functions
export interface SummaryDTO {
  id: string;
  conversationId: string;
  sessionId: string;
  conversationName?: string;
  content: string;
  status: 'generating' | 'completed' | 'failed';
  errorMessage?: string;
  messageCount: number;
  createdAt: string;
}

export async function generateSummary(convId: string): Promise<SummaryDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/summary`, {
    method: 'POST',
  });
  return handleResponse<SummaryDTO>(res);
}

export async function getConversationSummary(convId: string): Promise<SummaryDTO | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/summary`);
  if (res.status === 404) return null;
  return handleResponse<SummaryDTO>(res);
}

export async function listSessionSummaries(
  workspaceId: string,
  sessionId: string
): Promise<SummaryDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/summaries`
  );
  return handleResponse<SummaryDTO[]>(res);
}

// GitHub Issue DTOs and functions

export interface GitHubIssueLabel {
  name: string;
  color: string;
}

export interface GitHubIssueUser {
  login: string;
  avatarUrl: string;
}

export interface GitHubIssueListItem {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  labels: GitHubIssueLabel[];
  user: GitHubIssueUser;
  assignees: GitHubIssueUser[];
  comments: number;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssueDetails extends GitHubIssueListItem {
  body: string;
  milestone?: {
    title: string;
    number: number;
  };
}

export interface SearchGitHubIssuesResult {
  totalCount: number;
  issues: GitHubIssueListItem[];
}

export async function listGitHubIssues(workspaceId: string): Promise<GitHubIssueListItem[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/issues`);
  return handleResponse<GitHubIssueListItem[]>(res);
}

export async function searchGitHubIssues(workspaceId: string, query: string): Promise<SearchGitHubIssuesResult> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/issues/search?q=${encodeURIComponent(query)}`
  );
  return handleResponse<SearchGitHubIssuesResult>(res);
}

export async function getGitHubIssueDetails(workspaceId: string, issueNumber: number): Promise<GitHubIssueDetails> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/issues/${issueNumber}`);
  return handleResponse<GitHubIssueDetails>(res);
}

// Linear Issue DTOs and functions

export interface LinearIssueDTO {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  stateName: string;
  labels: string[];
  assignee?: string;
  project?: string;
}

export async function listMyLinearIssues(): Promise<LinearIssueDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/auth/linear/issues`);
  return handleResponse<LinearIssueDTO[]>(res);
}

export async function searchLinearIssues(query: string): Promise<LinearIssueDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/auth/linear/issues/search?q=${encodeURIComponent(query)}`
  );
  return handleResponse<LinearIssueDTO[]>(res);
}

// File Tab DTOs and functions
export interface FileTabDTO {
  id: string;
  workspaceId: string;
  sessionId?: string;
  path: string;
  viewMode: 'file' | 'diff';
  isPinned: boolean;
  position: number;
  openedAt: string;
  lastAccessedAt: string;
}

export async function listFileTabs(workspaceId: string): Promise<FileTabDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/tabs`);
  return handleResponse<FileTabDTO[]>(res);
}

export async function saveFileTabs(
  workspaceId: string,
  tabs: FileTabDTO[]
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/tabs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tabs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function deleteFileTab(workspaceId: string, tabId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/tabs/${tabId}`, { method: 'DELETE' });
  await handleVoidResponse(res, 'Failed to delete file tab');
}

// Attachment data — returns base64 content, or null when the DB has no data for this attachment.
export async function fetchAttachmentData(attachmentId: string): Promise<string | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/attachments/${encodeURIComponent(attachmentId)}/data`);
  const json = await handleResponse<{ base64Data: string }>(res);
  return json.base64Data || null;
}

// File save function
export async function saveFile(
  workspaceId: string,
  path: string,
  content: string,
  sessionId?: string
): Promise<void> {
  const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/file/save${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Review Comment DTOs and functions
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

// ============================================
// Settings API
// ============================================

export async function getWorkspacesBasePath(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/workspaces-base-dir`);
  const data = await handleResponse<{ path: string }>(res);
  return data.path;
}

export async function setWorkspacesBasePath(path: string): Promise<string> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/workspaces-base-dir`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }
  );
  const data = await handleResponse<{ path: string }>(res);
  return data.path;
}

export async function getEnvSettings(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/env`);
  const data = await handleResponse<{ envVars: string }>(res);
  return data.envVars;
}

export async function getClaudeEnv(): Promise<Record<string, string>> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/claude-env`);
  const data = await handleResponse<{ env: Record<string, string> }>(res);
  return data.env;
}

export async function setEnvSettings(envVars: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/env`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars }),
    }
  );
  await handleResponse(res);
}

// =============================================================================
// Anthropic API Key
// =============================================================================

export async function getAnthropicApiKey(): Promise<{ configured: boolean; maskedKey: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/anthropic-api-key`);
  return handleResponse<{ configured: boolean; maskedKey: string }>(res);
}

export async function getClaudeAuthStatus(): Promise<{
  configured: boolean;
  hasStoredKey: boolean;
  hasEnvKey: boolean;
  hasCliCredentials: boolean;
  hasBedrock: boolean;
  credentialSource: string;
}> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/claude-auth-status`);
  return handleResponse(res);
}

export async function setAnthropicApiKey(apiKey: string): Promise<{ configured: boolean; maskedKey: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/anthropic-api-key`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    }
  );
  return handleResponse<{ configured: boolean; maskedKey: string }>(res);
}

// =============================================================================
// GitHub Personal Access Token
// =============================================================================

export async function getGitHubPersonalToken(): Promise<{ configured: boolean; maskedToken: string; username: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/github-personal-token`);
  return handleResponse<{ configured: boolean; maskedToken: string; username: string }>(res);
}

export async function setGitHubPersonalToken(token: string): Promise<{ configured: boolean; maskedToken: string; username: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/github-personal-token`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }
  );
  return handleResponse<{ configured: boolean; maskedToken: string; username: string }>(res);
}

// =============================================================================
// CI / GitHub Actions Types and Functions
// =============================================================================

export interface WorkflowRunDTO {
  id: number;
  name: string;
  status: string; // queued, in_progress, completed, waiting, requested, pending
  conclusion: string; // success, failure, neutral, cancelled, skipped, timed_out, action_required, stale
  headSha: string;
  headBranch: string;
  htmlUrl: string;
  jobsUrl: string;
  logsUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobStepDTO {
  name: string;
  status: string; // queued, in_progress, completed
  conclusion: string; // success, failure, neutral, cancelled, skipped
  number: number;
  startedAt: string;
  completedAt: string;
}

export interface WorkflowJobDTO {
  id: number;
  runId: number;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
  htmlUrl: string;
  steps: JobStepDTO[];
}

export interface CIAnalysisResult {
  errorType: string;
  summary: string;
  rootCause: string;
  affectedFiles: string[];
  suggestedFix?: {
    description: string;
    patches: Array<{ file: string; diff: string }>;
  };
  confidence: number;
  rawLogs?: string;
}

export async function getCIRuns(
  workspaceId: string,
  sessionId: string
): Promise<WorkflowRunDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs`
  );
  return handleResponse<WorkflowRunDTO[]>(res);
}

export async function getCIRun(
  workspaceId: string,
  sessionId: string,
  runId: number
): Promise<WorkflowRunDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs/${runId}`
  );
  return handleResponse<WorkflowRunDTO>(res);
}

export async function getCIJobs(
  workspaceId: string,
  sessionId: string,
  runId: number
): Promise<WorkflowJobDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs/${runId}/jobs`
  );
  return handleResponse<WorkflowJobDTO[]>(res);
}

export async function getCIJobLogs(
  workspaceId: string,
  sessionId: string,
  jobId: number
): Promise<{ jobId: number; logs: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/jobs/${jobId}/logs`
  );
  return handleResponse<{ jobId: number; logs: string }>(res);
}

export async function rerunCI(
  workspaceId: string,
  sessionId: string,
  runId: number,
  failedOnly: boolean = false
): Promise<void> {
  const params = failedOnly ? '?failedOnly=true' : '';
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs/${runId}/rerun${params}`,
    { method: 'POST' }
  );
  await handleVoidResponse(res, 'Failed to rerun CI workflow');
}

export async function analyzeCIFailure(
  workspaceId: string,
  sessionId: string,
  runId: number,
  jobId: number
): Promise<CIAnalysisResult> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, jobId }),
    }
  );
  return handleResponse<CIAnalysisResult>(res);
}

// =============================================================================
// CI Failure Context (aggregated failures for forwarding to AI)
// =============================================================================

export interface FailedJobContext {
  jobId: number;
  jobName: string;
  jobUrl: string;
  failedSteps: string[];
  logs: string;
  logLines: number;
  truncated: boolean;
}

export interface FailedRunContext {
  runId: number;
  runName: string;
  runUrl: string;
  failedJobs: FailedJobContext[];
}

export interface CIFailureContextDTO {
  branch: string;
  failedRuns: FailedRunContext[];
  totalFailed: number;
  truncated: boolean;
}

export async function getCIFailureContext(
  workspaceId: string,
  sessionId: string
): Promise<CIFailureContextDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/failure-context`
  );
  return handleResponse<CIFailureContextDTO>(res);
}

// =============================================================================
// Commit Status Types and Functions
// =============================================================================

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

// ============================================================================
// PR Templates
// ============================================================================

export async function getPRTemplate(workspaceId: string): Promise<string> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/pr-template`
  );
  const data = await handleResponse<{ template: string }>(res);
  return data.template;
}

export async function setPRTemplate(workspaceId: string, template: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/pr-template`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    }
  );
  await handleVoidResponse(res, 'Failed to save PR template');
}

export async function getGlobalPRTemplate(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/pr-template`);
  const data = await handleResponse<{ template: string }>(res);
  return data.template;
}

export async function setGlobalPRTemplate(template: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/pr-template`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
  await handleVoidResponse(res, 'Failed to save PR template');
}

// ---------------------------------------------------------------------------
// Review Prompt Overrides
// ---------------------------------------------------------------------------

export async function getGlobalReviewPrompts(): Promise<Record<string, string>> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/review-prompts`);
  const data = await handleResponse<{ prompts: Record<string, string> }>(res);
  return data.prompts;
}

export async function setGlobalReviewPrompts(prompts: Record<string, string>): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/review-prompts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts }),
  });
  await handleVoidResponse(res, 'Failed to save review prompts');
}

export async function getWorkspaceReviewPrompts(workspaceId: string): Promise<Record<string, string>> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/review-prompts`
  );
  const data = await handleResponse<{ prompts: Record<string, string> }>(res);
  return data.prompts;
}

export async function setWorkspaceReviewPrompts(
  workspaceId: string,
  prompts: Record<string, string>,
): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/review-prompts`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts }),
    },
  );
  await handleVoidResponse(res, 'Failed to save workspace review prompts');
}

// ---------------------------------------------------------------------------
// Action Template Overrides
// ---------------------------------------------------------------------------

export async function getGlobalActionTemplates(): Promise<Record<string, string>> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/action-templates`);
  const data = await handleResponse<{ templates: Record<string, string> }>(res);
  return data.templates;
}

export async function setGlobalActionTemplates(templates: Record<string, string>): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/action-templates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates }),
  });
  await handleVoidResponse(res, 'Failed to save action templates');
}

export async function getWorkspaceActionTemplates(workspaceId: string): Promise<Record<string, string>> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/action-templates`
  );
  const data = await handleResponse<{ templates: Record<string, string> }>(res);
  return data.templates;
}

export async function setWorkspaceActionTemplates(
  workspaceId: string,
  templates: Record<string, string>,
): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/action-templates`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates }),
    },
  );
  await handleVoidResponse(res, 'Failed to save workspace action templates');
}

// ---------------------------------------------------------------------------
// Custom Instructions
// ---------------------------------------------------------------------------

export async function getCustomInstructions(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/custom-instructions`);
  const data = await handleResponse<{ instructions: string }>(res);
  return data.instructions;
}

export async function setCustomInstructions(instructions: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/custom-instructions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  });
  await handleVoidResponse(res, 'Failed to save custom instructions');
}

// ==================== Memory API ====================

export interface MemoryFileInfo {
  name: string;
  size: number;
}

export interface MemoryFileDTO {
  name: string;
  content: string;
  size: number;
}

export async function listMemoryFiles(workspaceId: string): Promise<MemoryFileInfo[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/memory`);
  return handleResponse<MemoryFileInfo[]>(res);
}

export async function getMemoryFile(workspaceId: string, name: string): Promise<MemoryFileDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/memory/file?name=${encodeURIComponent(name)}`
  );
  return handleResponse<MemoryFileDTO>(res);
}

export async function saveMemoryFile(workspaceId: string, name: string, content: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/memory/file`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    }
  );
  await handleVoidResponse(res, 'Failed to save memory file');
}

export async function deleteMemoryFile(workspaceId: string, name: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/memory/file?name=${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  );
  await handleVoidResponse(res, 'Failed to delete memory file');
}

// ==================== Scripts API ====================

import type { ChatMLConfig, ScriptRun } from '@/lib/types';

export async function getWorkspaceConfig(workspaceId: string): Promise<ChatMLConfig> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/config`
  );
  return handleResponse<ChatMLConfig>(res);
}

export async function updateWorkspaceConfig(workspaceId: string, config: ChatMLConfig): Promise<ChatMLConfig> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/config`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }
  );
  return handleResponse<ChatMLConfig>(res);
}

export async function detectWorkspaceConfig(workspaceId: string): Promise<ChatMLConfig> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/config/detect`
  );
  return handleResponse<ChatMLConfig>(res);
}

export async function runScript(workspaceId: string, sessionId: string, scriptKey: string): Promise<{ runId: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/scripts/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptKey }),
    }
  );
  return handleResponse<{ runId: string }>(res);
}

export async function rerunSetupScripts(workspaceId: string, sessionId: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/scripts/setup`,
    { method: 'POST' }
  );
  await handleVoidResponse(res, 'Failed to start setup scripts');
}

export async function stopScript(workspaceId: string, sessionId: string, runId: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/scripts/stop`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    }
  );
  await handleVoidResponse(res, 'Failed to stop script');
}

export async function getScriptRuns(workspaceId: string, sessionId: string): Promise<ScriptRun[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/scripts/runs`
  );
  return handleResponse<ScriptRun[]>(res);
}

// ============================================================================
// Skills API
// ============================================================================

export type SkillCategory = 'development' | 'documentation' | 'security' | 'version-control';

export interface SkillDTO {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  author: string;
  version: string;
  preview: string;
  skillPath: string;
  createdAt: string;
  updatedAt: string;
  installed: boolean;
  installedAt?: string;
}

export interface SkillListParams {
  category?: string;
  search?: string;
}

export interface SkillContentResponse {
  id: string;
  name: string;
  skillPath: string;
  content: string;
}

// List all skills with optional filtering
export async function listSkills(params?: SkillListParams, signal?: AbortSignal): Promise<SkillDTO[]> {
  const queryParams = new URLSearchParams();
  if (params?.category) queryParams.set('category', params.category);
  if (params?.search) queryParams.set('search', params.search);
  const qs = queryParams.toString();
  const url = `${getApiBase()}/api/skills${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(url, { signal });
  return handleResponse<SkillDTO[]>(res);
}

// List only installed skills
export async function listInstalledSkills(): Promise<SkillDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/skills/installed`);
  return handleResponse<SkillDTO[]>(res);
}

// Install a skill
export async function installSkill(skillId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/skills/${skillId}/install`, {
    method: 'POST',
  });
  await handleVoidResponse(res, 'Failed to install skill');
}

// Uninstall a skill
export async function uninstallSkill(skillId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/skills/${skillId}/uninstall`, {
    method: 'DELETE',
  });
  await handleVoidResponse(res, 'Failed to uninstall skill');
}

// Get skill content (for copying to worktree)
export async function getSkillContent(skillId: string): Promise<SkillContentResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/skills/${skillId}/content`);
  return handleResponse<SkillContentResponse>(res);
}

// =========================================================================
// MCP Server Configuration
// =========================================================================

export async function getMcpServers(workspaceId: string): Promise<McpServerConfig[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/mcp-servers`);
  return handleResponse<McpServerConfig[]>(res);
}

export async function setMcpServers(workspaceId: string, servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/mcp-servers`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servers),
    }
  );
  return handleResponse<McpServerConfig[]>(res);
}

// =========================================================================
// Workspace .mcp.json Trust
// =========================================================================

export interface DotMcpServerInfo {
  name: string;
  type: string;
  command?: string;
  source?: string; // 'dot-mcp' | 'claude-cli-project'
}

export interface DotMcpInfoResponse {
  exists: boolean;
  servers: DotMcpServerInfo[];
}

export interface DotMcpTrustResponse {
  status: 'unknown' | 'trusted' | 'denied';
}

export async function getDotMcpInfo(workspaceId: string): Promise<DotMcpInfoResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/dot-mcp-info`);
  return handleResponse<DotMcpInfoResponse>(res);
}

export async function getDotMcpTrust(workspaceId: string): Promise<DotMcpTrustResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/dot-mcp-trust`);
  return handleResponse<DotMcpTrustResponse>(res);
}

export async function setDotMcpTrust(workspaceId: string, status: 'trusted' | 'denied'): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/dot-mcp-trust`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function getNeverLoadDotMcp(): Promise<boolean> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/never-load-dot-mcp`);
  const data = await handleResponse<{ enabled: boolean }>(res);
  return data.enabled;
}

export async function setNeverLoadDotMcp(enabled: boolean): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/settings/never-load-dot-mcp`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

// =========================================================================
// AWS SSO / Bedrock Credentials
// =========================================================================

export async function refreshAWSCredentials(): Promise<{ status: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/aws-auth-refresh`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function getAWSSSOTokenStatus(): Promise<{
  applicable: boolean;
  valid: boolean | null;
  expiresAt?: string;
  expiresInMinutes?: number;
}> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/aws-sso-token-status`);
  return handleResponse(res);
}

// =========================================================================
// AI Agents Configuration
// =========================================================================

export interface AvailableAgentDTO {
  name: string;
  description: string;
  model: string;
  tools: string[];
  enabledDefault: boolean;
}

export async function getAvailableAgents(): Promise<AvailableAgentDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/available-agents`);
  return handleResponse<AvailableAgentDTO[]>(res);
}

export async function getEnabledAgents(workspaceId: string): Promise<string[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/settings/enabled-agents`);
  return handleResponse<string[]>(res);
}

export async function setEnabledAgents(workspaceId: string, agents: string[]): Promise<string[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/enabled-agents`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agents),
    }
  );
  return handleResponse<string[]>(res);
}

// =========================================================================
// GitHub Repos
// =========================================================================

export interface GitHubRepoDTO {
  fullName: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  private: boolean;
  fork: boolean;
  stargazersCount: number;
  cloneUrl: string;
  sshUrl: string;
  updatedAt: string;
  defaultBranch: string;
}

export interface GitHubOrgDTO {
  login: string;
  avatarUrl: string;
}

export interface ListGitHubReposResponse {
  repos: GitHubRepoDTO[];
  totalCount: number;
  hasMore: boolean;
}

export interface CloneRepoResponse {
  path: string;
  repo: RepoDTO;
}

export async function listGitHubRepos(params: {
  page?: number;
  perPage?: number;
  sort?: string;
  search?: string;
  org?: string;
  type?: string;
  signal?: AbortSignal;
} = {}): Promise<ListGitHubReposResponse> {
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', String(params.page));
  if (params.perPage) queryParams.set('per_page', String(params.perPage));
  if (params.sort) queryParams.set('sort', params.sort);
  if (params.search) queryParams.set('search', params.search);
  if (params.org) queryParams.set('org', params.org);
  if (params.type) queryParams.set('type', params.type);
  const qs = queryParams.toString();
  const res = await fetchWithAuth(`${getApiBase()}/api/github/repos${qs ? `?${qs}` : ''}`, {
    ...(params.signal && { signal: params.signal }),
  });
  return handleResponse<ListGitHubReposResponse>(res);
}

export async function listGitHubOrgs(): Promise<GitHubOrgDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/github/orgs`);
  return handleResponse<GitHubOrgDTO[]>(res);
}

export async function resolveGitHubRepo(url: string, signal?: AbortSignal): Promise<GitHubRepoDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/github/resolve-repo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    ...(signal && { signal }),
  });
  return handleResponse<GitHubRepoDTO>(res);
}

export async function cloneRepo(url: string, path: string, dirName: string, signal?: AbortSignal): Promise<CloneRepoResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, path, dirName }),
    ...(signal && { signal }),
  });
  return handleResponse<CloneRepoResponse>(res);
}
