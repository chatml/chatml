import { getApiBase, fetchWithAuth, handleResponse } from './base';

export interface SummaryDTO {
  id: string;
  conversationId: string;
  sessionId: string;
  conversationName?: string;
  content: string;
  status: 'generating' | 'completed' | 'failed';
  errorMessage?: string;
  messageCount: number;
  createdAt: string;
}

export async function generateSummary(convId: string): Promise<SummaryDTO> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/summary`, {
    method: 'POST',
  });
  return handleResponse<SummaryDTO>(res);
}

export async function getConversationSummary(convId: string): Promise<SummaryDTO | null> {
  const res = await fetchWithAuth(`${getApiBase()}/api/conversations/${convId}/summary`);
  if (res.status === 404) return null;
  return handleResponse<SummaryDTO>(res);
}

export async function listSessionSummaries(
  workspaceId: string,
  sessionId: string
): Promise<SummaryDTO[]> {
  const res = await fetchWithAuth(
    `${getApiBase()}/api/repos/${workspaceId}/sessions/${sessionId}/summaries`
  );
  return handleResponse<SummaryDTO[]>(res);
}
