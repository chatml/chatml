import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getFileDiff,
  getSessionFileDiff,
  getSessionFileContent,
  listSessionFiles,
  listFileTabs,
  saveFileTabs,
  deleteFileTab,
  fetchAttachmentData,
  getSessionFileRawUrl,
  getSessionFileRawAtRefUrl,
  saveFile,
  type FileDiffDTO,
  type FileTabDTO,
} from '../files';
import { ApiError } from '../base';

const API_BASE = 'http://localhost:9876';

const mockDiff: FileDiffDTO = {
  path: 'src/app.tsx',
  oldContent: 'old',
  newContent: 'new',
  oldFilename: 'src/app.tsx',
  newFilename: 'src/app.tsx',
  hasConflict: false,
  isDeleted: false,
};

const mockTab: FileTabDTO = {
  id: 'tab-1',
  workspaceId: 'ws-1',
  sessionId: 'session-1',
  path: 'src/app.tsx',
  viewMode: 'file',
  isPinned: false,
  position: 0,
  openedAt: '2026-04-26T10:00:00Z',
  lastAccessedAt: '2026-04-26T11:00:00Z',
};

describe('lib/api/files', () => {
  describe('getFileDiff', () => {
    it('returns diff for a repo file (no base branch)', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/diff`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json(mockDiff);
        })
      );

      const diff = await getFileDiff('ws-1', 'src/app.tsx');

      expect(diff.path).toBe('src/app.tsx');
      expect(diff.hasConflict).toBe(false);
      const params = new URLSearchParams(capturedSearch);
      expect(params.get('path')).toBe('src/app.tsx');
      expect(params.has('base')).toBe(false);
    });

    it('appends base branch when provided', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/diff`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json(mockDiff);
        })
      );

      await getFileDiff('ws-1', 'src/app.tsx', 'origin/develop');

      const params = new URLSearchParams(capturedSearch);
      expect(params.get('base')).toBe('origin/develop');
    });

    it('reports conflict and truncation flags from backend', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:repoId/diff`, () =>
          HttpResponse.json({
            ...mockDiff,
            hasConflict: true,
            truncated: true,
            unifiedDiff: '@@ -1 +1 @@\n-old\n+new',
          })
        )
      );

      const diff = await getFileDiff('ws-1', 'src/app.tsx');
      expect(diff.hasConflict).toBe(true);
      expect(diff.truncated).toBe(true);
      expect(diff.unifiedDiff).toContain('+new');
    });
  });

  describe('getSessionFileDiff', () => {
    it('returns session-scoped diff', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/diff`, () =>
          HttpResponse.json(mockDiff)
        )
      );

      const diff = await getSessionFileDiff('ws-1', 'session-1', 'src/app.tsx');
      expect(diff.path).toBe('src/app.tsx');
    });

    it('forwards AbortSignal', async () => {
      // Abort BEFORE invoking so the implementation sees an already-aborted
      // signal — no real-time race against MSW.
      const controller = new AbortController();
      controller.abort();
      await expect(
        getSessionFileDiff('ws-1', 'session-1', 'src/app.tsx', controller.signal)
      ).rejects.toThrow();
    });
  });

  describe('getSessionFileContent', () => {
    it('returns file content for a session', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file`, () =>
          HttpResponse.json({
            path: 'src/app.tsx',
            name: 'app.tsx',
            content: 'export const x = 1;',
            size: 19,
          })
        )
      );

      const file = await getSessionFileContent('ws-1', 'session-1', 'src/app.tsx');
      expect(file.content).toBe('export const x = 1;');
      expect(file.size).toBe(19);
    });

    it('encodes file paths with special characters', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/file`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ path: 'a', name: 'a', content: '', size: 0 });
        })
      );

      await getSessionFileContent('ws-1', 'session-1', 'src/foo bar/baz.ts');

      // encodeURIComponent encodes spaces as %20, slashes as %2F
      expect(capturedUrl).toContain('path=src%2Ffoo%20bar%2Fbaz.ts');
    });
  });

  describe('listSessionFiles', () => {
    it('returns flat node list when depth=all', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/files`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([
            { name: 'src', path: 'src', isDir: true, children: [] },
            { name: 'app.tsx', path: 'src/app.tsx', isDir: false },
          ]);
        })
      );

      const nodes = await listSessionFiles('ws-1', 'session-1');

      expect(nodes).toHaveLength(2);
      expect(nodes[0].isDir).toBe(true);
      expect(nodes[1].isDir).toBe(false);
      expect(new URLSearchParams(capturedSearch).get('maxDepth')).toBe('all');
    });

    it('forwards numeric depth', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/files`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([]);
        })
      );

      await listSessionFiles('ws-1', 'session-1', 2);
      expect(new URLSearchParams(capturedSearch).get('maxDepth')).toBe('2');
    });
  });

  describe('listFileTabs', () => {
    it('returns tabs for a workspace', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/tabs`, () =>
          HttpResponse.json([mockTab])
        )
      );

      const tabs = await listFileTabs('ws-1');
      expect(tabs).toHaveLength(1);
      expect(tabs[0].path).toBe('src/app.tsx');
      expect(tabs[0].viewMode).toBe('file');
    });
  });

  describe('saveFileTabs', () => {
    it('POSTs tabs array wrapped in { tabs }', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/tabs`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await saveFileTabs('ws-1', [mockTab]);
      expect(capturedBody).toEqual({ tabs: [mockTab] });
    });

    it('throws ApiError on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/tabs`, () =>
          HttpResponse.text('persist error', { status: 500 })
        )
      );

      await expect(saveFileTabs('ws-1', [mockTab])).rejects.toBeInstanceOf(ApiError);
      await expect(saveFileTabs('ws-1', [mockTab])).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('deleteFileTab', () => {
    it('DELETEs the tab and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/tabs/:tabId`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteFileTab('ws-1', 'tab-1');
      expect(capturedMethod).toBe('DELETE');
    });

    it('throws ApiError with custom message when delete fails', async () => {
      server.use(
        http.delete(`${API_BASE}/api/repos/:workspaceId/tabs/:tabId`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(deleteFileTab('ws-1', 'tab-1')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to delete file tab',
      });
    });
  });

  describe('fetchAttachmentData', () => {
    it('returns base64 data when present', async () => {
      server.use(
        http.get(`${API_BASE}/api/attachments/:attachmentId/data`, () =>
          HttpResponse.json({ base64Data: 'aGVsbG8=' })
        )
      );

      const data = await fetchAttachmentData('att-1');
      expect(data).toBe('aGVsbG8=');
    });

    it('returns null when backend response has empty base64Data', async () => {
      server.use(
        http.get(`${API_BASE}/api/attachments/:attachmentId/data`, () =>
          HttpResponse.json({ base64Data: '' })
        )
      );

      const data = await fetchAttachmentData('att-1');
      expect(data).toBeNull();
    });

    it('encodes attachment IDs containing slashes', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/attachments/:attachmentId/data`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json({ base64Data: 'x' });
        })
      );

      await fetchAttachmentData('namespace/id');
      expect(capturedUrl).toContain('namespace%2Fid');
    });
  });

  describe('getSessionFileRawUrl', () => {
    it('builds URL without token', () => {
      const url = getSessionFileRawUrl('ws-1', 'session-1', 'src/app.tsx');
      expect(url).toBe(
        `${API_BASE}/api/repos/ws-1/sessions/session-1/file-raw?path=src%2Fapp.tsx`
      );
    });

    it('appends token when provided', () => {
      const url = getSessionFileRawUrl('ws-1', 'session-1', 'src/app.tsx', 'tok-123');
      const search = new URL(url).searchParams;
      expect(search.get('path')).toBe('src/app.tsx');
      expect(search.get('token')).toBe('tok-123');
    });

    it('omits token when null', () => {
      const url = getSessionFileRawUrl('ws-1', 'session-1', 'src/app.tsx', null);
      expect(new URL(url).searchParams.has('token')).toBe(false);
    });
  });

  describe('getSessionFileRawAtRefUrl', () => {
    it('builds URL with path and ref params', () => {
      const url = getSessionFileRawAtRefUrl('ws-1', 'session-1', 'src/app.tsx', 'sha-99');
      const search = new URL(url).searchParams;
      expect(search.get('path')).toBe('src/app.tsx');
      expect(search.get('ref')).toBe('sha-99');
      expect(search.has('token')).toBe(false);
    });

    it('appends token when provided', () => {
      const url = getSessionFileRawAtRefUrl(
        'ws-1',
        'session-1',
        'src/app.tsx',
        'sha-99',
        'tok-abc'
      );
      expect(new URL(url).searchParams.get('token')).toBe('tok-abc');
    });
  });

  describe('saveFile', () => {
    it('POSTs path + content for repo-level save (no sessionId)', async () => {
      let capturedUrl = '';
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/file/save`, async ({ request }) => {
          capturedUrl = request.url;
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await saveFile('ws-1', 'src/app.tsx', 'export const x = 1;');

      expect(capturedUrl).toBe(`${API_BASE}/api/repos/ws-1/file/save`);
      expect(capturedBody).toEqual({ path: 'src/app.tsx', content: 'export const x = 1;' });
    });

    it('appends sessionId query param when provided', async () => {
      let capturedUrl = '';
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/file/save`, ({ request }) => {
          capturedUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await saveFile('ws-1', 'src/app.tsx', 'content', 'session-1');
      expect(capturedUrl).toContain('?sessionId=session-1');
    });

    it('encodes sessionId values with special characters', async () => {
      let capturedUrl = '';
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/file/save`, ({ request }) => {
          capturedUrl = request.url;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await saveFile('ws-1', 'a', 'b', 'session id with spaces');
      expect(capturedUrl).toContain('sessionId=session%20id%20with%20spaces');
    });

    it('throws ApiError on backend rejection', async () => {
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/file/save`, () =>
          HttpResponse.text('disk full', { status: 507 })
        )
      );

      await expect(saveFile('ws-1', 'a', 'b')).rejects.toMatchObject({
        status: 507,
        message: 'disk full',
      });
    });
  });
});
