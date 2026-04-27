import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listSkills,
  listInstalledSkills,
  installSkill,
  uninstallSkill,
  getSkillContent,
  listUserCommands,
  getAvailableAgents,
  getEnabledAgents,
  setEnabledAgents,
  type SkillDTO,
  type AvailableAgentDTO,
} from '../skills';

const API_BASE = 'http://localhost:9876';

const mockSkill: SkillDTO = {
  id: 'skill-1',
  name: 'Code Review',
  description: 'Reviews code for best practices.',
  category: 'quality',
  author: 'anthropic',
  version: '1.0.0',
  preview: 'Use when reviewing code...',
  skillPath: 'plugins/code-review',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  installed: false,
};

describe('lib/api/skills', () => {
  describe('listSkills', () => {
    it('returns all skills with no params (no query string)', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/skills`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([mockSkill]);
        })
      );

      const skills = await listSkills();
      expect(skills).toHaveLength(1);
      expect(capturedUrl).toBe(`${API_BASE}/api/skills`);
    });

    it('appends category and search params', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/skills`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([]);
        })
      );

      await listSkills({ category: 'quality', search: 'review' });
      const params = new URLSearchParams(capturedSearch);
      expect(params.get('category')).toBe('quality');
      expect(params.get('search')).toBe('review');
    });

    it('forwards AbortSignal', async () => {
      const controller = new AbortController();
      server.use(
        http.get(`${API_BASE}/api/skills`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json([]);
        })
      );

      const promise = listSkills(undefined, controller.signal);
      controller.abort();
      await expect(promise).rejects.toThrow();
    });
  });

  describe('listInstalledSkills', () => {
    it('returns installed skills', async () => {
      server.use(
        http.get(`${API_BASE}/api/skills/installed`, () =>
          HttpResponse.json([{ ...mockSkill, installed: true, installedAt: '2026-04-01T00:00:00Z' }])
        )
      );

      const skills = await listInstalledSkills();
      expect(skills[0].installed).toBe(true);
      expect(skills[0].installedAt).toBe('2026-04-01T00:00:00Z');
    });
  });

  describe('installSkill', () => {
    it('POSTs to /install and resolves', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/skills/:skillId/install`, ({ request }) => {
          capturedUrl = request.url;
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await installSkill('skill-1');
      expect(capturedMethod).toBe('POST');
      expect(capturedUrl).toContain('/skills/skill-1/install');
    });

    it('throws ApiError with install message on failure', async () => {
      server.use(
        http.post(`${API_BASE}/api/skills/:skillId/install`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(installSkill('skill-1')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to install skill',
      });
    });
  });

  describe('uninstallSkill', () => {
    it('DELETEs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/skills/:skillId/uninstall`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await uninstallSkill('skill-1');
      expect(capturedMethod).toBe('DELETE');
    });

    it('throws ApiError with uninstall message on failure', async () => {
      server.use(
        http.delete(`${API_BASE}/api/skills/:skillId/uninstall`, () =>
          HttpResponse.text('', { status: 500 })
        )
      );

      await expect(uninstallSkill('skill-1')).rejects.toMatchObject({
        status: 500,
        message: 'Failed to uninstall skill',
      });
    });
  });

  describe('getSkillContent', () => {
    it('returns skill markdown content', async () => {
      server.use(
        http.get(`${API_BASE}/api/skills/:skillId/content`, () =>
          HttpResponse.json({
            id: 'skill-1',
            name: 'Code Review',
            skillPath: 'plugins/code-review',
            content: '# Code Review\n\nUse this when reviewing code.',
          })
        )
      );

      const content = await getSkillContent('skill-1');
      expect(content.id).toBe('skill-1');
      expect(content.content).toContain('# Code Review');
    });
  });

  describe('listUserCommands', () => {
    it('returns user commands for a session', async () => {
      let capturedUrl = '';
      server.use(
        http.get(
          `${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/commands`,
          ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json([
              {
                name: 'deploy',
                description: 'Deploy to production',
                filePath: '.claude/commands/deploy.md',
                content: 'Run the deploy script',
              },
            ]);
          }
        )
      );

      const commands = await listUserCommands('ws-1', 'session-1');
      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe('deploy');
      expect(capturedUrl).toContain('/sessions/session-1/commands');
    });
  });

  describe('getAvailableAgents', () => {
    it('returns available agents', async () => {
      const agent: AvailableAgentDTO = {
        name: 'code-reviewer',
        description: 'Reviews code',
        model: 'claude-sonnet-4-6',
        tools: ['Read', 'Grep'],
        enabledDefault: true,
      };
      server.use(
        http.get(`${API_BASE}/api/settings/available-agents`, () =>
          HttpResponse.json([agent])
        )
      );

      const agents = await getAvailableAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('code-reviewer');
      expect(agents[0].tools).toEqual(['Read', 'Grep']);
    });
  });

  describe('getEnabledAgents', () => {
    it('returns array of enabled agent names', async () => {
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/settings/enabled-agents`, () =>
          HttpResponse.json(['code-reviewer', 'security-audit'])
        )
      );

      const enabled = await getEnabledAgents('ws-1');
      expect(enabled).toEqual(['code-reviewer', 'security-audit']);
    });
  });

  describe('setEnabledAgents', () => {
    it('PUTs the array and returns the saved list', async () => {
      let capturedBody: unknown;
      let capturedMethod = '';
      server.use(
        http.put(
          `${API_BASE}/api/repos/:workspaceId/settings/enabled-agents`,
          async ({ request }) => {
            capturedMethod = request.method;
            capturedBody = await request.json();
            return HttpResponse.json(['code-reviewer']);
          }
        )
      );

      const result = await setEnabledAgents('ws-1', ['code-reviewer']);
      expect(capturedMethod).toBe('PUT');
      expect(capturedBody).toEqual(['code-reviewer']);
      expect(result).toEqual(['code-reviewer']);
    });
  });
});
