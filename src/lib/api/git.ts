import { getApiBase, fetchWithAuth, handleResponse } from './base';
import type { FileContentDTO } from './repositories';

export interface FileChangeDTO {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
}

export async function getSessionChanges(workspaceId: string, sessionId: string): Promise<FileChangeDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/changes`);
  return handleResponse<FileChangeDTO[]>(res);
}

export interface BranchCommitDTO {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
  files: FileChangeDTO[];
}

export interface BranchStatsDTO {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface BranchChangesResponseDTO {
  commits: BranchCommitDTO[];
  branchStats?: BranchStatsDTO;
  allChanges?: FileChangeDTO[];
}

export async function getSessionBranchCommits(workspaceId: string, sessionId: string): Promise<BranchChangesResponseDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/branch-commits`);
  return handleResponse<BranchChangesResponseDTO>(res);
}

// Git status types matching backend response
export interface GitStatusDTO {
  workingDirectory: {
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    totalUncommitted: number;
    hasChanges: boolean;
  };
  sync: {
    aheadBy: number;
    behindBy: number;
    baseBranch: string;
    remoteBranch?: string;
    hasRemote: boolean;
    diverged: boolean;
    unpushedCommits: number;
  };
  inProgress: {
    type: 'none' | 'rebase' | 'merge' | 'cherry-pick' | 'revert';
    current?: number;
    total?: number;
  };
  conflicts: {
    hasConflicts: boolean;
    count: number;
    files: string[];
  };
  stash: {
    count: number;
  };
}

export async function getGitStatus(workspaceId: string, sessionId: string): Promise<GitStatusDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/git-status`);
  return handleResponse<GitStatusDTO>(res);
}

// Consolidated snapshot: replaces separate git-status + changes + branch-commits calls
export interface SessionSnapshotDTO {
  gitStatus: GitStatusDTO;
  changes: FileChangeDTO[];
  allChanges: FileChangeDTO[];
  commits: BranchCommitDTO[];
  branchStats?: BranchStatsDTO;
}

export async function getSessionSnapshot(workspaceId: string, sessionId: string): Promise<SessionSnapshotDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/snapshot`);
  return handleResponse<SessionSnapshotDTO>(res);
}

// File commit history types
export interface FileCommitDTO {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  timestamp: string;
  additions: number;
  deletions: number;
}

export interface FileHistoryResponse {
  commits: FileCommitDTO[];
  total: number;
  truncated: boolean;
}

export async function getFileCommitHistory(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  signal?: AbortSignal
): Promise<FileHistoryResponse> {
  const params = new URLSearchParams({ path: filePath });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-history?${params.toString()}`,
    { signal }
  );
  return handleResponse<FileHistoryResponse>(res);
}

export async function getFileAtCommit(
  workspaceId: string,
  sessionId: string,
  filePath: string,
  commitSha: string
): Promise<FileContentDTO> {
  const params = new URLSearchParams({ path: filePath, ref: commitSha });
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/file-at-ref?${params.toString()}`
  );
  return handleResponse<FileContentDTO>(res);
}
