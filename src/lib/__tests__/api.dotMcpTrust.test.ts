import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { getDotMcpInfo, getDotMcpTrust, setDotMcpTrust } from '../api';

const API_BASE = 'http://localhost:9876';

describe('Dot MCP Trust API', () => {
  // =========================================================================
  // getDotMcpInfo
  // =========================================================================

  describe('getDotMcpInfo', () => {
    it('returns info when .mcp.json exists with servers', async () => {
      const mockResponse = {
        exists: true,
        servers: [
          { name: 'test-server', type: 'stdio', command: 'npx' },
          { name: 'sse-server', type: 'sse' },
        ],
      };

      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-info`, () => {
          return HttpResponse.json(mockResponse);
        })
      );

      const result = await getDotMcpInfo('ws-1');
      expect(result.exists).toBe(true);
      expect(result.servers).toHaveLength(2);
      expect(result.servers[0]).toEqual({ name: 'test-server', type: 'stdio', command: 'npx' });
    });

    it('returns exists=false when no .mcp.json', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-info`, () => {
          return HttpResponse.json({ exists: false, servers: [] });
        })
      );

      const result = await getDotMcpInfo('ws-1');
      expect(result.exists).toBe(false);
      expect(result.servers).toEqual([]);
    });

    it('handles server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-info`, () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      await expect(getDotMcpInfo('ws-1')).rejects.toThrow();
    });
  });

  // =========================================================================
  // getDotMcpTrust
  // =========================================================================

  describe('getDotMcpTrust', () => {
    it('returns unknown status', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, () => {
          return HttpResponse.json({ status: 'unknown' });
        })
      );

      const result = await getDotMcpTrust('ws-1');
      expect(result.status).toBe('unknown');
    });

    it('returns trusted status', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, () => {
          return HttpResponse.json({ status: 'trusted' });
        })
      );

      const result = await getDotMcpTrust('ws-1');
      expect(result.status).toBe('trusted');
    });

    it('returns denied status', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, () => {
          return HttpResponse.json({ status: 'denied' });
        })
      );

      const result = await getDotMcpTrust('ws-1');
      expect(result.status).toBe('denied');
    });

    it('handles server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      await expect(getDotMcpTrust('ws-1')).rejects.toThrow();
    });
  });

  // =========================================================================
  // setDotMcpTrust
  // =========================================================================

  describe('setDotMcpTrust', () => {
    it('sets trusted status', async () => {
      let capturedBody: unknown = null;

      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ status: 'trusted' });
        })
      );

      await setDotMcpTrust('ws-1', 'trusted');
      expect(capturedBody).toEqual({ status: 'trusted' });
    });

    it('sets denied status', async () => {
      let capturedBody: unknown = null;

      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ status: 'denied' });
        })
      );

      await setDotMcpTrust('ws-1', 'denied');
      expect(capturedBody).toEqual({ status: 'denied' });
    });

    it('sends request to correct workspace endpoint', async () => {
      let capturedWorkspaceId: string | undefined;

      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/dot-mcp-trust`, async ({ params }) => {
          capturedWorkspaceId = params.workspaceId as string;
          return HttpResponse.json({ status: 'trusted' });
        })
      );

      await setDotMcpTrust('my-workspace-123', 'trusted');
      expect(capturedWorkspaceId).toBe('my-workspace-123');
    });
  });
});
