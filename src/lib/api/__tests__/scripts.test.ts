import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getWorkspaceConfig,
  updateWorkspaceConfig,
  detectWorkspaceConfig,
  runScript,
  rerunSetupScripts,
  stopScript,
  getScriptRuns,
} from '../scripts';
import type { ChatMLConfig, ScriptRun } from '@/lib/types';

const API_BASE = 'http://localhost:9876';

const mockConfig = {
  scripts: {
    setup: [{ key: 'install', command: 'pnpm install' }],
    dev: { key: 'dev', command: 'pnpm dev' },
  },
} as unknown as ChatMLConfig;

const mockRun = {
  id: 'run-1',
  scriptKey: 'install',
  status: 'completed',
  startedAt: '2026-04-26T10:00:00Z',
  completedAt: '2026-04-26T10:01:00Z',
} as unknown as ScriptRun;

describe('lib/api/scripts', () => {
  describe('getWorkspaceConfig', () => {
    it('returns workspace config', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/config`, () =>
          HttpResponse.json(mockConfig)
        )
      );

      const config = await getWorkspaceConfig('ws-1');
      expect(config).toEqual(mockConfig);
    });
  });

  describe('updateWorkspaceConfig', () => {
    it('PUTs config and returns updated', async () => {
      let capturedBody: unknown;
      let capturedMethod = '';
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/config`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          return HttpResponse.json(mockConfig);
        })
      );

      await updateWorkspaceConfig('ws-1', mockConfig);
      expect(capturedMethod).toBe('PUT');
      expect(capturedBody).toEqual(mockConfig);
    });
  });

  describe('detectWorkspaceConfig', () => {
    it('returns auto-detected config', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/config/detect`, () =>
          HttpResponse.json(mockConfig)
        )
      );

      const config = await detectWorkspaceConfig('ws-1');
      expect(config).toEqual(mockConfig);
    });
  });

  describe('runScript', () => {
    it('POSTs scriptKey and returns runId', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/scripts/run`,
          async ({ request }) => {
            capturedBody = await request.json();
            return HttpResponse.json({ runId: 'run-42' });
          }
        )
      );

      const result = await runScript('ws-1', 'session-1', 'install');
      expect(capturedBody).toEqual({ scriptKey: 'install' });
      expect(result.runId).toBe('run-42');
    });
  });

  describe('rerunSetupScripts', () => {
    it('POSTs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/scripts/setup`,
          ({ request }) => {
            capturedMethod = request.method;
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await rerunSetupScripts('ws-1', 'session-1');
      expect(capturedMethod).toBe('POST');
    });

    it('throws ApiError with custom message on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/scripts/setup`,
          () => HttpResponse.text('', { status: 500 })
        )
      );

      await expect(rerunSetupScripts('ws-1', 'session-1')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to start setup scripts',
      });
    });
  });

  describe('stopScript', () => {
    it('POSTs runId and resolves', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/scripts/stop`,
          async ({ request }) => {
            capturedBody = await request.json();
            return new HttpResponse(null, { status: 204 });
          }
        )
      );

      await stopScript('ws-1', 'session-1', 'run-42');
      expect(capturedBody).toEqual({ runId: 'run-42' });
    });

    it('throws ApiError with stop message on failure', async () => {
      server.use(
        http.post(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/scripts/stop`,
          () => HttpResponse.text('', { status: 500 })
        )
      );

      await expect(stopScript('ws-1', 'session-1', 'run-42')).rejects.toMatchObject({
        message: 'Failed to stop script',
      });
    });
  });

  describe('getScriptRuns', () => {
    it('returns script runs', async () => {
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/scripts/runs`,
          () => HttpResponse.json([mockRun])
        )
      );

      const runs = await getScriptRuns('ws-1', 'session-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe('run-1');
    });
  });
});
