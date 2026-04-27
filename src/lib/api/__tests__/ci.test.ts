import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getCIRuns,
  getCIRun,
  getCIJobs,
  getCIJobLogs,
  rerunCI,
  analyzeCIFailure,
  getCIFailureContext,
  type WorkflowRunDTO,
  type WorkflowJobDTO,
  type CIAnalysisResult,
} from '../ci';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockRun: WorkflowRunDTO = {
  id: 1234,
  name: 'CI',
  status: 'completed',
  conclusion: 'failure',
  headSha: 'abc1234',
  headBranch: 'feature/test',
  htmlUrl: 'https://github.com/x/y/actions/runs/1234',
  jobsUrl: 'https://api.github.com/repos/x/y/actions/runs/1234/jobs',
  logsUrl: 'https://api.github.com/repos/x/y/actions/runs/1234/logs',
  createdAt: '2026-04-26T10:00:00Z',
  updatedAt: '2026-04-26T10:05:00Z',
};

const mockJob: WorkflowJobDTO = {
  id: 5678,
  runId: 1234,
  name: 'test',
  status: 'completed',
  conclusion: 'failure',
  startedAt: '2026-04-26T10:01:00Z',
  completedAt: '2026-04-26T10:04:00Z',
  htmlUrl: 'https://github.com/x/y/actions/runs/1234/jobs/5678',
  steps: [
    {
      name: 'Run tests',
      status: 'completed',
      conclusion: 'failure',
      number: 1,
      startedAt: '2026-04-26T10:01:30Z',
      completedAt: '2026-04-26T10:04:00Z',
    },
  ],
};

describe('lib/api/ci', () => {
  describe('getCIRuns', () => {
    it('returns workflow runs', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs`, () =>
          HttpResponse.json([mockRun])
        )
      );

      const runs = await getCIRuns('ws-1', 'session-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(1234);
      expect(runs[0].conclusion).toBe('failure');
    });

    it('returns empty array when no runs', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs`, () =>
          HttpResponse.json([])
        )
      );

      expect(await getCIRuns('ws-1', 'session-1')).toEqual([]);
    });
  });

  describe('getCIRun', () => {
    it('returns a single run by id', async () => {
      let capturedUrl = '';
      server.use(
        http.get(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs/:runId`,
          ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json(mockRun);
          }
        )
      );

      const run = await getCIRun('ws-1', 'session-1', 1234);
      expect(run.id).toBe(1234);
      expect(capturedUrl).toContain('/ci/runs/1234');
    });
  });

  describe('getCIJobs', () => {
    it('returns jobs for a run', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs/:runId/jobs`,
          () => HttpResponse.json([mockJob])
        )
      );

      const jobs = await getCIJobs('ws-1', 'session-1', 1234);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('test');
      expect(jobs[0].steps).toHaveLength(1);
    });
  });

  describe('getCIJobLogs', () => {
    it('returns logs for a job', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/jobs/:jobId/logs`,
          () => HttpResponse.json({ jobId: 5678, logs: 'Error: build failed\nexit 1' })
        )
      );

      const result = await getCIJobLogs('ws-1', 'session-1', 5678);
      expect(result.jobId).toBe(5678);
      expect(result.logs).toContain('build failed');
    });
  });

  describe('rerunCI', () => {
    it('POSTs without query string by default', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs/:runId/rerun`,
          ({ request }) => {
            capturedUrl = request.url;
            capturedMethod = request.method;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await rerunCI('ws-1', 'session-1', 1234);
      expect(capturedMethod).toBe('POST');
      expect(capturedUrl).not.toContain('failedOnly');
    });

    it('appends ?failedOnly=true when requested', async () => {
      let capturedUrl = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs/:runId/rerun`,
          ({ request }) => {
            capturedUrl = request.url;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await rerunCI('ws-1', 'session-1', 1234, true);
      expect(capturedUrl).toContain('?failedOnly=true');
    });

    it('throws ApiError with custom message on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/runs/:runId/rerun`,
          () => HttpResponse.text('', { status: 500 })
        )
      );

      await expect(rerunCI('ws-1', 'session-1', 1234)).rejects.toMatchObject({
        status: 500,
        message: 'Failed to rerun CI workflow',
      });
    });
  });

  describe('analyzeCIFailure', () => {
    const mockAnalysis: CIAnalysisResult = {
      errorType: 'TestFailure',
      summary: 'Login test fails',
      rootCause: 'Missing env var',
      affectedFiles: ['src/login.test.ts'],
      suggestedFix: {
        description: 'Set OAUTH_SECRET',
        patches: [{ file: '.env', diff: '+OAUTH_SECRET=...' }],
      },
      confidence: 0.85,
    };

    it('POSTs runId + jobId and returns analysis', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:wsId/sessions/:sId/ci/analyze`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json(mockAnalysis);
          }
        )
      );

      const result = await analyzeCIFailure('ws-1', 'session-1', 1234, 5678);

      expect(capturedBody).toEqual({ runId: 1234, jobId: 5678 });
      expect(result.errorType).toBe('TestFailure');
      expect(result.confidence).toBe(0.85);
      expect(result.suggestedFix?.patches).toHaveLength(1);
    });

    it('handles analysis without suggestedFix', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:wsId/sessions/:sId/ci/analyze`, () =>
          HttpResponse.json({ ...mockAnalysis, suggestedFix: undefined })
        )
      );

      const result = await analyzeCIFailure('ws-1', 'session-1', 1234, 5678);
      expect(result.suggestedFix).toBeUndefined();
    });

    it('throws ApiError on backend failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:wsId/sessions/:sId/ci/analyze`, () =>
          HttpResponse.json({ error: 'analysis failed' }, { status: 500 })
        )
      );

      await expect(
        analyzeCIFailure('ws-1', 'session-1', 1234, 5678)
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('getCIFailureContext', () => {
    it('returns aggregated failure context', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:wsId/sessions/:sId/ci/failure-context`, () =>
          HttpResponse.json({
            branch: 'feature/test',
            failedRuns: [
              {
                runId: 1234,
                runName: 'CI',
                runUrl: 'https://github.com/x/y/actions/runs/1234',
                failedJobs: [
                  {
                    jobId: 5678,
                    jobName: 'test',
                    jobUrl: 'https://github.com/x/y/actions/runs/1234/jobs/5678',
                    failedSteps: ['Run tests'],
                    logs: 'fail line',
                    logLines: 1,
                    truncated: false,
                  },
                ],
              },
            ],
            totalFailed: 1,
            truncated: false,
          })
        )
      );

      const ctx = await getCIFailureContext('ws-1', 'session-1');
      expect(ctx.branch).toBe('feature/test');
      expect(ctx.totalFailed).toBe(1);
      expect(ctx.failedRuns[0].failedJobs[0].failedSteps).toEqual(['Run tests']);
    });
  });
});
