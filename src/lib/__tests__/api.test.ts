import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__mocks__/server';
import { listSessions, updateSession, getWorkspacesBasePath, setWorkspacesBasePath } from '../api';

const API_BASE = 'http://localhost:9876';

describe('Session API', () => {
  describe('listSessions', () => {
    it('should exclude archived sessions by default', async () => {
      const sessions = await listSessions('workspace-1');
      expect(sessions).toHaveLength(1);
      expect(sessions.every(s => !s.archived)).toBe(true);
      expect(sessions[0].id).toBe('session-1');
    });

    it('should include archived sessions when requested', async () => {
      const sessions = await listSessions('workspace-1', true);
      expect(sessions).toHaveLength(2);
      expect(sessions.some(s => s.archived)).toBe(true);
    });
  });

  describe('updateSession', () => {
    it('should archive a session', async () => {
      const result = await updateSession('workspace-1', 'session-1', { archived: true });
      expect(result.archived).toBe(true);
    });

    it('should unarchive a session', async () => {
      // First archive it
      await updateSession('workspace-1', 'session-1', { archived: true });
      // Then unarchive
      const result = await updateSession('workspace-1', 'session-1', { archived: false });
      expect(result.archived).toBe(false);
    });

    it('should pin a session', async () => {
      const result = await updateSession('workspace-1', 'session-1', { pinned: true });
      expect(result.pinned).toBe(true);
    });

    it('should unpin a session', async () => {
      // First pin it
      await updateSession('workspace-1', 'session-1', { pinned: true });
      // Then unpin
      const result = await updateSession('workspace-1', 'session-1', { pinned: false });
      expect(result.pinned).toBe(false);
    });

    it('should update both archived and pinned in one request', async () => {
      const result = await updateSession('workspace-1', 'session-1', {
        archived: true,
        pinned: true,
      });
      expect(result.archived).toBe(true);
      expect(result.pinned).toBe(true);
    });
  });
});

describe('Settings API', () => {
  describe('getWorkspacesBasePath', () => {
    it('returns path from API', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ path: '/custom/workspaces' });
        })
      );

      const result = await getWorkspacesBasePath();
      expect(result).toBe('/custom/workspaces');
    });

    it('rejects on server error', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ error: 'Internal error' }, { status: 500 });
        })
      );

      await expect(getWorkspacesBasePath()).rejects.toThrow();
    });
  });

  describe('setWorkspacesBasePath', () => {
    it('sends path and returns result', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/workspaces-base-dir`, async ({ request }) => {
          const body = await request.json() as { path: string };
          return HttpResponse.json({ path: body.path });
        })
      );

      const result = await setWorkspacesBasePath('/new/path');
      expect(result).toBe('/new/path');
    });

    it('resets with empty path', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ path: '/default/workspaces' });
        })
      );

      const result = await setWorkspacesBasePath('');
      expect(result).toBe('/default/workspaces');
    });

    it('rejects on validation error', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/workspaces-base-dir`, () => {
          return HttpResponse.json({ error: 'path does not exist' }, { status: 400 });
        })
      );

      await expect(setWorkspacesBasePath('/nonexistent')).rejects.toThrow();
    });
  });
});
