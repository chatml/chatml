import { getApiBase, fetchWithAuth, handleResponse } from './base';

function sessionUrl(workspaceId: string, sessionId: string, path: string): string {
  return `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/${path}`;
}

export async function createSessionFile(
  workspaceId: string,
  sessionId: string,
  path: string,
  content: string = '',
): Promise<{ success: boolean; path: string }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'files/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  return handleResponse(res);
}

export async function createSessionFolder(
  workspaceId: string,
  sessionId: string,
  path: string,
): Promise<{ success: boolean; path: string }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'folders/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  return handleResponse(res);
}

export async function renameSessionFile(
  workspaceId: string,
  sessionId: string,
  oldPath: string,
  newPath: string,
): Promise<{ success: boolean; oldPath: string; newPath: string }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'files/rename'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath }),
  });
  return handleResponse(res);
}

export async function deleteSessionFile(
  workspaceId: string,
  sessionId: string,
  path: string,
  recursive: boolean = false,
): Promise<{ success: boolean }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'files/delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, recursive }),
  });
  return handleResponse(res);
}

export async function duplicateSessionFile(
  workspaceId: string,
  sessionId: string,
  sourcePath: string,
  destPath?: string,
): Promise<{ success: boolean; newPath: string }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'files/duplicate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, destPath }),
  });
  return handleResponse(res);
}

export async function moveSessionFile(
  workspaceId: string,
  sessionId: string,
  sourcePath: string,
  destPath: string,
): Promise<{ success: boolean; oldPath: string; newPath: string }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'files/move'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, destPath }),
  });
  return handleResponse(res);
}

export async function discardSessionFileChanges(
  workspaceId: string,
  sessionId: string,
  path: string,
): Promise<{ success: boolean }> {
  const res = await fetchWithAuth(sessionUrl(workspaceId, sessionId, 'files/discard'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  return handleResponse(res);
}
