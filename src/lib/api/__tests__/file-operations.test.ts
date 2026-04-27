import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  createSessionFile,
  createSessionFolder,
  renameSessionFile,
  deleteSessionFile,
  duplicateSessionFile,
  moveSessionFile,
  discardSessionFileChanges,
} from '../file-operations';

const API_BASE = 'http://localhost:9876';
const SESSION_BASE = `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId`;

describe('lib/api/file-operations', () => {
  describe('createSessionFile', () => {
    it('POSTs path + content and returns success', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/create`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true, path: 'src/new.ts' });
        })
      );

      const result = await createSessionFile('ws-1', 'session-1', 'src/new.ts', 'export {};');

      expect(capturedBody).toEqual({ path: 'src/new.ts', content: 'export {};' });
      expect(result.success).toBe(true);
      expect(result.path).toBe('src/new.ts');
    });

    it('defaults content to empty string', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/create`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true, path: 'a.ts' });
        })
      );

      await createSessionFile('ws-1', 'session-1', 'a.ts');
      expect(capturedBody).toEqual({ path: 'a.ts', content: '' });
    });
  });

  describe('createSessionFolder', () => {
    it('POSTs path and returns success', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/folders/create`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true, path: 'src/new-folder' });
        })
      );

      const result = await createSessionFolder('ws-1', 'session-1', 'src/new-folder');

      expect(capturedBody).toEqual({ path: 'src/new-folder' });
      expect(result.path).toBe('src/new-folder');
    });
  });

  describe('renameSessionFile', () => {
    it('PUTs oldPath + newPath and returns success', async () => {
      let capturedBody: unknown;
      let capturedMethod = '';
      server.use(
        http.put(`${SESSION_BASE}/files/rename`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          return HttpResponse.json({
            success: true,
            oldPath: 'src/old.ts',
            newPath: 'src/new.ts',
          });
        })
      );

      const result = await renameSessionFile('ws-1', 'session-1', 'src/old.ts', 'src/new.ts');

      expect(capturedMethod).toBe('PUT');
      expect(capturedBody).toEqual({ oldPath: 'src/old.ts', newPath: 'src/new.ts' });
      expect(result.newPath).toBe('src/new.ts');
    });
  });

  describe('deleteSessionFile', () => {
    it('POSTs path with recursive=false by default', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/delete`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true });
        })
      );

      await deleteSessionFile('ws-1', 'session-1', 'src/file.ts');
      expect(capturedBody).toEqual({ path: 'src/file.ts', recursive: false });
    });

    it('POSTs recursive=true for folder deletion', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/delete`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true });
        })
      );

      await deleteSessionFile('ws-1', 'session-1', 'src/folder', true);
      expect(capturedBody).toEqual({ path: 'src/folder', recursive: true });
    });
  });

  describe('duplicateSessionFile', () => {
    it('POSTs sourcePath alone (backend chooses destPath)', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/duplicate`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true, newPath: 'src/file copy.ts' });
        })
      );

      const result = await duplicateSessionFile('ws-1', 'session-1', 'src/file.ts');
      expect(capturedBody).toEqual({ sourcePath: 'src/file.ts', destPath: undefined });
      expect(result.newPath).toBe('src/file copy.ts');
    });

    it('POSTs both sourcePath and destPath when given', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/duplicate`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true, newPath: 'src/copy.ts' });
        })
      );

      await duplicateSessionFile('ws-1', 'session-1', 'src/file.ts', 'src/copy.ts');
      expect(capturedBody).toEqual({ sourcePath: 'src/file.ts', destPath: 'src/copy.ts' });
    });
  });

  describe('moveSessionFile', () => {
    it('POSTs sourcePath + destPath and returns success', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/move`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({
            success: true,
            oldPath: 'src/old.ts',
            newPath: 'src/dir/old.ts',
          });
        })
      );

      const result = await moveSessionFile('ws-1', 'session-1', 'src/old.ts', 'src/dir/old.ts');
      expect(capturedBody).toEqual({
        sourcePath: 'src/old.ts',
        destPath: 'src/dir/old.ts',
      });
      expect(result.newPath).toBe('src/dir/old.ts');
    });
  });

  describe('discardSessionFileChanges', () => {
    it('POSTs path and returns success', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${SESSION_BASE}/files/discard`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ success: true });
        })
      );

      const result = await discardSessionFileChanges('ws-1', 'session-1', 'src/file.ts');
      expect(capturedBody).toEqual({ path: 'src/file.ts' });
      expect(result.success).toBe(true);
    });
  });
});
