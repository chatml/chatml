import { create } from 'zustand';
import type { Repo, Agent } from '@/lib/types';

interface AgentOutput {
  [agentId: string]: string[];
}

interface AppState {
  repos: Repo[];
  selectedRepoId: string | null;
  agents: Agent[];
  agentOutputs: AgentOutput;

  setRepos: (repos: Repo[]) => void;
  addRepo: (repo: Repo) => void;
  removeRepo: (id: string) => void;
  selectRepo: (id: string | null) => void;

  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (agentId: string, status: Agent['status']) => void;
  removeAgent: (id: string) => void;

  appendOutput: (agentId: string, line: string) => void;
  clearOutput: (agentId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  repos: [],
  selectedRepoId: null,
  agents: [],
  agentOutputs: {},

  setRepos: (repos) => set({ repos }),
  addRepo: (repo) => set((state) => ({ repos: [...state.repos, repo] })),
  removeRepo: (id) => set((state) => ({
    repos: state.repos.filter((r) => r.id !== id),
    selectedRepoId: state.selectedRepoId === id ? null : state.selectedRepoId,
  })),
  selectRepo: (id) => set({ selectedRepoId: id }),

  setAgents: (agents) => set({ agents }),
  addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
  updateAgentStatus: (agentId, status) => set((state) => ({
    agents: state.agents.map((a) =>
      a.id === agentId ? { ...a, status } : a
    ),
  })),
  removeAgent: (id) => set((state) => ({
    agents: state.agents.filter((a) => a.id !== id),
  })),

  appendOutput: (agentId, line) => set((state) => ({
    agentOutputs: {
      ...state.agentOutputs,
      [agentId]: [...(state.agentOutputs[agentId] || []), line],
    },
  })),
  clearOutput: (agentId) => set((state) => ({
    agentOutputs: {
      ...state.agentOutputs,
      [agentId]: [],
    },
  })),
}));
