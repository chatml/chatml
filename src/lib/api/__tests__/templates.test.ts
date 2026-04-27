import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  getPRTemplate,
  setPRTemplate,
  getGlobalPRTemplate,
  setGlobalPRTemplate,
  getGlobalReviewPrompts,
  setGlobalReviewPrompts,
  getWorkspaceReviewPrompts,
  setWorkspaceReviewPrompts,
  getGlobalActionTemplates,
  setGlobalActionTemplates,
  getWorkspaceActionTemplates,
  setWorkspaceActionTemplates,
  getCustomInstructions,
  setCustomInstructions,
} from '../templates';

const API_BASE = 'http://localhost:9876';

describe('lib/api/templates', () => {
  describe('PR template (workspace-scoped)', () => {
    it('getPRTemplate unwraps template field', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/settings/pr-template`, () =>
          HttpResponse.json({ template: '## Summary\n\n...' })
        )
      );

      expect(await getPRTemplate('ws-1')).toBe('## Summary\n\n...');
    });

    it('setPRTemplate PUTs template and resolves', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/settings/pr-template`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setPRTemplate('ws-1', '## new');
      expect(capturedBody).toEqual({ template: '## new' });
    });

    it('setPRTemplate throws ApiError with custom message on failure', async () => {
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/settings/pr-template`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(setPRTemplate('ws-1', '')).rejects.toMatchObject({
        message: 'Failed to save PR template',
      });
    });
  });

  describe('PR template (global)', () => {
    it('getGlobalPRTemplate unwraps template field', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/pr-template`, () =>
          HttpResponse.json({ template: 'global ## summary' })
        )
      );

      expect(await getGlobalPRTemplate()).toBe('global ## summary');
    });

    it('setGlobalPRTemplate PUTs template', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/settings/pr-template`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setGlobalPRTemplate('## g');
      expect(capturedBody).toEqual({ template: '## g' });
    });
  });

  describe('Review prompts', () => {
    const mockPrompts = { 'code-review': 'Review code...', security: 'Audit...' };

    it('getGlobalReviewPrompts unwraps prompts record', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/review-prompts`, () =>
          HttpResponse.json({ prompts: mockPrompts })
        )
      );

      expect(await getGlobalReviewPrompts()).toEqual(mockPrompts);
    });

    it('setGlobalReviewPrompts PUTs prompts record', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/settings/review-prompts`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setGlobalReviewPrompts(mockPrompts);
      expect(capturedBody).toEqual({ prompts: mockPrompts });
    });

    it('getWorkspaceReviewPrompts unwraps prompts record', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/settings/review-prompts`, () =>
          HttpResponse.json({ prompts: mockPrompts })
        )
      );

      expect(await getWorkspaceReviewPrompts('ws-1')).toEqual(mockPrompts);
    });

    it('setWorkspaceReviewPrompts PUTs prompts and throws ApiError on failure', async () => {
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/settings/review-prompts`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(setWorkspaceReviewPrompts('ws-1', {})).rejects.toMatchObject({
        message: 'Failed to save workspace review prompts',
      });
    });
  });

  describe('Action templates', () => {
    const mockTemplates = { commit: 'Commit msg...', pr: 'PR template...' };

    it('getGlobalActionTemplates unwraps templates record', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/action-templates`, () =>
          HttpResponse.json({ templates: mockTemplates })
        )
      );

      expect(await getGlobalActionTemplates()).toEqual(mockTemplates);
    });

    it('setGlobalActionTemplates PUTs templates record', async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE}/api/settings/action-templates`, async ({ request }) => {
          capturedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      await setGlobalActionTemplates(mockTemplates);
      expect(capturedBody).toEqual({ templates: mockTemplates });
    });

    it('getWorkspaceActionTemplates unwraps templates record', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/settings/action-templates`, () =>
          HttpResponse.json({ templates: mockTemplates })
        )
      );

      expect(await getWorkspaceActionTemplates('ws-1')).toEqual(mockTemplates);
    });

    it('setWorkspaceActionTemplates throws ApiError on failure', async () => {
      server.use(
        http.put(`${API_BASE}/api/repos/:workspaceId/settings/action-templates`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(setWorkspaceActionTemplates('ws-1', {})).rejects.toMatchObject({
        message: 'Failed to save workspace action templates',
      });
    });
  });

  describe('Custom instructions', () => {
    it('getCustomInstructions unwraps instructions field', async () => {
      server.use(
        http.get(`${API_BASE}/api/settings/custom-instructions`, () =>
          HttpResponse.json({ instructions: 'Always use TS strict mode.' })
        )
      );

      expect(await getCustomInstructions()).toBe('Always use TS strict mode.');
    });

    it('setCustomInstructions PUTs instructions and throws ApiError on failure', async () => {
      server.use(
        http.put(`${API_BASE}/api/settings/custom-instructions`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(setCustomInstructions('hi')).rejects.toMatchObject({
        message: 'Failed to save custom instructions',
      });
    });
  });
});
