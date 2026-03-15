import { getApiBase, fetchWithAuth, handleResponse } from './base';
import type { RepoDTO } from './repositories';

// GitHub Issue DTOs and functions
export interface GitHubIssueLabel {
  name: string;
  color: string;
}

export interface GitHubIssueUser {
  login: string;
  avatarUrl: string;
}

export interface GitHubIssueListItem {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  labels: GitHubIssueLabel[];
  user: GitHubIssueUser;
  assignees: GitHubIssueUser[];
  comments: number;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssueDetails extends GitHubIssueListItem {
  body: string;
  milestone?: {
    title: string;
    number: number;
  };
}

export interface SearchGitHubIssuesResult {
  totalCount: number;
  issues: GitHubIssueListItem[];
}

export async function listGitHubIssues(workspaceId: string): Promise<GitHubIssueListItem[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/issues`);
  return handleResponse<GitHubIssueListItem[]>(res);
}

export async function searchGitHubIssues(workspaceId: string, query: string): Promise<SearchGitHubIssuesResult> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/issues/search?q=${encodeURIComponent(query)}`
  );
  return handleResponse<SearchGitHubIssuesResult>(res);
}

export async function getGitHubIssueDetails(workspaceId: string, issueNumber: number): Promise<GitHubIssueDetails> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/issues/${issueNumber}`);
  return handleResponse<GitHubIssueDetails>(res);
}

// GitHub Repos
export interface GitHubRepoDTO {
  fullName: string;
  name: string;
  owner: string;
  description: string;
  language: string;
  private: boolean;
  fork: boolean;
  stargazersCount: number;
  cloneUrl: string;
  sshUrl: string;
  updatedAt: string;
  defaultBranch: string;
}

export interface GitHubOrgDTO {
  login: string;
  avatarUrl: string;
}

export interface ListGitHubReposResponse {
  repos: GitHubRepoDTO[];
  totalCount: number;
  hasMore: boolean;
}

export interface CloneRepoResponse {
  path: string;
  repo: RepoDTO;
}

export async function listGitHubRepos(params: {
  page?: number;
  perPage?: number;
  sort?: string;
  search?: string;
  org?: string;
  type?: string;
  signal?: AbortSignal;
} = {}): Promise<ListGitHubReposResponse> {
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.set('page', String(params.page));
  if (params.perPage) queryParams.set('per_page', String(params.perPage));
  if (params.sort) queryParams.set('sort', params.sort);
  if (params.search) queryParams.set('search', params.search);
  if (params.org) queryParams.set('org', params.org);
  if (params.type) queryParams.set('type', params.type);
  const qs = queryParams.toString();
  const res = await fetchWithAuth(`${getApiBase()}/api/github/repos${qs ? `?${qs}` : ''}`, {
    ...(params.signal && { signal: params.signal }),
  });
  return handleResponse<ListGitHubReposResponse>(res);
}

export async function listGitHubOrgs(): Promise<GitHubOrgDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/github/orgs`);
  return handleResponse<GitHubOrgDTO[]>(res);
}

export async function resolveGitHubRepo(url: string, signal?: AbortSignal): Promise<GitHubRepoDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/github/resolve-repo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    ...(signal && { signal }),
  });
  return handleResponse<GitHubRepoDTO>(res);
}

export async function cloneRepo(url: string, path: string, dirName: string, signal?: AbortSignal): Promise<CloneRepoResponse> {
  const res = await fetchWithAuth(`${getApiBase()}/api/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, path, dirName }),
    ...(signal && { signal }),
  });
  return handleResponse<CloneRepoResponse>(res);
}
