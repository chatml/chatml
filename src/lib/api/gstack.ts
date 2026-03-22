import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

export interface GstackStatus {
  enabled: boolean;
  version?: string;
  lastSync?: string;
}

export async function getGstackStatus(workspaceId: string): Promise<GstackStatus> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/gstack/status`);
  return handleResponse<GstackStatus>(res);
}

export async function enableGstack(workspaceId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/gstack/enable`, {
    method: 'POST',
  });
  await handleVoidResponse(res, 'Failed to enable gstack');
}

export async function disableGstack(workspaceId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/gstack/disable`, {
    method: 'POST',
  });
  await handleVoidResponse(res, 'Failed to disable gstack');
}

export async function syncGstack(workspaceId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/gstack/sync`, {
    method: 'POST',
  });
  await handleVoidResponse(res, 'Failed to sync gstack');
}
