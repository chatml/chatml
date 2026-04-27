import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import { getNeverLoadDotMcp, setNeverLoadDotMcp } from '../mcp';

const API_BASE = 'http://localhost:9876';

// getMcpServers / setMcpServers are covered by src/lib/__tests__/api.mcp.test.ts.
// getDotMcpInfo / getDotMcpTrust / setDotMcpTrust are covered by api.dotMcpTrust.test.ts.
// This file fills the remaining gap: never-load-dot-mcp toggle.

describe('lib/api/mcp — never-load-dot-mcp', () => {
  describe('getNeverLoadDotMcp', () => {
    it('unwraps enabled field from response envelope (true)', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/never-load-dot-mcp`, () =>
          HttpResponse.json({ enabled: true })
        )
      );

      expect(await getNeverLoadDotMcp()).toBe(true);
    });

    it('unwraps enabled field (false)', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/never-load-dot-mcp`, () =>
          HttpResponse.json({ enabled: false })
        )
      );

      expect(await getNeverLoadDotMcp()).toBe(false);
    });
  });

  describe('setNeverLoadDotMcp', () => {
    it('PUTs enabled flag', async () => {
      let capturedBody: unknown;
      let capturedMethod = '';
      server.use(
        http.put(`${API_BASE}/api/settings/never-load-dot-mcp`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setNeverLoadDotMcp(true);
      expect(capturedMethod).toBe('PUT');
      expect(capturedBody).toEqual({ enabled: true });
    });

    it('PUTs enabled=false', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/settings/never-load-dot-mcp`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setNeverLoadDotMcp(false);
      expect(capturedBody).toEqual({ enabled: false });
    });
  });
});
