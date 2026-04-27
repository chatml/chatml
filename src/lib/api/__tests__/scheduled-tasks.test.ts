import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/__mocks__/server';
import {
  listAllScheduledTasks,
  listScheduledTasks,
  createScheduledTask,
  getScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  listScheduledTaskRuns,
  triggerScheduledTask,
} from '../scheduled-tasks';
import type { ScheduledTask, ScheduledTaskRun } from '@/lib/types';

const API_BASE = 'http://localhost:9876';

const mockTask = {
  id: 'task-1',
  workspaceId: 'ws-1',
  name: 'Nightly review',
  prompt: 'Review the latest changes',
  frequency: 'daily',
  scheduleHour: 23,
  scheduleMinute: 0,
  createdAt: '2026-04-26T00:00:00Z',
  updatedAt: '2026-04-26T00:00:00Z',
} as unknown as ScheduledTask;

const mockTaskRun = {
  id: 'run-1',
  taskId: 'task-1',
  status: 'completed',
  startedAt: '2026-04-26T23:00:00Z',
  completedAt: '2026-04-26T23:05:00Z',
} as unknown as ScheduledTaskRun;

describe('lib/api/scheduled-tasks', () => {
  describe('listAllScheduledTasks', () => {
    it('returns all scheduled tasks across workspaces', async () => {
      server.use(
        http.get(`${API_BASE}/api/scheduled-tasks`, () =>
          HttpResponse.json([mockTask])
        )
      );

      const tasks = await listAllScheduledTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-1');
    });
  });

  describe('listScheduledTasks', () => {
    it('returns tasks for a workspace', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/repos/:workspaceId/scheduled-tasks`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([mockTask]);
        })
      );

      const tasks = await listScheduledTasks('ws-1');
      expect(tasks).toHaveLength(1);
      expect(capturedUrl).toContain('/repos/ws-1/scheduled-tasks');
    });
  });

  describe('createScheduledTask', () => {
    it('POSTs task data and returns created task', async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE}/api/repos/:workspaceId/scheduled-tasks`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json(mockTask);
        })
      );

      const result = await createScheduledTask('ws-1', {
        name: 'Nightly review',
        prompt: 'Review the latest changes',
        frequency: 'daily',
        scheduleHour: 23,
        scheduleMinute: 0,
      });

      expect(capturedBody).toEqual({
        name: 'Nightly review',
        prompt: 'Review the latest changes',
        frequency: 'daily',
        scheduleHour: 23,
        scheduleMinute: 0,
      });
      expect(result.id).toBe('task-1');
    });
  });

  describe('getScheduledTask', () => {
    it('returns a single task by id', async () => {
      server.use(
        http.get(`${API_BASE}/api/scheduled-tasks/:taskId`, () =>
          HttpResponse.json(mockTask)
        )
      );

      const task = await getScheduledTask('task-1');
      expect(task.id).toBe('task-1');
    });
  });

  describe('updateScheduledTask', () => {
    it('PATCHes partial updates and returns updated task', async () => {
      let capturedBody: unknown;
      let capturedMethod = '';
      server.use(
        http.patch(`${API_BASE}/api/scheduled-tasks/:taskId`, async ({ request }) => {
          capturedMethod = request.method;
          capturedBody = await request.json();
          return HttpResponse.json({ ...mockTask, name: 'Updated' });
        })
      );

      const result = await updateScheduledTask('task-1', { name: 'Updated' });
      expect(capturedMethod).toBe('PATCH');
      expect(capturedBody).toEqual({ name: 'Updated' });
      expect((result as { name?: string }).name).toBe('Updated');
    });
  });

  describe('deleteScheduledTask', () => {
    it('DELETEs and resolves', async () => {
      let capturedMethod = '';
      server.use(
        http.delete(`${API_BASE}/api/scheduled-tasks/:taskId`, ({ request }) => {
          capturedMethod = request.method;
          return new HttpResponse(null, { status: 204 });
        })
      );

      await deleteScheduledTask('task-1');
      expect(capturedMethod).toBe('DELETE');
    });
  });

  describe('listScheduledTaskRuns', () => {
    it('returns runs without limit param', async () => {
      let capturedUrl = '';
      server.use(
        http.get(`${API_BASE}/api/scheduled-tasks/:taskId/runs`, ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json([mockTaskRun]);
        })
      );

      const runs = await listScheduledTaskRuns('task-1');
      expect(runs).toHaveLength(1);
      expect(capturedUrl).toBe(`${API_BASE}/api/scheduled-tasks/task-1/runs`);
    });

    it('appends ?limit when provided', async () => {
      let capturedSearch = '';
      server.use(
        http.get(`${API_BASE}/api/scheduled-tasks/:taskId/runs`, ({ request }) => {
          capturedSearch = new URL(request.url).search;
          return HttpResponse.json([]);
        })
      );

      await listScheduledTaskRuns('task-1', 25);
      expect(new URLSearchParams(capturedSearch).get('limit')).toBe('25');
    });
  });

  describe('triggerScheduledTask', () => {
    it('POSTs to /trigger and returns the new run', async () => {
      let capturedMethod = '';
      server.use(
        http.post(`${API_BASE}/api/scheduled-tasks/:taskId/trigger`, ({ request }) => {
          capturedMethod = request.method;
          return HttpResponse.json(mockTaskRun);
        })
      );

      const run = await triggerScheduledTask('task-1');
      expect(capturedMethod).toBe('POST');
      expect(run.id).toBe('run-1');
    });
  });
});
