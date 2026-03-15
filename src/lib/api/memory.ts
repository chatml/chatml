import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

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
