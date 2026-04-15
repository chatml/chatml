import { create } from 'zustand';
import * as api from '@/lib/api';
import type { ScheduledTask, ScheduledTaskRun } from '@/lib/types';
import type { CreateScheduledTaskRequest } from '@/lib/api/scheduled-tasks';

interface ScheduledTaskState {
  tasks: ScheduledTask[];
  runs: Record<string, ScheduledTaskRun[]>; // taskId -> runs
  isLoading: boolean;
  error: string | null;

  fetchTasks: () => Promise<void>;
  createTask: (workspaceId: string, data: CreateScheduledTaskRequest) => Promise<ScheduledTask>;
  updateTask: (taskId: string, updates: Partial<ScheduledTask>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  archiveTask: (taskId: string) => Promise<void>;
  toggleEnabled: (taskId: string) => Promise<void>;
  fetchRuns: (taskId: string) => Promise<void>;
  triggerNow: (taskId: string) => Promise<void>;
}

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
  tasks: [],
  runs: {},
  isLoading: false,
  error: null,

  fetchTasks: async () => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await api.listAllScheduledTasks();
      set({ tasks, isLoading: false });
    } catch (err) {
      const message = err instanceof api.ApiError ? err.message : 'Failed to fetch scheduled tasks';
      set({ error: message, isLoading: false });
    }
  },

  createTask: async (workspaceId, data) => {
    const task = await api.createScheduledTask(workspaceId, data);
    set((state) => ({ tasks: [task, ...state.tasks] }));
    return task;
  },

  updateTask: async (taskId, updates) => {
    const updated = await api.updateScheduledTask(taskId, updates);
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
    }));
  },

  deleteTask: async (taskId) => {
    await api.deleteScheduledTask(taskId);
    set((state) => {
      const { [taskId]: _, ...remainingRuns } = state.runs;
      return {
        tasks: state.tasks.filter((t) => t.id !== taskId),
        runs: remainingRuns,
      };
    });
  },

  archiveTask: async (taskId) => {
    await api.updateScheduledTask(taskId, { archived: true });
    set((state) => {
      const { [taskId]: _, ...remainingRuns } = state.runs;
      return {
        tasks: state.tasks.filter((t) => t.id !== taskId),
        runs: remainingRuns,
      };
    });
  },

  toggleEnabled: async (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updated = await api.updateScheduledTask(taskId, { enabled: !task.enabled });
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? updated : t)),
    }));
  },

  fetchRuns: async (taskId) => {
    try {
      const runs = await api.listScheduledTaskRuns(taskId, 20);
      set((state) => ({
        runs: { ...state.runs, [taskId]: runs },
      }));
    } catch {
      // Silently fail — runs are supplementary
    }
  },

  triggerNow: async (taskId) => {
    await api.triggerScheduledTask(taskId);
    // Refresh tasks to get updated lastRunAt — only after successful trigger
    await Promise.all([get().fetchTasks(), get().fetchRuns(taskId)]);
  },
}));
