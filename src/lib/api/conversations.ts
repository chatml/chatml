import { getApiBase, fetchWithAuth, handleResponse, handleVoidResponse, ApiError } from './base';
import type { AttachmentContextType, AttachmentContextMeta } from '@/lib/types';

// Conversation DTOs and functions
export interface ConversationDTO {
  id: string;
  sessionId: string;
  type: 'task' | 'review' | 'chat';
  name: string;
  status: 'active' | 'idle' | 'completed';
  model?: string;
  messages: MessageDTO[];
  messageCount?: number;
  toolSummary: ToolActionDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface MessagePageDTO {
  messages: MessageDTO[];
  hasMore: boolean;
  totalCount: number;
  oldestPosition?: number;
}

export interface SetupInfoDTO {
  sessionName: string;
  branchName: string;
  originBranch: string;
  fileCount?: number;
  sessionType?: 'worktree' | 'base';
}

export interface RunStatsDTO {
  toolCalls: number;
  toolsByType: Record<string, number>;
  subAgents: number;
  filesRead: number;
  filesWritten: number;
  bashCommands: number;
  webSearches: number;
  totalToolDurationMs: number;
}

export interface TokenUsageDTO {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface ModelUsageInfoDTO {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
}

export interface PermissionDenialDTO {
  toolName: string;
  toolUseId: string;
}

export interface RunSummaryDTO {
  success: boolean;
  cost?: number;
  turns?: number;
  durationMs?: number;
  stats?: RunStatsDTO;
  errors?: unknown[];
  usage?: TokenUsageDTO;
  modelUsage?: Record<string, ModelUsageInfoDTO>;
  limitExceeded?: 'budget' | 'turns';
  permissionDenials?: PermissionDenialDTO[];
}

export interface AttachmentDTO {
  id: string;
  type: 'file' | 'image';
  name: string;
  path?: string;
  mimeType: string;
  size: number;
  lineCount?: number;
  width?: number;
  height?: number;
  base64Data?: string;
  preview?: string;
  isInstruction?: boolean; // Frontend-only: not persisted by the backend
  contextType?: AttachmentContextType;
  contextMeta?: AttachmentContextMeta;
}

export interface ToolUsageDTO {
  id: string;
  tool: string;
  params?: Record<string, unknown>;
  success?: boolean;
  summary?: string;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  metadata?: import('@/lib/types').ToolMetadata;
}

export interface TimelineEntryDTO {
  type: 'text' | 'tool' | 'thinking' | 'plan' | 'status';
  content?: string;
  toolId?: string;
  variant?: 'thinking_enabled' | 'config' | 'info';
}

export interface MessageDTO {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  setupInfo?: SetupInfoDTO;
  runSummary?: RunSummaryDTO;
  attachments?: AttachmentDTO[];
  toolUsage?: ToolUsageDTO[];
  thinkingContent?: string;
  durationMs?: number;
  timeline?: TimelineEntryDTO[];
  planContent?: string;
  checkpointUuid?: string;
  timestamp: string;
}

export interface ToolActionDTO {
  id: string;
  tool: string;
  target: string;
  success: boolean;
}

/** Map a ConversationDTO from the API to a store-compatible Conversation shape. */
export function toStoreConversation(dto: ConversationDTO): import('@/lib/types').Conversation {
  return {
    id: dto.id,
    sessionId: dto.sessionId,
    type: dto.type,
    name: dto.name,
    status: dto.status,
    model: dto.model,
    messages: (dto.messages || []).map((m) => toStoreMessage(m, dto.id)),
    messageCount: dto.messageCount,
    toolSummary: (dto.toolSummary || []).map((t) => ({
      id: t.id,
      tool: t.tool,
      target: t.target,
      success: t.success,
    })),
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/** Map a MessageDTO to a store-compatible Message shape. */
export function toStoreMessage(dto: MessageDTO, conversationId: string, opts?: { compacted?: boolean }): import('@/lib/types').Message {
  return {
    id: dto.id,
    conversationId,
    role: dto.role,
    content: dto.content,
    setupInfo: dto.setupInfo,
    runSummary: dto.runSummary,
    attachments: dto.attachments,
    toolUsage: dto.toolUsage,
    thinkingContent: dto.thinkingContent,
    durationMs: dto.durationMs,
    timeline: dto.timeline as import('@/lib/types').TimelineEntry[] | undefined,
    planContent: dto.planContent,
    checkpointUuid: dto.checkpointUuid,
    timestamp: dto.timestamp,
    compacted: opts?.compacted,
  };
}

export async function listConversations(
  workspaceId: string,
  sessionId: string
): Promise<ConversationDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/conversations`
  );
  return handleResponse<ConversationDTO[]>(res);
}

export async function listWorkspaceConversations(
  workspaceId: string
): Promise<ConversationDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/conversations`
  );
  return handleResponse<ConversationDTO[]>(res);
}

export async function createConversation(
  workspaceId: string,
  sessionId: string,
  data: {
    type?: 'task' | 'review' | 'chat';
    message?: string;
    model?: string;
    planMode?: boolean;
    permissionMode?: string;
    fastMode?: boolean;
    maxThinkingTokens?: number;
    effort?: string;
    attachments?: AttachmentDTO[];
    summaryIds?: string[];
    linearIssue?: {
      identifier: string;
      title: string;
      description?: string;
      stateName: string;
      labels: string[];
    };
    linkedWorkspaceIds?: string[];
  }
): Promise<ConversationDTO> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/conversations`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  return handleResponse<ConversationDTO>(res);
}

export async function getConversation(convId: string): Promise<ConversationDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}`);
  return handleResponse<ConversationDTO>(res);
}

