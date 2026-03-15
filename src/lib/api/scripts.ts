import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';
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
