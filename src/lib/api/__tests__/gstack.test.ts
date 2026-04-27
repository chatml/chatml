import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { getGstackStatus, enableGstack, disableGstack, syncGstack } from '../gstack';

const API_BASE = 'http://localhost:9876';

describe('lib/api/gstack', () => {
  describe('getGstackStatus', () => {
    it('returns status', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/gstack/status`, () =>
          HttpResponse.json({
            enabled: true,
            version: '1.2.3',
            lastSync: '2026-04-26T00:00:00Z',
          })
        )
      );

      const status = await getGstackStatus('ws-1');
      expect(status.enabled).toBe(true);
      expect(status.version).toBe('1.2.3');
    });

    it('returns disabled status with no version/lastSync', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/gstack/status`, () =>
          HttpResponse.json({ enabled: false })
        )
      );

      const status = await getGstackStatus('ws-1');
      expect(status.enabled).toBe(false);
      expect(status.version).toBeUndefined();
    });
  });

  describe('enableGstack', () => {
    it('POSTs and resolves on success', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/gstack/enable`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await enableGstack('ws-1');
      expect(capturedMethod).toBe('POST');
    });

    it('throws ApiError with enable message on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/gstack/enable`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(enableGstack('ws-1')).rejects.toMatchObject({
        message: 'Failed to enable gstack',
      });
    });
  });

  describe('disableGstack', () => {
    it('POSTs and resolves', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/gstack/disable`, () =>
          new HttpResponse(null, { status: 204 })
        )
      );

      await expect(disableGstack('ws-1')).resolves.toBeUndefined();
    });

    it('throws ApiError with disable message on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/gstack/disable`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(disableGstack('ws-1')).rejects.toMatchObject({
        message: 'Failed to disable gstack',
      });
    });
  });

  describe('syncGstack', () => {
    it('POSTs and resolves', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/gstack/sync`, () =>
          new HttpResponse(null, { status: 204 })
        )
      );

      await expect(syncGstack('ws-1')).resolves.toBeUndefined();
    });

    it('throws ApiError with sync message on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/gstack/sync`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(syncGstack('ws-1')).rejects.toMatchObject({
        message: 'Failed to sync gstack',
      });
    });
  });
});
