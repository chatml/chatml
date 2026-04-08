import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse, ApiError } from './base';
import type { FileNodeDTO, FileContentDTO } from './repositories';

// Re-export types that file consumers commonly need alongside file operations
export type { FileNodeDTO, FileContentDTO };

export interface FileDiffDTO {
  path: string;
  oldContent: string;
  newContent: string;
  oldFilename: string;
  newFilename: string;
  hasConflict: boolean;
  isDeleted: boolean;
  truncated?: boolean;
  unifiedDiff?: string;
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
  filePath: string,
  signal?: AbortSignal,
): Promise<FileDiffDTO> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/diff?${params.toString()}`,
    signal ? { signal } : undefined,
  );
  return handleResponse<FileDiffDTO>(res);
}

// Session-aware file APIs (for complete session isolation)
export async function getSessionFileContent(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<FileContentDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file?path=${encodeURIComponent(filePath)}`,
    signal ? { signal } : undefined,
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

// Attachment data — returns base64 content, or null when the DB has no data for this attachment.
export async function fetchAttachmentData(attachmentId: string): Promise<string | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/attachments/${encodeURIComponent(attachmentId)}/data`);
  const json = await handleResponse<{ base64Data: string }>(res);
  return json.base64Data || null;
}

// URL builders for raw image serving — used directly in <img src> tags.
// Auth token is passed via query param (same mechanism as WebSocket auth).
export function getSessionFileRawUrl(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  token?: string | null,
): string {
  const params = new URLSearchParams({ path: filePath });
  if (token) params.set('token', token);
  return `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-raw?${params}`;
}

export function getSessionFileRawAtRefUrl(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  ref: string,
  token?: string | null,
): string {
  const params = new URLSearchParams({ path: filePath, ref });
  if (token) params.set('token', token);
  return `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-raw-at-ref?${params}`;
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
