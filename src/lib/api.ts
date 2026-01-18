const API_BASE = 'http://localhost:9876';

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
  if (!res.ok) return [];
  return res.json();
}

export async function addRepo(path: string): Promise<RepoDTO> {
  try {
    const res = await fetch(`${API_BASE}/api/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
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
  if (!res.ok) return [];
  return res.json();
}

export interface FileContentDTO {
  path: string;
  name: string;
  content: string;
  size: number;
}

export async function getRepoFileContent(repoId: string, filePath: string): Promise<FileContentDTO> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
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
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json();
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
  createdAt: string;
  updatedAt: string;
}

export async function listSessions(workspaceId: string): Promise<SessionDTO[]> {
  const res = await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions`);
  if (!res.ok) return [];
  return res.json();
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSession(workspaceId: string, sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/repos/${workspaceId}/sessions/${sessionId}`, { method: 'DELETE' });
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
  if (!res.ok) throw new Error(await res.text());
}

export async function listAgents(repoId: string): Promise<AgentDTO[]> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`);
  if (!res.ok) return [];
  return res.json();
}

export async function spawnAgent(repoId: string, task: string): Promise<AgentDTO> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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

export interface MessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
  if (!res.ok) return [];
  return res.json();
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getConversation(convId: string): Promise<ConversationDTO> {
  const res = await fetch(`${API_BASE}/api/conversations/${convId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
  if (!res.ok) throw new Error(await res.text());
}

export async function stopConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${convId}/stop`, { method: 'POST' });
}

export async function deleteConversation(convId: string): Promise<void> {
  await fetch(`${API_BASE}/api/conversations/${convId}`, { method: 'DELETE' });
}
