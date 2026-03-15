import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

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
