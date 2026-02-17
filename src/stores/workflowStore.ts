import { create } from 'zustand';
import * as api from '@/lib/api';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunDetail } from '@/lib/types';

export type NodeExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeStatus {
  status: NodeExecutionStatus;
  durationMs?: number;
  error?: string;
}

interface WorkflowState {
  // State
  workflows: WorkflowDefinition[];
  selectedWorkflowId: string | null;
  runs: Record<string, WorkflowRun[]>;
  activeRunDetail: WorkflowRunDetail | null;
  isLoading: boolean;
  error: string | null;

  // Real-time execution state (driven by WebSocket events)
  activeRunId: string | null;
  activeRunWorkflowId: string | null;
  nodeStatuses: Record<string, NodeStatus>; // nodeId -> status

  // Actions
  fetchWorkflows: () => Promise<void>;
  createWorkflow: (name: string, description?: string) => Promise<WorkflowDefinition>;
  updateWorkflow: (id: string, data: {
    name?: string;
    description?: string;
    enabled?: boolean;
    graphJson?: string;
    toolPolicy?: string;
  }) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  toggleWorkflow: (id: string, enabled: boolean) => Promise<void>;
  selectWorkflow: (id: string | null) => void;
  triggerRun: (workflowId: string, inputData?: string) => Promise<WorkflowRun>;
  fetchRuns: (workflowId: string) => Promise<void>;
  fetchRunDetail: (workflowId: string, runId: string) => Promise<void>;
  cancelRun: (workflowId: string, runId: string) => Promise<void>;

  // WebSocket-driven actions
  onRunStarted: (workflowId: string, runId: string) => void;
  onNodeStarted: (runId: string, nodeId: string) => void;
  onNodeCompleted: (runId: string, nodeId: string, status: NodeExecutionStatus, durationMs?: number, error?: string) => void;
  onRunCompleted: (workflowId: string, runId: string, status: string, durationMs?: number) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  selectedWorkflowId: null,
  runs: {},
  activeRunDetail: null,
  isLoading: false,
  error: null,
  activeRunId: null,
  activeRunWorkflowId: null,
  nodeStatuses: {},

  fetchWorkflows: async () => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await api.listWorkflows();
      set({ workflows, isLoading: false });
    } catch (err) {
      const message = err instanceof api.ApiError ? err.message : 'Failed to fetch workflows';
      set({ error: message, isLoading: false });
    }
  },

  createWorkflow: async (name, description) => {
    const workflow = await api.createWorkflow({ name, description });
    set((state) => ({ workflows: [workflow, ...state.workflows] }));
    return workflow;
  },

  updateWorkflow: async (id, data) => {
    const updated = await api.updateWorkflow(id, data);
    set((state) => ({
      workflows: state.workflows.map((w) => (w.id === id ? updated : w)),
    }));
  },

  deleteWorkflow: async (id) => {
    await api.deleteWorkflow(id);
    set((state) => ({
      workflows: state.workflows.filter((w) => w.id !== id),
      selectedWorkflowId: state.selectedWorkflowId === id ? null : state.selectedWorkflowId,
    }));
  },

  toggleWorkflow: async (id, enabled) => {
    const updated = await api.enableWorkflow(id, enabled);
    set((state) => ({
      workflows: state.workflows.map((w) => (w.id === id ? updated : w)),
    }));
  },

  selectWorkflow: (id) => set({ selectedWorkflowId: id }),

  triggerRun: async (workflowId, inputData) => {
    const run = await api.triggerWorkflowRun(workflowId, inputData);
    set((state) => ({
      runs: {
        ...state.runs,
        [workflowId]: [run, ...(state.runs[workflowId] || [])],
      },
    }));
    return run;
  },

  fetchRuns: async (workflowId) => {
    const runs = await api.listWorkflowRuns(workflowId);
    set((state) => ({
      runs: { ...state.runs, [workflowId]: runs },
    }));
  },

  fetchRunDetail: async (workflowId, runId) => {
    const detail = await api.getWorkflowRun(workflowId, runId);
    set({ activeRunDetail: detail });
  },

  cancelRun: async (workflowId, runId) => {
    const cancelled = await api.cancelWorkflowRun(workflowId, runId);
    set((state) => ({
      runs: {
        ...state.runs,
        [workflowId]: (state.runs[workflowId] || []).map((r) =>
          r.id === runId ? cancelled : r
        ),
      },
    }));
  },

  // WebSocket event handlers

  onRunStarted: (workflowId, runId) => {
    set({ activeRunId: runId, activeRunWorkflowId: workflowId, nodeStatuses: {} });
  },

  onNodeStarted: (runId, nodeId) => {
    const state = get();
    if (state.activeRunId !== runId) return;
    set({
      nodeStatuses: {
        ...state.nodeStatuses,
        [nodeId]: { status: 'running' },
      },
    });
  },

  onNodeCompleted: (runId, nodeId, status, durationMs, error) => {
    const state = get();
    if (state.activeRunId !== runId) return;
    set({
      nodeStatuses: {
        ...state.nodeStatuses,
        [nodeId]: { status, durationMs, error },
      },
    });
  },

  onRunCompleted: (workflowId, runId, status, durationMs) => {
    const state = get();
    // Update the run in the runs list
    const runs = state.runs[workflowId] || [];
    const updatedRuns = runs.map((r) =>
      r.id === runId ? { ...r, status: status as WorkflowRun['status'] } : r
    );
    set({
      runs: { ...state.runs, [workflowId]: updatedRuns },
      // Clear active run if it matches
      ...(state.activeRunId === runId ? { activeRunId: null, activeRunWorkflowId: null } : {}),
    });

    // Suppress unused parameter warning
    void durationMs;
  },
}));
