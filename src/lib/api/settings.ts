import { getApiBase, fetchWithAuth, handleResponse } from './base';

export async function getWorkspacesBasePath(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/workspaces-base-dir`);
  const data = await handleResponse<{ path: string }>(res);
  return data.path;
}

export async function setWorkspacesBasePath(path: string): Promise<string> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/workspaces-base-dir`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }
  );
  const data = await handleResponse<{ path: string }>(res);
  return data.path;
}

export async function getEnvSettings(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/env`);
  const data = await handleResponse<{ envVars: string }>(res);
  return data.envVars;
}

export async function getClaudeEnv(): Promise<Record<string, string>> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/claude-env`);
  const data = await handleResponse<{ env: Record<string, string> }>(res);
  return data.env;
}

export async function setEnvSettings(envVars: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/env`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ envVars }),
    }
  );
  await handleResponse(res);
}

// Anthropic API Key
export async function getAnthropicApiKey(): Promise<{ configured: boolean; maskedKey: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/anthropic-api-key`);
  return handleResponse<{ configured: boolean; maskedKey: string }>(res);
}

export async function getClaudeAuthStatus(): Promise<{
  configured: boolean;
  hasStoredKey: boolean;
  hasEnvKey: boolean;
  hasCliCredentials: boolean;
  hasBedrock: boolean;
  credentialSource: string;
}> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/claude-auth-status`);
  return handleResponse(res);
}

export async function setAnthropicApiKey(apiKey: string): Promise<{ configured: boolean; maskedKey: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/anthropic-api-key`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    }
  );
  return handleResponse<{ configured: boolean; maskedKey: string }>(res);
}

// GitHub Personal Access Token
export async function getGitHubPersonalToken(): Promise<{ configured: boolean; maskedToken: string; username: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/github-personal-token`);
  return handleResponse<{ configured: boolean; maskedToken: string; username: string }>(res);
}

export async function setGitHubPersonalToken(token: string): Promise<{ configured: boolean; maskedToken: string; username: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/settings/github-personal-token`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }
  );
  return handleResponse<{ configured: boolean; maskedToken: string; username: string }>(res);
}

// AWS SSO / Bedrock Credentials
export async function refreshAWSCredentials(): Promise<{ status: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/aws-auth-refresh`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function getAWSSSOTokenStatus(): Promise<{
  applicable: boolean;
  valid: boolean | null;
  expiresAt?: string;
  expiresInMinutes?: number;
}> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/aws-sso-token-status`);
  return handleResponse(res);
}
