'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getCIRuns,
  getCIJobs,
  getCIJobLogs,
  rerunCI,
  analyzeCIFailure,
  type WorkflowRunDTO,
  type WorkflowJobDTO,
  type CIAnalysisResult,
} from '@/lib/api';

const CI_POLL_INTERVAL_MS = 30000; // 30 seconds

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
  sessionId: string | null
): UseCIRunsResult {
  const [runs, setRuns] = useState<WorkflowRunDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(false);

  // Check if any runs are in progress
  const hasInProgressRuns = runs.some(
    (run) => run.status === 'in_progress' || run.status === 'queued'
  );

  // Fetch workflow runs
  const fetchRuns = useCallback(async () => {
    if (!workspaceId || !sessionId) {
      setRuns([]);
      setLoading(false);
      return;
    }

    try {
      const data = await getCIRuns(workspaceId, sessionId);
      if (isMountedRef.current) {
        setRuns(data);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        console.error('Failed to fetch CI runs:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch CI runs');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [workspaceId, sessionId]);

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
    isMountedRef.current = true;

    if (workspaceId && sessionId) {
      setLoading(true);
      fetchRuns();
    } else {
      setRuns([]);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchRuns, workspaceId, sessionId]);

  // Periodic polling when there are in-progress runs
  useEffect(() => {
    if (!workspaceId || !sessionId || !hasInProgressRuns) return;

    const interval = setInterval(() => {
      fetchRuns();
    }, CI_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [workspaceId, sessionId, hasInProgressRuns, fetchRuns]);

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
