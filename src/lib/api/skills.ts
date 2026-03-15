import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

// Skills
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

// AI Agents Configuration
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
