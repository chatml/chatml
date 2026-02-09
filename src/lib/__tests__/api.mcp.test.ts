import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { getMcpServers, setMcpServers } from '../api';

const API_BASE = 'http://localhost:9876';

describe('MCP Server API', () => {
  // =========================================================================
  // getMcpServers
  // =========================================================================

  describe('getMcpServers', () => {
    it('returns servers', async () => {
      const mockServers = [
        { name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@mcp/github'], enabled: true },
        { name: 'slack', type: 'sse', url: 'http://localhost:3001', enabled: false },
      ];

      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/mcp-servers`, () => {
          return HttpResponse.json(mockServers);
        })
      );

      const result = await getMcpServers('ws-1');
      expect(result).toEqual(mockServers);
    });

    it('returns empty array', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/mcp-servers`, () => {
          return HttpResponse.json([]);
        })
      );

      const result = await getMcpServers('ws-1');
      expect(result).toEqual([]);
    });

    it('handles server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/mcp-servers`, () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      await expect(getMcpServers('ws-1')).rejects.toThrow();
    });
  });

  // =========================================================================
  // setMcpServers
  // =========================================================================

  describe('setMcpServers', () => {
    it('saves and returns servers', async () => {
      const serversToSave = [
        { name: 'test', type: 'stdio' as const, command: 'echo', enabled: true },
      ];

      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/mcp-servers`, async ({ request }) => {
          const body = await request.json();
          return HttpResponse.json(body);
        })
      );

      const result = await setMcpServers('ws-1', serversToSave);
      expect(result).toEqual(serversToSave);
    });

    it('saves empty array', async () => {
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/mcp-servers`, () => {
          return HttpResponse.json([]);
        })
      );

      const result = await setMcpServers('ws-1', []);
      expect(result).toEqual([]);
    });

    it('handles validation error', async () => {
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/mcp-servers`, () => {
          return HttpResponse.json(
            { code: 'validation_error', message: 'server missing name' },
            { status: 400 }
          );
        })
      );

      await expect(setMcpServers('ws-1', [{ name: '', type: 'stdio', enabled: true }])).rejects.toThrow();
    });
  });
});
