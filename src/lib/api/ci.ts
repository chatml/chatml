import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';

export interface WorkflowRunDTO {
  id: number;
  name: string;
  status: string; // queued, in_progress, completed, waiting, requested, pending
  conclusion: string; // success, failure, neutral, cancelled, skipped, timed_out, action_required, stale
  headSha: string;
  headBranch: string;
  htmlUrl: string;
  jobsUrl: string;
  logsUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobStepDTO {
  name: string;
  status: string; // queued, in_progress, completed
  conclusion: string; // success, failure, neutral, cancelled, skipped
  number: number;
  startedAt: string;
  completedAt: string;
}

export interface WorkflowJobDTO {
  id: number;
  runId: number;
  name: string;
  status: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
  htmlUrl: string;
  steps: JobStepDTO[];
}

export interface CIAnalysisResult {
  errorType: string;
  summary: string;
  rootCause: string;
  affectedFiles: string[];
  suggestedFix?: {
    description: string;
    patches: Array<{ file: string; diff: string }>;
  };
  confidence: number;
  rawLogs?: string;
}

export async function getCIRuns(
  workspaceId: string,
  sessionId: string
): Promise<WorkflowRunDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs`
  );
  return handleResponse<WorkflowRunDTO[]>(res);
}

export async function getCIRun(
  workspaceId: string,
  sessionId: string,
  runId: number
): Promise<WorkflowRunDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs/${runId}`
  );
  return handleResponse<WorkflowRunDTO>(res);
}

export async function getCIJobs(
  workspaceId: string,
  sessionId: string,
  runId: number
): Promise<WorkflowJobDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs/${runId}/jobs`
  );
  return handleResponse<WorkflowJobDTO[]>(res);
}

export async function getCIJobLogs(
  workspaceId: string,
  sessionId: string,
  jobId: number
): Promise<{ jobId: number; logs: string }> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/jobs/${jobId}/logs`
  );
  return handleResponse<{ jobId: number; logs: string }>(res);
}

export async function rerunCI(
  workspaceId: string,
  sessionId: string,
  runId: number,
  failedOnly: boolean = false
): Promise<void> {
  const params = failedOnly ? '?failedOnly=true' : '';
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/runs/${runId}/rerun${params}`,
    { method: 'POST' }
  );
  await handleVoidResponse(res, 'Failed to rerun CI workflow');
}

export async function analyzeCIFailure(
  workspaceId: string,
  sessionId: string,
  runId: number,
  jobId: number
): Promise<CIAnalysisResult> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, jobId }),
    }
  );
  return handleResponse<CIAnalysisResult>(res);
}

// CI Failure Context (aggregated failures for forwarding to AI)
export interface FailedJobContext {
  jobId: number;
  jobName: string;
  jobUrl: string;
  failedSteps: string[];
  logs: string;
  logLines: number;
  truncated: boolean;
}

export interface FailedRunContext {
  runId: number;
  runName: string;
  runUrl: string;
  failedJobs: FailedJobContext[];
}

// Snapshot status from GetCIFailureContext. Lets callers tell apart the
// reasons failedRuns can be empty so the UX (and the agent) can react
// honestly instead of always saying "no failures."
export type CIFailureContextStatus =
  | 'has_failures'
  | 'all_passed'
  | 'in_progress'
  | 'no_runs';

export interface CIFailureContextDTO {
  branch: string;
  status: CIFailureContextStatus;
  failedRuns: FailedRunContext[];
  totalFailed: number;
  truncated: boolean;
}

export async function getCIFailureContext(
  workspaceId: string,
  sessionId: string
): Promise<CIFailureContextDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/ci/failure-context`
  );
  return handleResponse<CIFailureContextDTO>(res);
}
