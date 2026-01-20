import { HEALTH_CHECK_REQUEST_TIMEOUT_MS } from '@/lib/constants';

// API base URL - configurable via environment variable for non-Tauri builds
export const API_BASE = typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__
  ? 'http://localhost:9876'  // Tauri always uses localhost sidecar
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876');

// Custom error class for API errors
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: string
  ) {
    super(message);
    this.name = 'ApiError';
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

// Backend DTOs
export interface RepoDTO {
  id: string;
  name: string;
  path: string;
  branch: string;
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
  const res = await fetch(`${API_BASE}/api/repos`);
  return handleResponse<RepoDTO[]>(res);
}

export async function addRepo(path: string): Promise<RepoDTO> {
  try {
    const res = await fetch(`${API_BASE}/api/repos`, {
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
  await fetch(`${API_BASE}/api/repos/${id}`, { method: 'DELETE' });
}

export async function listRepoFiles(repoId: string, depth: number | 'all' = 1): Promise<FileNodeDTO[]> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/files?depth=${depth}`);
  return handleResponse<FileNodeDTO[]>(res);
}

export interface FileContentDTO {
  path: string;
  name: string;
  content: string;
  size: number;
}

export async function getRepoFileContent(repoId: string, filePath: string): Promise<FileContentDTO> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`);
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
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/diff?${params.toString()}`);
  return handleResponse<FileDiffDTO>(res);
}

export async function getSessionFileDiff(
  workspaceId: string,
  sessionId: string,
  filePath: string
): Promise<FileDiffDTO> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetch(
    `${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}/diff?${params.toString()}`
  );
  return handleResponse<FileDiffDTO>(res);
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
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listSessions(workspaceId: string): Promise<SessionDTO[]> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions`);
  return handleResponse<SessionDTO[]>(res);
}

export async function createSession(
  workspaceId: string,
  data: { name: string; branch: string; worktreePath: string; task?: string }
): Promise<SessionDTO> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<SessionDTO>(res);
}

export async function updateSession(
  workspaceId: string,
  sessionId: string,
  updates: Partial<Omit<SessionDTO, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>
): Promise<SessionDTO> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handleResponse<SessionDTO>(res);
}

export async function deleteSession(workspaceId: string, sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}`, { method: 'DELETE' });
}

export interface FileChangeDTO {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted';
}

export async function getSessionChanges(workspaceId: string, sessionId: string): Promise<FileChangeDTO[]> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}/changes`);
  return handleResponse<FileChangeDTO[]>(res);
}

export async function sendSessionMessage(
  workspaceId: string,
  sessionId: string,
  content: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}/message`, {
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
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`);
  return handleResponse<AgentDTO[]>(res);
}

export async function spawnAgent(repoId: string, task: string): Promise<AgentDTO> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });
  return handleResponse<AgentDTO>(res);
}

export async function stopAgent(agentId: string): Promise<void> {
  await fetch(`${API_BASE}/api/agents/${agentId}/stop`, { method: 'POST' });
}

export async function getAgentDiff(agentId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/diff`);
  return res.text();
}

export async function mergeAgent(agentId: string): Promise<void> {
  await fetch(`${API_BASE}/api/agents/${agentId}/merge`, { method: 'POST' });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await fetch(`${API_BASE}/api/agents/${agentId}`, { method: 'DELETE' });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
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
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    onAttempt?.(attempt);

    try {
      const res = await fetch(`${API_BASE}/health`, {
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
  messages: MessageDTO[];
  toolSummary: ToolActionDTO[];
  createdAt: string;
  updatedAt: string;
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

export interface MessageDTO {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  setupInfo?: SetupInfoDTO;
  runSummary?: RunSummaryDTO;
  timestamp: string;
}

export interface ToolActionDTO {
  id: string;
  tool: string;
  target: string;
  success: boolean;
}

export async function listConversations(
  workspaceId: string,
  sessionId: string
): Promise<ConversationDTO[]> {
  const res = await fetch(
    `${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}/conversations`
  );
  return handleResponse<ConversationDTO[]>(res);
}

export async function createConversation(
  workspaceId: string,
  sessionId: string,
  data: { type?: 'task' | 'review' | 'chat'; message?: string }
): Promise<ConversationDTO> {
  const res = await fetch(
    `${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}/conversations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return handleResponse<ConversationDTO>(res);
}

export async function getConversation(convId: string): Promise<ConversationDTO> {
  const res = await fetch(`${API_BASE}/api/conversations/${convId}`);
  return handleResponse<ConversationDTO>(res);
}

export async function sendConversationMessage(
  convId: string,
  content: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function stopConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${convId}/stop`, { method: 'POST' });
}

export async function deleteConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${convId}`, { method: 'DELETE' });
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
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/tabs`);
  return handleResponse<FileTabDTO[]>(res);
}

export async function saveFileTabs(
  workspaceId: string,
  tabs: FileTabDTO[]
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/tabs`, {
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
  await fetch(`${API_BASE}/api/repos/${workspaceId}/tabs/${tabId}`, { method: 'DELETE' });
}

// File save function
export async function saveFile(
  workspaceId: string,
  path: string,
  content: string,
  sessionId?: string
): Promise<void> {
  const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/file/save${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}
