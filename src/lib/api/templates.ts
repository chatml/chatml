import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

// PR Templates
export async function getPRTemplate(workspaceId: string): Promise<string> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/pr-template`
  );
  const data = await handleResponse<{ template: string }>(res);
  return data.template;
}

export async function setPRTemplate(workspaceId: string, template: string): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/pr-template`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    }
  );
  await handleVoidResponse(res, 'Failed to save PR template');
}

export async function getGlobalPRTemplate(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/pr-template`);
  const data = await handleResponse<{ template: string }>(res);
  return data.template;
}

export async function setGlobalPRTemplate(template: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/pr-template`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
  await handleVoidResponse(res, 'Failed to save PR template');
}

// Review Prompt Overrides
export async function getGlobalReviewPrompts(): Promise<Record<string, string>> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/review-prompts`);
  const data = await handleResponse<{ prompts: Record<string, string> }>(res);
  return data.prompts;
}

export async function setGlobalReviewPrompts(prompts: Record<string, string>): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/review-prompts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts }),
  });
  await handleVoidResponse(res, 'Failed to save review prompts');
}

export async function getWorkspaceReviewPrompts(workspaceId: string): Promise<Record<string, string>> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/review-prompts`
  );
  const data = await handleResponse<{ prompts: Record<string, string> }>(res);
  return data.prompts;
}

export async function setWorkspaceReviewPrompts(
  workspaceId: string,
  prompts: Record<string, string>,
): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/review-prompts`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts }),
    },
  );
  await handleVoidResponse(res, 'Failed to save workspace review prompts');
}

// Action Template Overrides
export async function getGlobalActionTemplates(): Promise<Record<string, string>> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/action-templates`);
  const data = await handleResponse<{ templates: Record<string, string> }>(res);
  return data.templates;
}

export async function setGlobalActionTemplates(templates: Record<string, string>): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/action-templates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templates }),
  });
  await handleVoidResponse(res, 'Failed to save action templates');
}

export async function getWorkspaceActionTemplates(workspaceId: string): Promise<Record<string, string>> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/action-templates`
  );
  const data = await handleResponse<{ templates: Record<string, string> }>(res);
  return data.templates;
}

export async function setWorkspaceActionTemplates(
  workspaceId: string,
  templates: Record<string, string>,
): Promise<void> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/settings/action-templates`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates }),
    },
  );
  await handleVoidResponse(res, 'Failed to save workspace action templates');
}

// Custom Instructions
export async function getCustomInstructions(): Promise<string> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/custom-instructions`);
  const data = await handleResponse<{ instructions: string }>(res);
  return data.instructions;
}

export async function setCustomInstructions(instructions: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/settings/custom-instructions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  });
  await handleVoidResponse(res, 'Failed to save custom instructions');
}
