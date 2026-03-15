import { getApiBase, fetchWithAuth, handleResponse } from './base';

export interface AvatarResponse {
  avatars: Record<string, string>;
}

export async function getAvatars(emails: string[]): Promise<Record<string, string>> {
  if (emails.length === 0) {
    return {};
  }
  const emailsParam = emails.join(',');
  const url = `${getApiBase()}/api/avatars?emails=${encodeURIComponent(emailsParam)}`;
  const res = await fetchWithAuth(url);
  const response = await handleResponse<AvatarResponse>(res);
  return response.avatars;
}
