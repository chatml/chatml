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

export async function listRepos(): Promise<RepoDTO[]> {
  const res = await fetch(`${API_BASE}/api/repos`);
  if (!res.ok) return [];
  return res.json();
}

export async function addRepo(path: string): Promise<RepoDTO> {
  const res = await fetch(`${API_BASE}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteRepo(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/repos/${id}`, { method: 'DELETE' });
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
