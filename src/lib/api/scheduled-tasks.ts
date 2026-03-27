import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse } from './base';
import type { ScheduledTask, ScheduledTaskRun, ScheduledTaskFrequency } from '@/lib/types';

export interface CreateScheduledTaskRequest {
  name: string;
  description?: string;
  prompt: string;
  model?: string;
  permissionMode?: string;
  frequency?: ScheduledTaskFrequency;
  cronExpression?: string;
  scheduleHour?: number;
  scheduleMinute?: number;
  scheduleDayOfWeek?: number;
  scheduleDayOfMonth?: number;
}

export async function listAllScheduledTasks(): Promise<ScheduledTask[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/scheduled-tasks`);
  return handleResponse<ScheduledTask[]>(res);
}

export async function listScheduledTasks(workspaceId: string): Promise<ScheduledTask[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/scheduled-tasks`);
  return handleResponse<ScheduledTask[]>(res);
}

export async function createScheduledTask(
  workspaceId: string,
  data: CreateScheduledTaskRequest
): Promise<ScheduledTask> {
  const res = await fetchWithAuth(`${getApiBase()}/api/repos/${workspaceId}/scheduled-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<ScheduledTask>(res);
}

export async function getScheduledTask(taskId: string): Promise<ScheduledTask> {
  const res = await fetchWithAuth(`${getApiBase()}/api/scheduled-tasks/${taskId}`);
  return handleResponse<ScheduledTask>(res);
}

export async function updateScheduledTask(
  taskId: string,
  updates: Partial<Omit<ScheduledTask, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt'>>
): Promise<ScheduledTask> {
  const res = await fetchWithAuth(`${getApiBase()}/api/scheduled-tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return handleResponse<ScheduledTask>(res);
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/scheduled-tasks/${taskId}`, {
    method: 'DELETE',
  });
  return handleVoidResponse(res);
}

export async function listScheduledTaskRuns(
  taskId: string,
  limit?: number
): Promise<ScheduledTaskRun[]> {
  const params = limit ? `?limit=${limit}` : '';
  const res = await fetchWithAuth(`${getApiBase()}/api/scheduled-tasks/${taskId}/runs${params}`);
  return handleResponse<ScheduledTaskRun[]>(res);
}

export async function triggerScheduledTask(taskId: string): Promise<ScheduledTaskRun> {
  const res = await fetchWithAuth(`${getApiBase()}/api/scheduled-tasks/${taskId}/trigger`, {
    method: 'POST',
  });
  return handleResponse<ScheduledTaskRun>(res);
}
