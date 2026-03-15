import { getApiBase, fetchWithAuth, handleResponse } from './base';

export interface LinearIssueDTO {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  stateName: string;
  labels: string[];
  assignee?: string;
  project?: string;
}

export async function listMyLinearIssues(): Promise<LinearIssueDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/auth/linear/issues`);
  return handleResponse<LinearIssueDTO[]>(res);
}

export async function searchLinearIssues(query: string): Promise<LinearIssueDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/auth/linear/issues/search?q=${encodeURIComponent(query)}`
  );
  return handleResponse<LinearIssueDTO[]>(res);
}
