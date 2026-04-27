import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listMemoryFiles,
  getMemoryFile,
  saveMemoryFile,
  deleteMemoryFile,
} from '../memory';

const API_BASE = 'http://localhost:9876';

describe('lib/api/memory', () => {
  describe('listMemoryFiles', () => {
    it('returns memory file infos', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/memory`, () =>
          HttpResponse.json([
            { name: 'CLAUDE.md', size: 1024 },
            { name: 'notes.md', size: 512 },
          ])
        )
      );

      const files = await listMemoryFiles('ws-1');
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('CLAUDE.md');
      expect(files[0].size).toBe(1024);
    });
  });

  describe('getMemoryFile', () => {
    it('returns file content', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/memory/file`, () =>
          HttpResponse.json({
            name: 'CLAUDE.md',
            content: '# Project notes',
            size: 15,
          })
        )
      );

      const file = await getMemoryFile('ws-1', 'CLAUDE.md');
      expect(file.content).toBe('# Project notes');
    });

    it('encodes file names with special characters', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/memory/file`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ name: 'a', content: '', size: 0 });
        })
      );

      await getMemoryFile('ws-1', 'foo bar.md');
      expect(capturedUrl).toContain('name=foo%20bar.md');
    });
  });

  describe('saveMemoryFile', () => {
    it('PUTs name + content and resolves', async () => {
      let capturedMethod = '';
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/memory/file`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await saveMemoryFile('ws-1', 'CLAUDE.md', '# updated');

      expect(capturedMethod).toBe('PUT');
      expect(capturedBody).toEqual({ name: 'CLAUDE.md', content: '# updated' });
    });

    it('throws ApiError with save message on failure', async () => {
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/memory/file`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(saveMemoryFile('ws-1', 'CLAUDE.md', '')).rejects.toMatchObject({
        message: 'Failed to save memory file',
      });
    });
  });

  describe('deleteMemoryFile', () => {
    it('DELETEs with name query param and resolves', async () => {
      let capturedSearch = '';
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/memory/file`, ({ request }) => {
          capturedMethod = request.method;
          capturedSearch = new URL(request.url).search;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteMemoryFile('ws-1', 'old.md');
      expect(capturedMethod).toBe('DELETE');
      expect(new URLSearchParams(capturedSearch).get('name')).toBe('old.md');
    });

    it('throws ApiError with delete message on failure', async () => {
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/memory/file`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(deleteMemoryFile('ws-1', 'old.md')).rejects.toMatchObject({
        message: 'Failed to delete memory file',
      });
    });
  });
});
