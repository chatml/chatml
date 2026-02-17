import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkflowStore } from '../workflowStore';
import type { WorkflowDefinition, WorkflowRun } from '@/lib/types';

// Mock the api module
vi.mock('@/lib/api', () => ({
  listWorkflows: vi.fn(),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  enableWorkflow: vi.fn(),
  triggerWorkflowRun: vi.fn(),
  listWorkflowRuns: vi.fn(),
  getWorkflowRun: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import * as api from '@/lib/api';

const mockWorkflow = (overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: 'wf-1',
  name: 'Test Workflow',
  description: 'A test workflow',
  enabled: true,
  graphJson: '{"nodes":[],"edges":[]}',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const mockRun = (overrides: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: 'run-1',
  workflowId: 'wf-1',
  triggerType: 'manual',
  status: 'pending',
  inputData: '{}',
  outputData: '{}',
  createdAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

function resetStore() {
  useWorkflowStore.setState({
    workflows: [],
    selectedWorkflowId: null,
    runs: {},
    activeRunDetail: null,
    isLoading: false,
    error: null,
    activeRunId: null,
    activeRunWorkflowId: null,
    nodeStatuses: {},
  });
}

describe('workflowStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('has empty workflows and no selection', () => {
      const state = useWorkflowStore.getState();
      expect(state.workflows).toEqual([]);
      expect(state.selectedWorkflowId).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.activeRunId).toBeNull();
      expect(state.nodeStatuses).toEqual({});
    });
  });

  describe('fetchWorkflows', () => {
    it('sets loading state and fetches workflows', async () => {
      const workflows = [mockWorkflow(), mockWorkflow({ id: 'wf-2', name: 'Second' })];
      vi.mocked(api.listWorkflows).mockResolvedValue(workflows);

      await useWorkflowStore.getState().fetchWorkflows();

      const state = useWorkflowStore.getState();
      expect(state.workflows).toEqual(workflows);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets error on failure', async () => {
      const error = new api.ApiError('Network error');
      vi.mocked(api.listWorkflows).mockRejectedValue(error);

      await useWorkflowStore.getState().fetchWorkflows();

      const state = useWorkflowStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.isLoading).toBe(false);
    });

    it('sets generic error for non-ApiError', async () => {
      vi.mocked(api.listWorkflows).mockRejectedValue(new Error('boom'));

      await useWorkflowStore.getState().fetchWorkflows();

      expect(useWorkflowStore.getState().error).toBe('Failed to fetch workflows');
    });
  });

  describe('createWorkflow', () => {
    it('adds new workflow to beginning of list', async () => {
      const existing = mockWorkflow({ id: 'wf-old' });
      useWorkflowStore.setState({ workflows: [existing] });

      const newWf = mockWorkflow({ id: 'wf-new', name: 'New' });
      vi.mocked(api.createWorkflow).mockResolvedValue(newWf);

      const result = await useWorkflowStore.getState().createWorkflow('New');

      expect(result).toEqual(newWf);
      expect(useWorkflowStore.getState().workflows[0].id).toBe('wf-new');
      expect(useWorkflowStore.getState().workflows).toHaveLength(2);
    });
  });

  describe('updateWorkflow', () => {
    it('replaces workflow in list', async () => {
      useWorkflowStore.setState({ workflows: [mockWorkflow()] });

      const updated = mockWorkflow({ name: 'Updated Name' });
      vi.mocked(api.updateWorkflow).mockResolvedValue(updated);

      await useWorkflowStore.getState().updateWorkflow('wf-1', { name: 'Updated Name' });

      expect(useWorkflowStore.getState().workflows[0].name).toBe('Updated Name');
    });

    it('only updates matching workflow', async () => {
      const wf1 = mockWorkflow({ id: 'wf-1', name: 'First' });
      const wf2 = mockWorkflow({ id: 'wf-2', name: 'Second' });
      useWorkflowStore.setState({ workflows: [wf1, wf2] });

      const updated = mockWorkflow({ id: 'wf-1', name: 'Updated' });
      vi.mocked(api.updateWorkflow).mockResolvedValue(updated);

      await useWorkflowStore.getState().updateWorkflow('wf-1', { name: 'Updated' });

      const workflows = useWorkflowStore.getState().workflows;
      expect(workflows[0].name).toBe('Updated');
      expect(workflows[1].name).toBe('Second');
    });
  });

  describe('deleteWorkflow', () => {
    it('removes workflow from list', async () => {
      useWorkflowStore.setState({
        workflows: [mockWorkflow({ id: 'wf-1' }), mockWorkflow({ id: 'wf-2' })],
      });
      vi.mocked(api.deleteWorkflow).mockResolvedValue(undefined);

      await useWorkflowStore.getState().deleteWorkflow('wf-1');

      const workflows = useWorkflowStore.getState().workflows;
      expect(workflows).toHaveLength(1);
      expect(workflows[0].id).toBe('wf-2');
    });

    it('clears selectedWorkflowId if deleted', async () => {
      useWorkflowStore.setState({
        workflows: [mockWorkflow()],
        selectedWorkflowId: 'wf-1',
      });
      vi.mocked(api.deleteWorkflow).mockResolvedValue(undefined);

      await useWorkflowStore.getState().deleteWorkflow('wf-1');

      expect(useWorkflowStore.getState().selectedWorkflowId).toBeNull();
    });

    it('preserves selectedWorkflowId if different', async () => {
      useWorkflowStore.setState({
        workflows: [mockWorkflow({ id: 'wf-1' }), mockWorkflow({ id: 'wf-2' })],
        selectedWorkflowId: 'wf-2',
      });
      vi.mocked(api.deleteWorkflow).mockResolvedValue(undefined);

      await useWorkflowStore.getState().deleteWorkflow('wf-1');

      expect(useWorkflowStore.getState().selectedWorkflowId).toBe('wf-2');
    });
  });

  describe('toggleWorkflow', () => {
    it('updates enabled state in list', async () => {
      useWorkflowStore.setState({ workflows: [mockWorkflow({ enabled: true })] });

      const toggled = mockWorkflow({ enabled: false });
      vi.mocked(api.enableWorkflow).mockResolvedValue(toggled);

      await useWorkflowStore.getState().toggleWorkflow('wf-1', false);

      expect(useWorkflowStore.getState().workflows[0].enabled).toBe(false);
    });
  });

  describe('selectWorkflow', () => {
    it('sets selected workflow id', () => {
      useWorkflowStore.getState().selectWorkflow('wf-1');
      expect(useWorkflowStore.getState().selectedWorkflowId).toBe('wf-1');
    });

    it('clears selection with null', () => {
      useWorkflowStore.setState({ selectedWorkflowId: 'wf-1' });
      useWorkflowStore.getState().selectWorkflow(null);
      expect(useWorkflowStore.getState().selectedWorkflowId).toBeNull();
    });
  });

  describe('triggerRun', () => {
    it('adds run to beginning of runs list', async () => {
      const existingRun = mockRun({ id: 'run-old' });
      useWorkflowStore.setState({ runs: { 'wf-1': [existingRun] } });

      const newRun = mockRun({ id: 'run-new' });
      vi.mocked(api.triggerWorkflowRun).mockResolvedValue(newRun);

      const result = await useWorkflowStore.getState().triggerRun('wf-1');

      expect(result).toEqual(newRun);
      const runs = useWorkflowStore.getState().runs['wf-1'];
      expect(runs).toHaveLength(2);
      expect(runs[0].id).toBe('run-new');
    });

    it('creates new runs array if none exists', async () => {
      const run = mockRun();
      vi.mocked(api.triggerWorkflowRun).mockResolvedValue(run);

      await useWorkflowStore.getState().triggerRun('wf-1');

      expect(useWorkflowStore.getState().runs['wf-1']).toHaveLength(1);
    });
  });

  describe('fetchRuns', () => {
    it('sets runs for workflow', async () => {
      const runs = [mockRun(), mockRun({ id: 'run-2' })];
      vi.mocked(api.listWorkflowRuns).mockResolvedValue(runs);

      await useWorkflowStore.getState().fetchRuns('wf-1');

      expect(useWorkflowStore.getState().runs['wf-1']).toEqual(runs);
    });
  });

  describe('fetchRunDetail', () => {
    it('sets activeRunDetail', async () => {
      const detail = { ...mockRun(), steps: [] };
      vi.mocked(api.getWorkflowRun).mockResolvedValue(detail);

      await useWorkflowStore.getState().fetchRunDetail('wf-1', 'run-1');

      expect(useWorkflowStore.getState().activeRunDetail).toEqual(detail);
    });
  });

  describe('cancelRun', () => {
    it('updates run status in list', async () => {
      useWorkflowStore.setState({
        runs: { 'wf-1': [mockRun({ id: 'run-1', status: 'running' })] },
      });
      const cancelled = mockRun({ id: 'run-1', status: 'cancelled' });
      vi.mocked(api.cancelWorkflowRun).mockResolvedValue(cancelled);

      await useWorkflowStore.getState().cancelRun('wf-1', 'run-1');

      expect(useWorkflowStore.getState().runs['wf-1'][0].status).toBe('cancelled');
    });
  });

  // WebSocket event handlers

  describe('onRunStarted', () => {
    it('sets active run and resets node statuses', () => {
      useWorkflowStore.setState({
        nodeStatuses: { 'old-node': { status: 'completed' } },
      });

      useWorkflowStore.getState().onRunStarted('wf-1', 'run-1');

      const state = useWorkflowStore.getState();
      expect(state.activeRunId).toBe('run-1');
      expect(state.activeRunWorkflowId).toBe('wf-1');
      expect(state.nodeStatuses).toEqual({});
    });
  });

  describe('onNodeStarted', () => {
    it('sets node status to running', () => {
      useWorkflowStore.setState({ activeRunId: 'run-1' });

      useWorkflowStore.getState().onNodeStarted('run-1', 'node-1');

      expect(useWorkflowStore.getState().nodeStatuses['node-1']).toEqual({ status: 'running' });
    });

    it('ignores events for different run', () => {
      useWorkflowStore.setState({ activeRunId: 'run-1' });

      useWorkflowStore.getState().onNodeStarted('run-other', 'node-1');

      expect(useWorkflowStore.getState().nodeStatuses['node-1']).toBeUndefined();
    });
  });

  describe('onNodeCompleted', () => {
    it('sets node status with duration and error', () => {
      useWorkflowStore.setState({ activeRunId: 'run-1' });

      useWorkflowStore.getState().onNodeCompleted('run-1', 'node-1', 'failed', 500, 'timeout');

      expect(useWorkflowStore.getState().nodeStatuses['node-1']).toEqual({
        status: 'failed',
        durationMs: 500,
        error: 'timeout',
      });
    });

    it('ignores events for different run', () => {
      useWorkflowStore.setState({ activeRunId: 'run-1' });

      useWorkflowStore.getState().onNodeCompleted('run-other', 'node-1', 'completed');

      expect(useWorkflowStore.getState().nodeStatuses['node-1']).toBeUndefined();
    });
  });

  describe('onRunCompleted', () => {
    it('updates run status in list and clears active run', () => {
      useWorkflowStore.setState({
        activeRunId: 'run-1',
        activeRunWorkflowId: 'wf-1',
        runs: { 'wf-1': [mockRun({ id: 'run-1', status: 'running' })] },
      });

      useWorkflowStore.getState().onRunCompleted('wf-1', 'run-1', 'completed', 1234);

      const state = useWorkflowStore.getState();
      expect(state.runs['wf-1'][0].status).toBe('completed');
      expect(state.activeRunId).toBeNull();
      expect(state.activeRunWorkflowId).toBeNull();
    });

    it('does not clear active run if different run completes', () => {
      useWorkflowStore.setState({
        activeRunId: 'run-1',
        activeRunWorkflowId: 'wf-1',
        runs: { 'wf-1': [mockRun({ id: 'run-1' }), mockRun({ id: 'run-2' })] },
      });

      useWorkflowStore.getState().onRunCompleted('wf-1', 'run-2', 'completed');

      expect(useWorkflowStore.getState().activeRunId).toBe('run-1');
    });

    it('handles missing runs gracefully', () => {
      useWorkflowStore.getState().onRunCompleted('wf-unknown', 'run-1', 'completed');

      expect(useWorkflowStore.getState().runs['wf-unknown']).toEqual([]);
    });
  });
});