export async function getConversationMessages(
  convId: string,
  opts?: { before?: number; limit?: number; compact?: boolean }
): Promise<MessagePageDTO> {
  const params = new URLSearchParams();
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts?.compact) params.set('mode', 'compact');
  const qs = params.toString();
  const url = `${getApiBase()}/api/conversations/${convId}/messages${qs ? `?${qs}` : ''}`;
  const res = await fetchWithAuth(url);
  return handleResponse<MessagePageDTO>(res);
}

export async function getMessage(convId: string, msgId: string): Promise<MessageDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/messages/${msgId}`);
  return handleResponse<MessageDTO>(res);
}

export async function sendConversationMessage(
  convId: string,
  content: string,
  attachments?: AttachmentDTO[],
  model?: string,
  mentionedFiles?: string[],
  planMode?: boolean
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, attachments, model, mentionedFiles, planMode }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function addSystemMessage(convId: string, content: string): Promise<{ id: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/system-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return handleResponse<{ id: string }>(res);
}

export async function stopConversation(convId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/stop`, { method: 'POST' });
  await handleVoidResponse(res, 'Failed to stop conversation');
}

export async function getConversationDropStats(convId: string): Promise<{ droppedMessages: number }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/drop-stats`);
  return handleResponse(res);
}

export async function getActiveStreamingConversations(): Promise<{ conversationIds: string[] }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/active-streaming`);
  return handleResponse(res);
}

export interface SnapshotSubAgent {
  agentId: string;
  agentType: string;
  parentToolUseId?: string;
  description?: string;
  output?: string;
  startTime: number;
  activeTools: { id: string; tool: string; startTime: number }[];
  completed: boolean;
}

export interface StreamingSnapshotDTO {
  text: string;
  textSegments?: { text: string; timestamp: number }[];
  activeTools: { id: string; tool: string; startTime: number }[];
  thinking?: string;
  isThinking: boolean;
  planModeActive: boolean;
  subAgents?: SnapshotSubAgent[];
  pendingPlanApproval?: { requestId: string; planContent?: string; timestamp: number } | null;
  pendingUserQuestion?: { requestId: string; questions: import('@/lib/types').UserQuestion[]; timestamp: number } | null;
  pendingElicitation?: { elicitationId: string; mcpServerName: string; timestamp: number } | null;
}

export async function getStreamingSnapshot(convId: string): Promise<StreamingSnapshotDTO | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/streaming-snapshot`);
  return handleResponse(res);
}

export interface InterruptedConversationDTO {
  id: string;
  sessionId: string;
  agentSessionId: string;
  snapshot: StreamingSnapshotDTO | null;
}

export async function getInterruptedConversations(): Promise<InterruptedConversationDTO[]> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/interrupted`);
  return handleResponse(res);
}

export async function resumeAgent(convId: string): Promise<{ status: string }> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/resume-agent`, { method: 'POST' });
  return handleResponse(res);
}

export async function clearConversationSnapshot(convId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/clear-snapshot`, { method: 'POST' });
  await handleVoidResponse(res, 'Failed to clear snapshot');
}

export async function deleteConversation(convId: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}`, { method: 'DELETE' });
  await handleVoidResponse(res, 'Failed to delete conversation');
}

export async function setConversationPlanMode(convId: string, enabled: boolean): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/plan-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function setConversationFastMode(convId: string, enabled: boolean): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/fast-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function setConversationMaxThinkingTokens(convId: string, maxThinkingTokens: number): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/max-thinking-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxThinkingTokens }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function approvePlan(convId: string, requestId: string, approved: boolean, reason?: string): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/approve-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, approved, ...(reason && { reason }) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Set permission mode for a running conversation
export async function setConversationPermissionMode(
  convId: string,
  mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk',
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/permission-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Approve or deny a pending tool execution request
export async function approveTool(
  convId: string,
  requestId: string,
  action: 'allow_once' | 'allow_session' | 'allow_always' | 'deny_once' | 'deny_always',
  specifier?: string,
  updatedInput?: Record<string, unknown>,
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/approve-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId,
      action,
      ...(specifier && { specifier }),
      ...(updatedInput && { updatedInput }),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Answer a pending AskUserQuestion from the agent
export async function answerConversationQuestion(
  convId: string,
  requestId: string,
  answers: Record<string, string>
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/answer-question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, answers }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

// Answer a pending sprint phase proposal from the agent
export async function answerSprintPhaseProposal(
  convId: string,
  requestId: string,
  approved: boolean
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/answer-sprint-phase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, approved }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}

export async function answerQAHandoff(
  convId: string,
  requestId: string,
  completed: boolean,
  notes?: string
): Promise<void> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/answer-qa-handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, completed, notes }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(text || `HTTP ${res.status}`, res.status, text);
  }
}
