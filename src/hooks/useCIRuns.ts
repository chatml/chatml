'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getCIRuns,
  getCIJobs,
  getCIJobLogs,
  rerunCI,
  analyzeCIFailure,
  ApiError,
  type WorkflowRunDTO,
  type WorkflowJobDTO,
  type CIAnalysisResult,
} from '@/lib/api';

const CI_POLL_INTERVAL_MS = 30000; // 30 seconds
const AUTH_RETRY_DELAY_MS = 3000; // Retry delay when GitHub auth is pending

interface UseCIRunsResult {
  runs: WorkflowRunDTO[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // Job-related operations
  getJobs: (runId: number) => Promise<WorkflowJobDTO[]>;
  getJobLogs: (jobId: number) => Promise<string>;
  rerunWorkflow: (runId: number, failedOnly?: boolean) => Promise<void>;
  analyzeFailure: (runId: number, jobId: number) => Promise<CIAnalysisResult>;
}

/**
 * Hook to fetch and manage CI/GitHub Actions workflow runs for a session.
 *
 * Features:
 * - Fetches workflow runs on mount and session change
 * - Polls every 30 seconds when there are in-progress runs
 * - Provides methods to get jobs, logs, rerun workflows, and analyze failures
 */
export function useCIRuns(
  workspaceId: string | null,
  sessionId: string | null,
  active: boolean = true
): UseCIRunsResult {
  const [runs, setRuns] = useState<WorkflowRunDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable refs for the current workspaceId/sessionId so fetchRuns
  // used in polling doesn't need to be recreated on every change.
  const workspaceIdRef = useRef(workspaceId);
  const sessionIdRef = useRef(sessionId);
  workspaceIdRef.current = workspaceId;
  sessionIdRef.current = sessionId;

  // Check if any runs are in progress
  const hasInProgressRuns = runs.some(
    (run) => run.status === 'in_progress' || run.status === 'queued'
  );

  // Fetch workflow runs (stable — reads from refs)
  const fetchRuns = useCallback(async (signal?: AbortSignal) => {
    const wsId = workspaceIdRef.current;
    const sessId = sessionIdRef.current;

    if (!wsId || !sessId) {
      setRuns([]);
      setLoading(false);
      return;
    }

    try {
      const data = await getCIRuns(wsId, sessId);
      if (!signal?.aborted) {
        setRuns(data);
        setError(null);
      }
    } catch (err) {
      if (signal?.aborted) return;

      // GitHub auth not ready yet (startup race) — silently retry after a delay
      if (err instanceof ApiError && err.status === 401) {
        setTimeout(() => {
          if (!signal?.aborted) fetchRuns(signal);
        }, AUTH_RETRY_DELAY_MS);
        return;
      }

      console.error('Failed to fetch CI runs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch CI runs');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Exposed refetch function
  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchRuns();
  }, [fetchRuns]);

  // Get jobs for a workflow run
  const getJobs = useCallback(
    async (runId: number): Promise<WorkflowJobDTO[]> => {
      if (!workspaceId || !sessionId) {
        throw new Error('No active session');
      }
      return getCIJobs(workspaceId, sessionId, runId);
    },
    [workspaceId, sessionId]
  );

  // Get logs for a specific job
  const getJobLogs = useCallback(
    async (jobId: number): Promise<string> => {
      if (!workspaceId || !sessionId) {
        throw new Error('No active session');
      }
      const result = await getCIJobLogs(workspaceId, sessionId, jobId);
      return result.logs;
    },
    [workspaceId, sessionId]
  );

  // Rerun a workflow
  const rerunWorkflow = useCallback(
    async (runId: number, failedOnly: boolean = false): Promise<void> => {
      if (!workspaceId || !sessionId) {
        throw new Error('No active session');
      }
      await rerunCI(workspaceId, sessionId, runId, failedOnly);
      // Refetch runs after triggering rerun
      await fetchRuns();
    },
    [workspaceId, sessionId, fetchRuns]
  );

  // Analyze a CI failure
  const analyzeFailure = useCallback(
    async (runId: number, jobId: number): Promise<CIAnalysisResult> => {
      if (!workspaceId || !sessionId) {
        throw new Error('No active session');
      }
      return analyzeCIFailure(workspaceId, sessionId, runId, jobId);
    },
    [workspaceId, sessionId]
  );

  // Initial fetch and fetch on session change
  useEffect(() => {
    const abortController = new AbortController();

    if (workspaceId && sessionId) {
      setLoading(true);
      fetchRuns(abortController.signal);
    } else {
      setRuns([]);
    }

    return () => {
      abortController.abort();
    };
  }, [fetchRuns, workspaceId, sessionId]);

  // Periodic polling when there are in-progress runs
  useEffect(() => {
    if (!active || !workspaceId || !sessionId || !hasInProgressRuns) return;

    const interval = setInterval(() => {
      fetchRuns();
    }, CI_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [active, workspaceId, sessionId, hasInProgressRuns, fetchRuns]);

  return {
    runs,
    loading,
    error,
    refetch,
    getJobs,
    getJobLogs,
    rerunWorkflow,
    analyzeFailure,
  };
}
