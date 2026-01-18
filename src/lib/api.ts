const API_BASE = 'http://localhost:9876';

export async function listRepos() {
  const res = await fetch(`${API_BASE}/api/repos`);
  return res.json();
}

export async function addRepo(path: string) {
  const res = await fetch(`${API_BASE}/api/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteRepo(id: string) {
  await fetch(`${API_BASE}/api/repos/${id}`, { method: 'DELETE' });
}

export async function listAgents(repoId: string) {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`);
  return res.json();
}

export async function spawnAgent(repoId: string, task: string) {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function stopAgent(agentId: string) {
  await fetch(`${API_BASE}/api/agents/${agentId}/stop`, { method: 'POST' });
}

export async function getAgentDiff(agentId: string) {
  const res = await fetch(`${API_BASE}/api/agents/${agentId}/diff`);
  return res.text();
}

export async function mergeAgent(agentId: string) {
  await fetch(`${API_BASE}/api/agents/${agentId}/merge`, { method: 'POST' });
}

export async function deleteAgent(agentId: string) {
  await fetch(`${API_BASE}/api/agents/${agentId}`, { method: 'DELETE' });
}
