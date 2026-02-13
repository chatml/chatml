import { HEALTH_CHECK_REQUEST_TIMEOUT_MS } from '@/lib/constants';
import { getAuthToken } from '@/lib/auth-token';
import { getBackendPortSync, getBackendPort, initBackendPort } from '@/lib/backend-port';
import type { McpServerConfig } from '@/lib/types';

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

/**
 * @deprecated Use `getApiBase()` instead. This static export is evaluated at module
 * load time with the default port and will NOT reflect dynamically allocated ports
 * in Tauri builds. Only kept for backwards compatibility with external consumers.
 */
export const API_BASE = typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__
  ? 'http://localhost:9876'  // Default - does NOT update for dynamic ports!
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876');

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

// Fetch helper that adds authentication token for Tauri builds
// Also catches network-level TypeErrors (e.g. server unreachable) and
// re-throws them as ApiError with status 0 for consistent error handling.
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  try {
    return await fetch(url, { ...options, headers });
  } catch (err) {
    if (err instanceof TypeError) {
      throw new ApiError('Cannot connect to backend. Is the server running?', 0);
    }
    throw err;
  }
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

export interface AgentDTO {
  id: string;
  repoId: string;
  task: string;
  status: 'pending' | 'running' | 'done' | 'error';
  worktree: string;
  branch: string;
  createdAt: string;
}

export interface FileNodeDTO {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNodeDTO[];
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
  filePath: string
): Promise<FileDiffDTO> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/diff?${params.toString()}`
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
  hasMergeConflict?: boolean;
  hasCheckFailures?: boolean;
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
    hasMergeConflict: session.hasMergeConflict,
    hasCheckFailures: session.hasCheckFailures,
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
): Promise<SessionDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handleResponse<SessionDTO>(res);
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

export async function getSessionBranchCommits(workspaceId: string, sessionId: string): Promise<BranchCommitDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branch-commits`);
  return handleResponse<BranchCommitDTO[]>(res);
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
}

export async function getFileCommitHistory(
  workspaceId: string,
  sessionId: string,
  filePath: string
): Promise<FileHistoryResponse> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-history?${params.toString()}`
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
  htmlUrl: string;
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

export async function listAgents(repoId: string): Promise<AgentDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${repoId}/agents`);
  return handleResponse<AgentDTO[]>(res);
}

export async function spawnAgent(repoId: string, task: string): Promise<AgentDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${repoId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });
  return handleResponse<AgentDTO>(res);
}

export async function stopAgent(agentId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/agents/${agentId}/stop`, { method: 'POST' });
  await handleVoidResponse(res, 'Failed to stop agent');
}

export async function getAgentDiff(agentId: string): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/agents/${agentId}/diff`);
  return res.text();
}

export async function mergeAgent(agentId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/agents/${agentId}/merge`, { method: 'POST' });
  await handleVoidResponse(res, 'Failed to merge agent changes');
}

export async function deleteAgent(agentId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/agents/${agentId}`, { method: 'DELETE' });
  await handleVoidResponse(res, 'Failed to delete agent');
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

export interface RunSummaryDTO {
  success: boolean;
  cost?: number;
  turns?: number;
  durationMs?: number;
  stats?: RunStatsDTO;
  errors?: unknown[];
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
}

export interface TimelineEntryDTO {
  type: 'text' | 'tool';
  content?: string;
  toolId?: string;
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
export function toStoreMessage(dto: MessageDTO, conversationId: string): import('@/lib/types').Message {
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
    timestamp: dto.timestamp,
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
  opts?: { before?: number; limit?: number }
): Promise<MessagePageDTO> {
  const params = new URLSearchParams();
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const url = `${getApiBase()}/api/conversations/${convId}/messages${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(url);
  return handleResponse<MessagePageDTO>(res);
}

export async function sendConversationMessage(
  convId: string,
  content: string,
  attachments?: AttachmentDTO[],
  model?: string,
  mentionedFiles?: string[]
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, attachments, model, mentionedFiles }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
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

export interface StreamingSnapshotDTO {
  text: string;
  activeTools: { id: string; tool: string; startTime: number }[];
  thinking?: string;
  isThinking: boolean;
  planModeActive: boolean;
}

export async function getStreamingSnapshot(convId: string): Promise<StreamingSnapshotDTO | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/streaming-snapshot`);
  return handleResponse(res);
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

export async function approvePlan(convId: string, requestId: string, approved: boolean): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/approve-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, approved }),
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
  data: { resolved?: boolean; resolvedBy?: string }
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

// Dashboard data types - for efficient batch loading of initial data
export interface SessionWithConversationsDTO extends SessionDTO {
  conversations: ConversationDTO[];
}

export interface ArchivedSessionDirDTO {
  dirName: string;
  sessionId: string;
}

export interface DashboardDataDTO {
  workspaces: RepoDTO[];
  sessions: SessionWithConversationsDTO[];
  archivedSessionDirs?: ArchivedSessionDirDTO[];
}

/**
 * Fetches all workspaces, sessions, and conversations in a single request.
 * This eliminates the N+1 pattern of fetching sessions per workspace and conversations per session.
 * Uses only 4 database queries regardless of data volume (1 for repos + 1 for sessions + 3 for conversations batch).
 */
export async function getDashboardData(): Promise<DashboardDataDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/dashboard/data`);
  return handleResponse<DashboardDataDTO>(res);
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
// PR Creation
// ============================================================================

export interface GeneratePRDescriptionResponse {
  title: string;
  body: string;
}

export interface CreatePRRequestBody {
  title: string;
  body: string;
  draft: boolean;
}

export interface CreatePRResponse {
  number: number;
  htmlUrl: string;
}

export async function generatePRDescription(
  workspaceId: string,
  sessionId: string
): Promise<GeneratePRDescriptionResponse> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/pr/generate`
  );
  return handleResponse<GeneratePRDescriptionResponse>(res);
}

export async function createPR(
  workspaceId: string,
  sessionId: string,
  data: CreatePRRequestBody
): Promise<CreatePRResponse> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/pr/create`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return handleResponse<CreatePRResponse>(res);
}

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
