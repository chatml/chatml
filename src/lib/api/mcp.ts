import { getApiBase, fetchWithAuth, handleResponse } from './base';
import type { McpServerConfig } from '@/lib/types';

export async function getMcpServers(workspaceId: string): Promise<McpServerConfig[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/mcp-servers`);
  return handleResponse<McpServerConfig[]>(res);
}

export async function setMcpServers(workspaceId: string, servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/mcp-servers`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servers),
    }
  );
  return handleResponse<McpServerConfig[]>(res);
}

// Workspace .mcp.json Trust
export interface DotMcpServerInfo {
  name: string;
  type: string;
  command?: string;
  source?: string; // 'dot-mcp' | 'claude-cli-project'
}

export interface DotMcpInfoResponse {
  exists: boolean;
  servers: DotMcpServerInfo[];
}

export interface DotMcpTrustResponse {
  status: 'unknown' | 'trusted' | 'denied';
}

export async function getDotMcpInfo(workspaceId: string): Promise<DotMcpInfoResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/dot-mcp-info`);
  return handleResponse<DotMcpInfoResponse>(res);
}

export async function getDotMcpTrust(workspaceId: string): Promise<DotMcpTrustResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/dot-mcp-trust`);
  return handleResponse<DotMcpTrustResponse>(res);
}

export async function setDotMcpTrust(workspaceId: string, status: 'trusted' | 'denied'): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/dot-mcp-trust`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function getNeverLoadDotMcp(): Promise<boolean> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/never-load-dot-mcp`);
  const data = await handleResponse<{ enabled: boolean }>(res);
  return data.enabled;
}

export async function setNeverLoadDotMcp(enabled: boolean): Promise<void> {
  await fetchWithAuth(`${getApiBase()}/api/settings/never-load-dot-mcp`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}
