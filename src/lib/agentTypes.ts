// Agent Orchestration Types

export interface AgentDefinition {
  id: string;
  name: string;
  type: string;
  description: string;
  execution: AgentExecution;
  polling?: AgentPolling;
  capabilities: string[];
  systemPrompt: string;
  limits: AgentLimits;
}

export interface AgentExecution {
  mode: 'read-only' | 'creates-session' | 'uses-session';
  workingDirectory: 'root' | 'session';
}

export interface AgentPolling {
  interval: string;
  sources: AgentPollingSource[];
}

export interface AgentPollingSource {
  type: 'github' | 'linear';
  owner?: string;
  repo?: string;
  resources?: string[];
  filters?: Record<string, unknown>;
}

export interface AgentLimits {
  budgetPerRun: number;
  maxSessionsPerHour: number;
}

export interface OrchestratorAgent {
  id: string;
  yamlPath: string;
  enabled: boolean;
  pollingIntervalMs: number;
  lastRunAt: string | null;
  lastError: string | null;
  totalRuns: number;
  totalCost: number;
  createdAt: string;
  updatedAt: string;
  isRunning: boolean;
  definition?: AgentDefinition;
}

export interface AgentRun {
  id: string;
  agentId: string;
  trigger: 'poll' | 'manual' | 'event';
  status: 'running' | 'completed' | 'failed';
  resultSummary?: string;
  sessionsCreated?: string[];
  cost: number;
  startedAt: string;
  completedAt?: string;
}

// WebSocket Event Types
export type AgentEventType =
  | 'agent.state.changed'
  | 'agent.run.started'
  | 'agent.run.progress'
  | 'agent.run.completed'
  | 'agent.session.created';

export interface AgentEvent {
  type: AgentEventType;
  agentId: string;
  timestamp: string;
  data: AgentEventData;
}

export type AgentEventData =
  | AgentStateChangedData
  | AgentRunStartedData
  | AgentRunProgressData
  | AgentRunCompletedData
  | AgentSessionCreatedData;

export interface AgentStateChangedData {
  enabled: boolean;
  lastError?: string;
}

export interface AgentRunStartedData {
  runId: string;
  trigger: string;
}

export interface AgentRunProgressData {
  runId: string;
  message: string;
}

export interface AgentRunCompletedData {
  runId: string;
  status: string;
  resultSummary?: string;
  sessionsCreated?: string[];
  cost: number;
  durationMs: number;
}

export interface AgentSessionCreatedData {
  runId: string;
  sessionId: string;
}

// API Request/Response Types
export interface UpdateAgentRequest {
  enabled?: boolean;
  pollingIntervalMs?: number;
}

export interface ReloadAgentsResponse {
  success: boolean;
  count: number;
}
