import { create } from 'zustand';
import type {
  OrchestratorAgent,
  AgentRun,
  AgentEvent,
  UpdateAgentRequest,
} from '@/lib/agentTypes';
import { getBackendPortSync } from '@/lib/backend-port';

// Get API base URL dynamically based on the backend port
function getApiBase(): string {
  if (typeof window !== 'undefined' && (window as Window & { __TAURI__?: unknown }).__TAURI__) {
    const port = getBackendPortSync();
    return `http://localhost:${port}`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9876';
}

interface AgentState {
  // State
  agents: OrchestratorAgent[];
  selectedAgentId: string | null;
  agentRuns: Record<string, AgentRun[]>; // agentId -> runs
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchAgents: () => Promise<void>;
  reloadAgents: () => Promise<void>;
  selectAgent: (agentId: string | null) => void;
  updateAgent: (agentId: string, update: UpdateAgentRequest) => Promise<void>;
  triggerRun: (agentId: string) => Promise<AgentRun | null>;
  fetchRuns: (agentId: string, limit?: number) => Promise<void>;
  stopRun: (agentId: string, runId: string) => Promise<void>;

  // Event handlers
  handleAgentEvent: (event: AgentEvent) => void;

  // Helpers
  getAgent: (agentId: string) => OrchestratorAgent | undefined;
  getAgentRuns: (agentId: string) => AgentRun[];
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  selectedAgentId: null,
  agentRuns: {},
  isLoading: false,
  error: null,

  fetchAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${getApiBase()}/api/orchestrator/agents`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      const agents = await res.json();
      set({ agents, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  reloadAgents: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${getApiBase()}/api/orchestrator/agents/reload`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to reload agents');
      // Fetch the updated list
      await get().fetchAgents();
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
    if (agentId) {
      get().fetchRuns(agentId);
    }
  },

  updateAgent: async (agentId, update) => {
    try {
      const res = await fetch(`${getApiBase()}/api/orchestrator/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('Failed to update agent');
      const updatedAgent = await res.json();

      set((state) => ({
        agents: state.agents.map((a) =>
          a.id === agentId ? { ...a, ...updatedAgent } : a
        ),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  triggerRun: async (agentId) => {
    try {
      const res = await fetch(
        `${getApiBase()}/api/orchestrator/agents/${agentId}/run`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('Failed to trigger agent run');
      const run = await res.json();

      // Add to runs list
      set((state) => ({
        agentRuns: {
          ...state.agentRuns,
          [agentId]: [run, ...(state.agentRuns[agentId] || [])],
        },
        agents: state.agents.map((a) =>
          a.id === agentId ? { ...a, isRunning: true } : a
        ),
      }));

      return run;
    } catch (err) {
      set({ error: (err as Error).message });
      return null;
    }
  },

  fetchRuns: async (agentId, limit = 20) => {
    try {
      const res = await fetch(
        `${getApiBase()}/api/orchestrator/agents/${agentId}/runs?limit=${limit}`
      );
      if (!res.ok) throw new Error('Failed to fetch runs');
      const runs = await res.json();

      set((state) => ({
        agentRuns: { ...state.agentRuns, [agentId]: runs },
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  stopRun: async (agentId, runId) => {
    try {
      const res = await fetch(
        `${getApiBase()}/api/orchestrator/agents/${agentId}/runs/${runId}/stop`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error('Failed to stop run');

      // Update run status locally
      set((state) => ({
        agentRuns: {
          ...state.agentRuns,
          [agentId]: (state.agentRuns[agentId] || []).map((r) =>
            r.id === runId ? { ...r, status: 'failed' as const } : r
          ),
        },
        agents: state.agents.map((a) =>
          a.id === agentId ? { ...a, isRunning: false } : a
        ),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  handleAgentEvent: (event) => {
    const { type, agentId, data } = event;

    set((state) => {
      switch (type) {
        case 'agent.state.changed': {
          const stateData = data as { enabled: boolean; lastError?: string };
          return {
            agents: state.agents.map((a) =>
              a.id === agentId
                ? { ...a, enabled: stateData.enabled, lastError: stateData.lastError || null }
                : a
            ),
          };
        }

        case 'agent.run.started': {
          const startData = data as { runId: string; trigger: string };
          const newRun: AgentRun = {
            id: startData.runId,
            agentId,
            trigger: startData.trigger as 'poll' | 'manual' | 'event',
            status: 'running',
            cost: 0,
            startedAt: new Date().toISOString(),
          };
          return {
            agents: state.agents.map((a) =>
              a.id === agentId ? { ...a, isRunning: true } : a
            ),
            agentRuns: {
              ...state.agentRuns,
              [agentId]: [newRun, ...(state.agentRuns[agentId] || [])],
            },
          };
        }

        case 'agent.run.completed': {
          const completeData = data as {
            runId: string;
            status: string;
            resultSummary?: string;
            sessionsCreated?: string[];
            cost: number;
          };
          return {
            agents: state.agents.map((a) =>
              a.id === agentId
                ? {
                    ...a,
                    isRunning: false,
                    lastRunAt: new Date().toISOString(),
                    totalRuns: a.totalRuns + 1,
                    totalCost: a.totalCost + completeData.cost,
                  }
                : a
            ),
            agentRuns: {
              ...state.agentRuns,
              [agentId]: (state.agentRuns[agentId] || []).map((r) =>
                r.id === completeData.runId
                  ? {
                      ...r,
                      status: completeData.status as 'completed' | 'failed',
                      resultSummary: completeData.resultSummary,
                      sessionsCreated: completeData.sessionsCreated,
                      cost: completeData.cost,
                      completedAt: new Date().toISOString(),
                    }
                  : r
              ),
            },
          };
        }

        default:
          return state;
      }
    });
  },

  getAgent: (agentId) => {
    return get().agents.find((a) => a.id === agentId);
  },

  getAgentRuns: (agentId) => {
    return get().agentRuns[agentId] || [];
  },
}));
